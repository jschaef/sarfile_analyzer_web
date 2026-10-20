# ECharts vs BokehJS – render performance

Question: is Apache ECharts as fast as the current Bokeh path at turning chart
data into a painted chart in the browser?

## Method

- **What is timed:** from "data available in the page" to "chart painted".
  The payload is fetched and `JSON.parse`d **before** the clock starts, for both.
  - **ECharts** (the app's code path): `toColumns()` (API rows → columns, from
    `lib/sar.ts`) → `echarts.init` (canvas) → `setOption(buildLineOption(...))`
    (the app's `lib/echarts-option.ts`: LTTB sampling, dataZoom, no animation) →
    `finished` event → two `requestAnimationFrame`s.
  - **Bokeh** (the Streamlit path): `Bokeh.embed.embed_item(json_item)` → poll
    until every root view reports `has_finished()` → two `requestAnimationFrame`s.
    The `json_item` comes from the backend's `bokeh_charts.overview_v1(...)` + `json_item()`,
    which is what `streamlit_bokeh_component.serialize_figure` sends.
- **Same browser for both:** one headless Chromium, a fresh page per measurement,
  1280×900 viewport, chart 1200×400 px, libraries served locally (no CDN).
- **Runs:** 11 per case. Every run measures all cases, alternating the order
  (forward/backward) so neither library always runs first. Reported: median,
  min, max of the painted time.
- **Correctness check:** each case must produce a `<canvas>` and no page error;
  Bokeh must expose `has_finished()` on its root views. One screenshot per case
  (`BENCH_SCREENSHOTS`, trial run) was inspected – all six charts show the
  expected lines.
- **Data:** synthetic large fixture from `scripts/generate_sar.py --cpus 352
  --samples 2833 --interval 30 --minimal` (120 MB text; 1 000 049 rows in the CPU
  section; 30 s interval over 23.6 h), uploaded through the API.

### Scenarios

| Scenario | Data | Bokeh payload | ECharts payload |
|---|---|---|---|
| **cpu-overview** – the CPU chart of the Graphical Overview (as requested) | `all` aggregate, 10 metrics × 2 833 samples = 28 330 points | `overview_v1` strides down to 945 rows itself → 9 450 points | (a) **full rows**, exactly as `GET /files/{name}/data?header=CPU` returns them; (b) **Bokeh's rows** – the same 945 rows Bokeh keeps |
| **cpu-per-core** – stress case beyond the overview | `%usr` of each of the 352 CPUs as its own series = 997 216 points | `overview_v1` → MultiLine, strided to 189 rows → 66 528 points | (a) full rows (25.6 MB JSON); (b) Bokeh's 189 rows |

Case (b) compares the two renderers on identical points. Case (a) is what each
stack does in practice: Bokeh relies on server-side down-sampling, the ECharts
frontend receives every row and down-samples with LTTB on the client.

## Results

Environment: Intel Xeon @ 2.80 GHz, 4 vCPU, 15 GB RAM, Linux container, no GPU
(software rendering). Chromium 141.0.7390.37 (headless), Playwright 1.64.1,
ECharts 6.1.0, BokehJS 3.8.2 (from the bokeh 3.8.2 Python package), Node 22.22,
Python 3.13, pandas 3.0.6, polars 2.0.0.

Painted time in ms, 11 runs each:

| Scenario | Renderer | Points drawn from | Payload | Median | Min | Max |
|---|---|---|---:|---:|---:|---:|
| cpu-overview | BokehJS | 9 450 (server-sampled) | 63 KB | **349.7** | 333.6 | 521.2 |
| cpu-overview | ECharts, full rows | 28 330 | 729 KB | **245.7** | 213.8 | 300.3 |
| cpu-overview | ECharts, Bokeh's rows | 9 450 | 243 KB | **200.9** | 168.6 | 247.7 |
| cpu-per-core | BokehJS | 66 528 (server-sampled) | 764 KB | **2 065.6** | 1 739.8 | 2 196.2 |
| cpu-per-core | ECharts, full rows | 997 216 | 25.6 MB | **1 963.1** | 1 648.2 | 2 208.9 |
| cpu-per-core | ECharts, Bokeh's rows | 66 528 | 1.7 MB | **722.5** | 583.8 | 802.3 |

The ECharts numbers include the row→column conversion (median 13.8 ms /
4.4 ms / 79.2 ms / 17.1 ms in the order of the table).

The table is the run against the current option builder. Two earlier full runs
(11 runs each, with earlier versions of the chart option that differ only in
layout, restart-marker placement and the pinned x-axis range) gave medians of
321.8 / 216.8 / 167.9 / 1 684.0 / 1 689.7 / 604.8 ms and
333.7 / 250.6 / 183.3 / 1 786.7 / 1 827.5 / 589.0 ms in the same order. Bokeh's
side did not change between the runs, yet its medians moved by up to 23 %: on
this shared machine absolute numbers vary that much between runs. The ordering
between the cases was the same in all three runs.

### Costs outside the timed span (context, not part of the comparison)

| Step | Where | Measured |
|---|---|---|
| `overview_v1` figure build + `json_item` serialisation, cpu-overview | Python (Streamlit/API server) | 84.5 ms + 50.5 ms |
| same, cpu-per-core | Python | 175.7 ms + 243.2 ms |
| `GET /files/{name}/data?header=CPU` on the large file | FastAPI | 1.7–13 s, typically 2–7 s (7 calls) |
| Network transfer of the payload | – | not measured (local) |

The Bokeh path pays the figure build on the server; the ECharts path pays a
larger payload (row-oriented JSON with float32 artefacts, see
[PHASE2-API-GAPS.md](PHASE2-API-GAPS.md) #3/#4). On the large file the API
response time is an order of magnitude larger than either renderer.

## What the numbers show

- **CPU overview chart (the requested case):** ECharts painted faster than
  BokehJS in both variants – with the full 28 330 points (median 245.7 vs
  349.7 ms) and with identical 9 450 points (200.9 vs 349.7 ms). The ranges
  do not overlap.
- **~1 M points (stress case):** ECharts with all 997 216 points (median
  1 963.1 ms) and BokehJS with its server-sampled 66 528 points (median
  2 065.6 ms) are within each other's min–max range. On identical points ECharts
  was faster (722.5 vs 2 065.6 ms).
- The full-rows ECharts variant needs a 25.6 MB JSON for the stress case;
  that cost (transfer + `JSON.parse`) is not in the timed span.

Not covered: many charts on one page at once, interaction (zoom/pan/hover)
latency, memory use, real (non-synthetic) data of this size, GPU-accelerated
browsers, Firefox/Safari.

## Reproduce

```bash
# API running with UPLOAD_DIR set, large fixture uploaded as user admin
python3 scripts/generate_sar.py --cpus 352 --samples 2833 --interval 30 --minimal -o /tmp/sar_large.txt
# (upload /tmp/sar_large.txt via the UI or POST /api/v1/files)
# export_payloads.py imports the backend (default ../sarfile_analyzer_ng) - use its venv
SAR_BACKEND_DIR=../sarfile_analyzer_ng UPLOAD_DIR=... \
  ../sarfile_analyzer_ng/.venv/bin/python perf/export_payloads.py --file <uploaded name> --out perf/out
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run bench -- perf/out 11
# BENCH_SCREENSHOTS=<dir> keeps one screenshot per case
```
