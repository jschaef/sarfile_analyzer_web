# SAR Analyzer – web frontend

A web frontend for the sar analyzer of
[jschaef/sarfile_analyzer_ng](https://github.com/jschaef/sarfile_analyzer_ng),
in two parts:

- **Next.js app** (repository root): every page of the Streamlit app – login,
  signup, file management, the five analysis views, self service, the admin
  pages and info (only the TODO page is left out).
- **sar-web-api** ([`backend/`](backend/README.md)): a small FastAPI service the
  app talks to. It imports the parser and header logic of a sarfile_analyzer_ng
  checkout read-only and adds what that project's own API lacks (column-oriented
  series of all devices in one request, caching, sample timestamps, structured
  restarts, metric descriptions, revocable sessions). sarfile_analyzer_ng – its
  Streamlit UI and its API – stays unchanged and keeps running on its own.

Features:

- **Login**: username/password against the analyzer user DB; the session token
  is kept in an httpOnly cookie and never reaches browser JavaScript. Logout
  revokes the token on the server.
- **Signup**: create an account with role `user` (can be switched off with
  `SAR_WEB_SIGNUP=false` in sar-web-api); you are logged in right away. The
  login page links to it and names the admin contact for forgotten passwords.
- **Manage SAR Files**: list (host, sar date, size), upload (drag & drop,
  several files, progress), delete.
- **Graphical Overview**: the overview page of the Streamlit app with header/alias
  selection (defaults: CPU, Kernel tables, Load, Memory utilization, Swap
  utilization), per-chart metric selection, start/end from the file's real
  sample times, Apache ECharts line charts with zoom, restart markers, a
  statistics tab, a metric description ("man pages") tab and the duplicate
  timestamp warning.
- **Detailed Metrics**: one heading, one device, one metric – or all metrics of
  the heading ("Summary") – with chart, data table (CSV download, restarts
  highlighted), statistics and metric descriptions.
- **Metrics on many devices**: find the devices where a metric lies in a range
  (e.g. every CPU with `%iowait` between 15.5 and 50) in a time window, list
  matches per device (count, peak, first/last) and the matching samples, and
  chart the chosen devices in one diagram.
- **Compare Metrics**: up to six heading/device/metric combinations in one chart.
- **Multiple SAR Files**: the same heading/device/metric from several files,
  either laid over one 24-hour axis or one after another on the real time axis
  ("consecutive"), with a time range, combined and per-file statistics, and a
  summary per file.

- **Self Service** (click your user name): change your own password (needs the
  current one).
- **Admin** (role `admin` only, checked by the API on every request):
  - *User Management*: users and roles, set a password, delete a user with
    their SAR files, successful-login counter, login history with filters and
    "delete records older than".
  - *DB Management*: metric descriptions (search, add, delete) and sar headings
    (search by alias/metric/description, add, edit, delete).
  - *Redis Management*: Redis keys, delete fields of a hash.
  - *Settings*: the runtime values of sarfile_analyzer_ng's `config.py` –
    contact (admin e-mail, chat), limits (metrics in Compare Metrics, select
    boxes per line) and the Redis connection. Stored values win over the
    environment variables and apply to this frontend and the Streamlit app
    without a restart; *Reset* goes back to the environment.
- **Info**: about, FAQ, contact and code links.

