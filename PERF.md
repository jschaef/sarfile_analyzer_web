# Performance: ECharts vs BokehJS, and the API behind them

Two questions:

1. Is Apache ECharts as fast as the current Bokeh path at turning chart data
   into a painted chart in the browser?
2. How long does the data take to arrive – sarfile_analyzer_ng's API (`/api/v1`)
   vs sar-web-api (`/api/v2`, `backend/`)?

Everything below runs on the synthetic large fixture from
`scripts/generate_sar.py --cpus 352 --samples 2833 --interval 30 --minimal`
(120 MB text; 1 000 049 rows in the CPU section; 30 s interval over 23.6 h).

Environment: Intel Xeon @ 2.80 GHz, 4 vCPU, 15 GB RAM, Linux container, no GPU
(software rendering), no Redis. Chromium 141.0.7390.37 (headless), Playwright
1.64.1, ECharts 6.1.0, BokehJS 3.8.2 (from the bokeh 3.8.2 Python package),
Node 22.22, Python 3.13, FastAPI 0.151, pandas 3.0.6, polars 2.0.0.

## 1. Rendering: data available → chart painted

### Method

- **What is timed:** from "data available in the page" to "chart painted".
  The payload is fetched and `JSON.parse`d **before** the clock starts, for both.
  - **ECharts** (the app's code path): `toColumns()` (from `lib/sar.ts`) →
    `echarts.init` (canvas) → `setOption(buildLineOption(...))` (the app's
    `lib/echarts-option.ts`: LTTB sampling, dataZoom, no animation) →
    `finished` event → two `requestAnimationFrame`s.
  - **Bokeh** (the Streamlit path): `Bokeh.embed.embed_item(json_item)` → poll
    until every root view reports `has_finished()` → two `requestAnimationFrame`s.
    The `json_item` comes from the backend's `bokeh_charts.overview_v1(...)` +
    `json_item()`, which is what `streamlit_bokeh_component.serialize_figure` sends.
- **Same browser for both:** one headless Chromium, a fresh page per measurement,
  1280×900 viewport, chart 1200×400 px, libraries served locally (no CDN).
- **Runs:** 11 per case. Every run measures all cases, alternating the order
  (forward/backward) so neither library always runs first. Reported: median,
  min, max of the painted time.
- **Correctness check:** each case must produce a `<canvas>` and no page error;
  Bokeh must expose `has_finished()` on its root views. One screenshot per case
  (`BENCH_SCREENSHOTS`) was inspected – the charts show the expected lines.

| Scenario | Data | Bokeh payload | ECharts payload |
|---|---|---|---|
| **cpu-overview** – the CPU chart of the Graphical Overview | `all` aggregate, 10 metrics × 2 833 samples = 28 330 points | `overview_v1` strides down to 945 rows itself → 9 450 points | (a) **full rows**: exactly the `GET /api/v2/files/{name}/series?header=CPU` response; (b) **Bokeh's rows**: the same 945 rows Bokeh keeps, same format |
| **cpu-per-core** – stress case beyond the overview | `%usr` of each of the 352 CPUs as its own series = 997 216 points | `overview_v1` → MultiLine, strided to 189 rows → 66 528 points | (a) full rows: `series?header=CPU&devices=0,…,351&metrics=%usr` (one entry per CPU, merged into one chart in the page); (b) Bokeh's 189 rows |

Case (b) compares the two renderers on identical points. Case (a) is what each
stack does in practice: Bokeh relies on server-side down-sampling, the ECharts
frontend receives every row and down-samples with LTTB on the client.

### Results (11 runs each, painted time in ms)

| Scenario | Renderer | Points drawn from | Payload | Median | Min | Max |
|---|---|---|---:|---:|---:|---:|
| cpu-overview | BokehJS | 9 450 (server-sampled) | 63 KB | **366.5** | 317.1 | 416.6 |
| cpu-overview | ECharts, full rows | 28 330 | 176 KB | **233.2** | 183.2 | 333.3 |
| cpu-overview | ECharts, Bokeh's rows | 9 450 | 58 KB | **184.0** | 150.5 | 309.4 |
| cpu-per-core | BokehJS | 66 528 (server-sampled) | 764 KB | **1 739.9** | 1 551.6 | 3 253.0 |
| cpu-per-core | ECharts, full rows | 997 216 | 19.7 MB | **1 634.2** | 1 418.9 | 2 041.7 |
| cpu-per-core | ECharts, Bokeh's rows | 66 528 | 1.3 MB | **583.4** | 533.9 | 700.3 |

The ECharts numbers include building the chart columns from the payload
(median 0.1–0.4 ms with the column-oriented `/api/v2` data; it was 4–79 ms with
the row-oriented `/api/v1` data in Phase 1).

Run-to-run spread: Phase 1 measured the same renderers three times on `/api/v1`
payloads (11 runs each). Bokeh's side never changed, yet its cpu-overview
median moved between 321.8 and 349.7 ms and its cpu-per-core median between
1 684.0 and 2 065.6 ms. Treat differences of 10–20 % between single runs on
this shared machine as noise. The order of the cpu-overview medians was the
same in all four runs; in the stress case "ECharts, full rows" and "BokehJS"
swapped places between runs (twice each), while "ECharts, Bokeh's rows" was
always the fastest.

### What the numbers show

- **CPU overview chart:** ECharts had the lower median in both variants – with
  the full 28 330 points (233.2 vs 366.5 ms) and with identical 9 450 points
  (184.0 vs 366.5 ms). In this run the min–max ranges overlap slightly (ECharts'
  slowest run 333.3 ms, Bokeh's fastest 317.1 ms); in the three Phase 1 runs
  they did not overlap.
- **~1 M points (stress case):** ECharts with all 997 216 points (median
  1 634.2 ms) and BokehJS with its server-sampled 66 528 points (median
  1 739.9 ms) are within each other's min–max range. On identical points ECharts
  was faster (583.4 vs 1 739.9 ms).
- The full-rows ECharts variant needs a 19.7 MB response for the stress case
  (every CPU repeats the time axis); transfer and `JSON.parse` of that are not
  in the timed span.

### Costs outside the timed span

| Step | Where | Measured |
|---|---|---|
| `overview_v1` figure build + `json_item` serialisation, cpu-overview | Python (Streamlit/API server) | 155.1 ms + 57.1 ms |
| same, cpu-per-core | Python | 137.5 ms + 298.6 ms |
| Network transfer of the payload | – | not measured (local) |

## 2. API: request → response

`perf/api_timing.py`, both services freshly started against the same
`UPLOAD_DIR`, 5 requests each, the CPU data of the Graphical Overview:

| | Request | 1st | Requests 2–5 (median) | Response |
|---|---|---:|---:|---:|
| sarfile_analyzer_ng API | `GET /api/v1/files/{name}/data?header=CPU` | 7.67 s | 2.08 s | 666 KB |
| sar-web-api | `GET /api/v2/files/{name}/series?header=CPU` | 4.69 s | 0.12 s | 176 KB |

- `/api/v1` parses the whole CPU section (1 M rows) on every request.
- `/api/v2`'s first request loads the parquet and parses the header (1.3 s of
  that is the parse, see below), then serves from its cache. After an upload it
  parses the five Overview default headers in the background, so the first page
  view after an upload does not pay the cold cost either.
- The parse itself is ~8× faster in `/api/v2` (10 s → 1.3 s for the CPU section):
  whitespace in the data column is collapsed before calling the unchanged
  `get_metrics_from_df` (see [backend/README.md](backend/README.md)).

Measured in-process on the same file (data layer only, cache warm): all 352
per-core `%usr` series in one request 0.6 s; statistics of the CPU header 0.3 s.
With `/api/v1` the per-core view would be 352 requests of ~2 s each.

Not covered: many charts on one page at once, interaction (zoom/pan/hover)
latency, memory use, real (non-synthetic) data of this size, GPU-accelerated
browsers, Firefox/Safari, Redis enabled, concurrent users.

## Reproduce

```bash
python3 scripts/generate_sar.py --cpus 352 --samples 2833 --interval 30 --minimal -o /tmp/sar_large.txt
# upload /tmp/sar_large.txt as user admin via the UI (or POST /api/v2/files)

# 1. rendering (venv of sarfile_analyzer_ng, SAR_BACKEND_DIR if not ../sarfile_analyzer_ng)
UPLOAD_DIR=... python perf/export_payloads.py --file <uploaded name> --out perf/out
PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome npm run bench -- perf/out 11
# BENCH_SCREENSHOTS=<dir> keeps one screenshot per case

# 2. API: start sarfile_analyzer_ng's API on :8100 and sar-web-api on :8200
#    (same UPLOAD_DIR), then right away
python3 perf/api_timing.py --file <uploaded name> --runs 5
```
