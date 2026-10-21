# API gaps: status after Phase 2

Phase 1 listed what sarfile_analyzer_ng's FastAPI (`api/` of
[jschaef/sarfile_analyzer_ng](https://github.com/jschaef/sarfile_analyzer_ng))
lacked for the frontend. Phase 2 closes those gaps **without changing that
project**: [sar-web-api](backend/README.md) (`backend/`, `/api/v2`) imports its
parser read-only and the frontend now talks only to sar-web-api.
sarfile_analyzer_ng's API keeps running unchanged for its other clients.

Timings: synthetic large fixture (352 CPUs, 2 833 samples, ~1 M rows in the CPU
section), 4-vCPU dev container, no Redis – details in [PERF.md](PERF.md).

| # | Gap in `/api/v1` | `/api/v2` (sar-web-api) | Status |
|---|---|---|---|
| 1 | `/headers/{header}` as a path parameter: aliases with `/` (`I/O and transfer rate`) give 404 | `GET /files/{name}/header?header=` – query parameter; tested with `I/O and transfer rate` (pytest + e2e) | closed |
| 2 | `/data` returns one device per request | `GET /files/{name}/series` returns every device the Overview shows in one response (`devices=` for `*` or a list) | closed |
| 3 | `/data` slow on large files (2–7 s per request, parses 1 M rows every time) | per-file and per-header cache (first request 4.7 s, then 0.12 s); parse ~8× faster (10 s → 1.3 s) by collapsing whitespace before the unchanged `get_metrics_from_df`; Overview defaults parsed in the background after an upload | closed |
| 4 | row-oriented JSON with float32 artefacts (666 KB for the CPU chart) | column-oriented, rounded to 2 decimals (176 KB); optional `max_points` (LTTB per metric, one shared time axis) | closed |
| 5 | restarts only as raw text | `restarts: [{time, iso, raw}]` in `GET /files/{name}`; 12-hour (AM/PM) lines handled | closed |
| 6 | no list of sample timestamps | `timestamps` in `GET /files/{name}`; start/end in the UI are now selects of the real sample times, like Streamlit | closed |
| 7 | no `device_num` ("all of N") | `device_count` in `series` and `header` | closed |
| 8 | metric descriptions ("man pages") not exposed | `GET /metrics`; "Metrics" tab per chart and descriptions as tooltips in the metric menu | closed |
| 9 | duplicate timestamps not reported | `duplicates` per series; the card warns like Streamlit's "multiple indexes"; first value kept (`keep='first'`); pytest with a duplicated block | closed |
| 10 | no token revocation | own session tokens (own secret, `jti`), `POST /logout` puts the `jti` on a SQLite denylist until expiry; the frontend's logout calls it. `/api/v1` tokens and `/api/v2` tokens are not interchangeable | closed |
| 11 | no combined overview endpoint | one request per alias (gap 2 + 7 merged into `series`). An all-aliases endpoint was left out on purpose: per-alias responses let the page render chart by chart | closed |
| 12 | no combined statistics CSV ("Generate csv for all statistical data") | `GET /files/{name}/statistics` (per device, pandas `describe()` numbers) exists; no CSV export across charts yet | open |
| 13 | `GET /files` without metadata | `host`, `sar_date`, `uploaded` from the name convention | closed |
| 14 | no progress for the server-side parse after upload | unchanged: the upload returns after parsing | open |
| 15 | SSO built for the Streamlit redirect | not ported; Next.js has username/password login only | open |

## Phase 3: analysis views

The four remaining analysis views needed one more endpoint:

| Need | `/api/v2` | Status |
|---|---|---|
| "Metrics on many devices": which devices have a metric within a range (`/api/v1` has no such query; the view would have to load every device) | `GET /files/{name}/threshold?header=&metric=&min=&max=[&start=&end=&limit=]` – matches per device (count, peak, first, last) in natural device order and the matching samples (`limit`, default 500); without `min`/`max` only the value range and time range of the metric, for the form defaults | closed |
| headings that have devices (the device view lists only those) | `has_devices` per header in `GET /files/{name}` | closed |

Detailed Metrics, Compare Metrics and Multiple SAR Files use the existing
`header`, `series` and `statistics` endpoints. Multiple SAR Files computes the
combined statistics of all files in the browser (`lib/stats.ts`, same numbers
as pandas `describe()`).

## Phase 4: accounts and admin pages

`/api/v1` has `POST /users` (admin) and nothing else for accounts. sar-web-api
adds what the Streamlit pages Signup, Self Service, User Management,
DB Management, Redis Management and Info need: `/signup`, `/info`,
`/users/me/password` and `/admin/*` (users, roles, passwords, login history,
metric and heading tables, Redis hash fields) – list in
[backend/README.md](backend/README.md). The writes go through
sarfile_analyzer_ng's own functions into its `data.db`; nothing in that project
changes. The TODO page was left out on purpose.

## Still open / new limits

- **Statistics CSV export (12), parse progress (14), SSO (15).**
- **PDF export** (`POST /api/v1/charts/overview`, Bokeh + Selenium) is not wired
  into the frontend and was not tested.
- **Repeated time axis for many devices:** in `series` every device carries its
  own `x`. For 352 CPUs × 2 833 samples that is most of the 19.7 MB response.
  A shared `x` when all devices have the same timestamps would shrink it to
  roughly a third (the 13-digit timestamps outweigh the values);
  only matters for per-device views of very large hosts, which the Overview does
  not show.
- **Cache is per process:** with several uvicorn workers each worker parses and
  caches on its own (memory × workers). The revocation list is shared (SQLite).
- **Coupling:** sar-web-api imports internals of sarfile_analyzer_ng (list in
  [backend/README.md](backend/README.md)), including private helpers
  (`_parse_bound`, `_validate_file_name`, `_CPU_LIKE`). A refactoring there can
  break it; `backend/tests` pin the behaviour, including value equality with
  `/api/v1/.../data` and `/statistics` on the small fixture.

## Frontend-side notes

- **No CORS.** The browser only talks to Next.js; `/api/v2/*` is rewritten to
  sar-web-api and `proxy.ts` injects `Authorization: Bearer <token>` from the
  httpOnly cookie.
- **Uploads bypass the rewrite.** Next.js buffers request bodies on
  proxy-matched paths and silently cuts them at 10 MB
  (`experimental.proxyClientMaxBodySize`). Uploads go through the streaming
  route handler `app/api/upload`; a direct `POST /api/v2/files` through Next.js
  is rejected with 405. Verified in Phase 1 with the 120 MB large fixture.