Signup, Self Service and the admin pages write to sarfile_analyzer_ng's
`code/data.db` through that project's own functions, like its Streamlit pages
(details in [backend/README.md](backend/README.md#writing-to-datadb)). The
`data.db` in git stays the seed (admin/password, headings, metrics); tests
always work on a temporary copy.

The analysis views share a sub navigation that keeps the chosen file
(`?file=`). The login form also works without JavaScript (it posts to
`/api/auth/login`, which answers with a redirect; cross-site posts are rejected).

Stack: Next.js 16.4.2 (App Router, Turbopack, Cache Components), React 19.3,
TypeScript strict, Tailwind CSS 4, shadcn/ui (Base UI), Apache ECharts 6.1,
next-themes (light/dark/system), Playwright; FastAPI + polars for sar-web-api.

## Architecture

```
browser ──► Next.js :3100 ──┬─ /api/auth/login|logout|signup  route handlers: set/clear the httpOnly cookie,
                            │                           logout revokes the token at sar-web-api
                            ├─ /api/upload              route handler, streams multipart to POST /api/v2/files
                            └─ /api/v2/*  ─ proxy.ts adds "Authorization: Bearer <cookie>"
                                          ─ rewrite (next.config.ts) ──► sar-web-api :8200 /api/v2/*
                                                                         │ imports code/ + api/ (never changed)
                                                                         ▼
                                              sarfile_analyzer_ng checkout, shared UPLOAD_DIR + code/data.db
```

- Same origin for the browser, so no CORS anywhere.
- `proxy.ts` (Next 16's new name for middleware) also redirects pages to
  `/login` when no session cookie exists. sar-web-api validates the token on
  every call; a 401 drops the cookie and sends the user to the login page.
- Uploads do not go through the rewrite: Next.js buffers bodies on
  proxy-matched paths and cuts them at 10 MB.
- sar-web-api tokens use their own secret: they do not work against
  sarfile_analyzer_ng's API and vice versa, so a revoked session cannot be
  reused there.

### Overview rules taken over from `code/dia_overview_pl.py` (backend repo)

- Options are the file's aliases sorted ascending; the **diagram order follows
  that option order, not the click order** (`sel_order_map`).
- Headers without sub-devices → one chart. CPU-like headers (`^CPU|SOFT.*`) →
  only the `all` aggregate, labelled "all of N". Other multi-device headers
  (DEV, IFACE, …) → one chart per device, sorted by name. sar-web-api applies
  these rules itself; the app makes **one request per alias**.
- Duplicate timestamps: the first value is plotted (`keep='first'`, like
  `final_results`) and the card shows a warning.
- Charts: canvas renderer, LTTB sampling, `dataZoom` (wheel + slider), animation
  off, legend/metric menu to hide metrics, restarts as dashed red line, PNG export
  from the toolbox. ECharts' `large` mode does not exist for line series (only
  scatter/bar/lines), so it is not used. Option builder: `lib/echarts-option.ts`.

## Run locally

```bash
# 1. sarfile_analyzer_ng next to this repo, with its venv (only read, never changed)
git clone https://github.com/jschaef/sarfile_analyzer_ng ../sarfile_analyzer_ng
python3 -m venv ../sarfile_analyzer_ng/.venv && . ../sarfile_analyzer_ng/.venv/bin/activate
pip install -r ../sarfile_analyzer_ng/api/requirements.txt \
            -r ../sarfile_analyzer_ng/code/requirements.txt -r backend/requirements.txt

# 2. sar-web-api (same UPLOAD_DIR as sarfile_analyzer_ng's API, if that runs too)
export UPLOAD_DIR=/tmp/sar-upload REDIS_ENABLED=false SAR_WEB_API_SECRET=$(openssl rand -hex 32)
(cd backend && uvicorn sar_web_api.main:app --host 127.0.0.1 --port 8200)

# 3. frontend
npm ci
npm run dev                       # http://localhost:3100, seed login admin / password
```

Trying out signup and the admin pages without touching the checkout's
`code/data.db`: start sar-web-api with `python -m sar_web_api.e2e_server`
instead of `uvicorn …` (a temporary copy of the seed DB), or point `SAR_WEB_DB`
at your own copy.

Production: `npm run build && npm run start`. Both listen on port 3100 (3000 is
often taken by other local dev servers); another port: `npm run dev -- -p 3200`. sar-web-api's settings are in
[backend/README.md](backend/README.md). The lab server setup (systemd user
units, nginx on :8444, deploy script) is in
[deployment/lab/README.md](deployment/lab/README.md).

| Variable | Default | Purpose |
|---|---|---|
| `SAR_WEB_API_URL` | `http://127.0.0.1:8200` | sar-web-api base URL. Read by the rewrite **at build time** and by the route handlers at runtime – set it for both. |
| `SAR_COOKIE_SECURE` | `true` in production, else `false` | `Secure` flag of the session cookie. Set `false` only for plain-HTTP setups. |

The session cookie lives as long as the token (`SAR_WEB_API_TOKEN_TTL`, 12 h).

## Checks

```bash
npm run lint
npm run typecheck
npm run build
npm run test:e2e        # needs a build; starts/reuses sar-web-api (:8200) and Next.js (:3100)
(cd backend && python -m pytest)   # sar-web-api, in the venv from above
```

E2E:

- `e2e/overview.spec.ts`: login → upload the small fixture → Overview with
  the five default aliases → charts rendered → order/device rules → an alias with
  `/` in its name → metric menu → time filter → statistics → metric descriptions →
  delete → logout (+ 401 afterwards), plus theme switching, wrong password and
  httpOnly cookie checks.
- `e2e/analyze.spec.ts`: the sub navigation keeps the file; Detailed Metrics
  (device/metric, summary, data tab, heading without devices); Metrics on many
  devices (threshold → matches → chart); Compare Metrics (several headings,
  added slot); Multiple SAR Files (the fixture and a copy shifted by one day:
  overlay, statistics, consecutive, summary); the login form post (303 +
  httpOnly cookie, wrong password, cross-site 403).
- `e2e/account.spec.ts`: signup (password mismatch, duplicate name, form post
  without JavaScript), no admin menu and "Admins only" for a normal user, Self
  Service, User Management (own row locked, role change seen by the user's open
  session, password, login history, delete → the user's session ends), DB
  Management (metric and heading add/edit/delete), Settings (admin e-mail on
  a visitor's login page, limit in Compare Metrics, reset), Redis and Info.

Options for the e2e run:

- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/path/to/chrome` – use a preinstalled Chromium.
- sar-web-api is started from `backend/` with `python -m
  sar_web_api.e2e_server --port 8200` – the app on a temporary copy of the seed
  `data.db`, because the account tests sign up users and edit tables. The venv
  must be active and `UPLOAD_DIR`, `SAR_WEB_API_SECRET` (and `SAR_BACKEND_DIR`
  if the checkout is not at `../sarfile_analyzer_ng`) set. `SAR_E2E_SKIP_API=1`
  never starts it, `SAR_E2E_API_CMD` changes the command. An API that already
  listens on :8200 is reused – never let that be one with real users.
- `SAR_E2E_REAL_FILE=/path/to/sar-file SAR_E2E_REAL_HOST=<host>` – additionally
  runs `e2e/real-file.spec.ts` against a real sar file outside the repo
  (Overview, Detailed Metrics, Metrics on many devices). `<host>` is the
  hostname from the file's first line.
- `SAR_SCREENSHOTS_DIR=docs/screenshots [SAR_SCREENSHOTS_WIDTH=1024]` – writes the
  screenshots of login, Overview, Detailed Metrics, Metrics on many devices,
  Compare Metrics, User Management, DB Management and Settings in light and dark.

## Test data

There are no real sar files in the repo. `scripts/generate_sar.py` writes a
synthetic `sar -A` text report that the backend's `code/parse_into_polars.py` accepts
(deterministic, stdlib only):

```bash
# small fixture, checked in as e2e/fixtures/sar_small.txt (4 CPUs, 96 samples, 1 restart)
python3 scripts/generate_sar.py --cpus 4 --samples 96 --interval 900 --restart -o e2e/fixtures/sar_small.txt
# large fixture for the benchmark (352 CPUs, ~1 M rows in the CPU section, 120 MB) – not checked in
python3 scripts/generate_sar.py --cpus 352 --samples 2833 --interval 30 --minimal -o /tmp/sar_large.txt
```

## Performance and API status

- [PERF.md](PERF.md): ECharts vs BokehJS, payload sizes, API response times.
- [PHASE2-API-GAPS.md](PHASE2-API-GAPS.md): which gaps of sarfile_analyzer_ng's
  API sar-web-api closes and what is still open.

## Layout

```
app/login, app/signup     login and signup pages (components/auth-page, help-note)
app/(app)/files           file management
app/(app)/(analyze)       analysis views with a shared sub navigation (layout.tsx):
  overview                  Graphical Overview (overview, alias-section, chart-card)
  details                   Detailed Metrics
  devices                   Metrics on many devices
  compare                   Compare Metrics
  multi                     Multiple SAR Files
app/(app)/account         Self Service
app/(app)/admin           users (+ login history), database (metrics, headings), redis, settings
app/(app)/info            Info
components/analyze        shared parts of the views: file picker, sub navigation,
                          result tabs, data table, statistics, metric descriptions
app/api/auth/*, api/upload  route handlers (cookie + revocation, signup, streaming upload)
backend/                  sar-web-api (FastAPI, pytest; accounts.py for the account/admin endpoints)
components/charts         ECharts wrapper (tree-shaken echarts/core)
components/ui             shadcn/ui components
lib/                      API client, hooks, sar data helpers, describe() statistics,
                          ECharts option builder
proxy.ts                  auth header injection + page guard
e2e/                      Playwright tests + small fixture
perf/                     benchmark (export_payloads.py, bench.mjs, api_timing.py)
scripts/generate_sar.py   synthetic sar generator
```

## License

GNU General Public License v3.0, like the backend
[jschaef/sarfile_analyzer_ng](https://github.com/jschaef/sarfile_analyzer_ng).
See [LICENSE](LICENSE).
