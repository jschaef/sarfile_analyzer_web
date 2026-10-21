# sar-web-api

The API the Next.js frontend talks to (prefix `/api/v2`). It does not
re-implement sar parsing: it imports the modules of a
[sarfile_analyzer_ng](https://github.com/jschaef/sarfile_analyzer_ng) checkout
(read-only, never modified) and shares that project's storage (`UPLOAD_DIR`)
and user DB (`code/data.db`, read-only). sarfile_analyzer_ng's own API
(`/api/v1`) keeps running unchanged next to it.

## Run

```bash
# in the venv of sarfile_analyzer_ng (polars, pandas, ... come from there)
pip install -r requirements.txt
export SAR_BACKEND_DIR=../../sarfile_analyzer_ng    # default: sibling of this repo
export UPLOAD_DIR=/srv/sar/upload                   # same as sarfile_analyzer_ng
export SAR_WEB_API_SECRET=$(openssl rand -hex 32)
uvicorn sar_web_api.main:app --host 127.0.0.1 --port 8200
```

OpenAPI docs: `http://127.0.0.1:8200/docs`. Tests: `python -m pytest` (uses a
temporary `UPLOAD_DIR` and the checked-in small fixture).

| Variable | Default | Purpose |
|---|---|---|
| `SAR_BACKEND_DIR` | `../sarfile_analyzer_ng` next to this repo | checkout whose `code/` and `api/` are imported |
| `UPLOAD_DIR` | `code/upload` of the checkout | per-user file storage, shared with sarfile_analyzer_ng |
| `SAR_WEB_API_SECRET` | random per process (warning) | HMAC secret for session tokens; set it so sessions survive restarts |
| `SAR_WEB_API_TOKEN_TTL` | `43200` (12 h) | session lifetime in seconds |
| `SAR_WEB_STATE_DIR` | `$UPLOAD_DIR/config/sar-web-api` | where the revocation list (`revoked.sqlite`) lives |
| `SAR_WEB_CACHE_FILES` | `2` | parsed files kept in memory |
| `SAR_WEB_CACHE_HEADERS` | `16` | parsed headers kept in memory |
| `REDIS_ENABLED` etc. | see sarfile_analyzer_ng `code/config.py` | parquet cache of the main project, optional |

Memory: a parsed 1 M-row file plus its CPU header take a few hundred MB; size
the caches to the host.

## Endpoints (`/api/v2`)

| Method | Path | Purpose |
|---|---|---|
| GET | `/health` | liveness |
| POST | `/token` | login (`{username, password}`) → session token |
| POST | `/logout` | revoke the presented token (rejected from then on, also after a restart) |
| GET | `/users/me` | user + role |
| GET | `/files` | files with size, host, sar date, upload date |
| POST | `/files` | multipart upload (same conversion as sarfile_analyzer_ng); parses the Overview defaults in the background |
| DELETE | `/files/{name}` | delete file + parquet, drop caches |
| GET | `/files/{name}` | OS details, host, CPU count, time range, restarts (`time`, `iso`, `raw`), every sample timestamp, headers (alias, metrics, `has_devices`) |
| GET | `/files/{name}/header?header=` | metrics, devices, device count, CPU-like flag, devices of the Overview, timestamps |
| GET | `/files/{name}/series?header=` | column-oriented data; options below |
| GET | `/files/{name}/statistics?header=` | pandas-`describe()` numbers per device |
| GET | `/files/{name}/threshold?header=&metric=` | devices where `metric` lies in `min`..`max` (options below) |
| GET | `/metrics` | description per sar metric (the Streamlit "man pages") |

`series` options: `devices` (omitted = what the Graphical Overview shows:
CPU-like → `all`, other device headers → every device; `*` = every device;
or a comma list), `metrics` (comma list), `start`/`end` (`HH:MM[:SS]` or ISO,
same semantics as the main API), `max_points` (LTTB per metric, merged into
one time axis: at most metrics × max_points rows per device).

Response of `series` (values rounded to 2 decimals, `null` for gaps):

```json
{
  "header": "%usr %nice ...", "alias": "CPU", "metrics": ["%usr", "..."],
  "devices": ["0", "1", "2", "3", "all"], "device_count": 4, "cpu_like": true,
  "series": [
    {"device": "all", "rows": 96, "returned": 96, "sampled": false, "duplicates": 0,
     "x": [1790812800000, "..."], "values": {"%usr": [7.17, "..."]}}
  ]
}
```

`x` is the sar wall-clock time as epoch milliseconds interpreted as UTC (sar
files carry no time zone); render it with UTC to show the file's times.

`threshold` ("Metrics on many devices"), only for headers with devices:
without `min`/`max` it returns the metric's `value_min`/`value_max` and the
file's `start`/`end` (form defaults). With `min` and `max` (inclusive) and
optional `start`/`end` it returns `matches` (total), `devices` (`device`,
`count`, `peak`, `first`, `last`; `all` first, then numeric order) and `rows`
(`time`, `device`, `value`, sorted by time and device) cut at `limit`
(default 500, `0` = only the per-device summary), plus `rows_returned`.

## How it is coupled to sarfile_analyzer_ng

Imported read-only (a change there can break this service; `tests/` pins the
behaviour against the small fixture, including value equality with the main
API's `/data` and `/statistics`):

- `api.services`: `load_df`, `resolve_header`, `file_info`, `upload_sar_file`,
  `delete_sar_file`, `list_sar_files`, `user_dir`, `_validate_file_name`,
  `_parse_bound`, `_CPU_LIKE`, `DEFAULT_OVERVIEW_ALIASES`, `ServiceError`
- `pl_helpers2`: `get_data_frames_from__headers`, `get_sub_device_from_header`,
  `get_metrics_from_df`, `get_restart_headers`
- `sqlite2_polars.get_table_df("metric")`, `sql_stuff.login_user`/`get_role`,
  `config.Config`

Before calling `get_metrics_from_df`, whitespace in the data column is collapsed
(the main project's `df_clean_spaces` only collapses the first run). The output
is identical (`tests/test_data.py::test_whitespace_normalisation_is_lossless`;
also checked on a real sar file and the 1 M-row fixture), the CPU section of
the large fixture parses in 1.3 s instead of 10 s.
