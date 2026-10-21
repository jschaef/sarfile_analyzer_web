# sar-web-api

The API the Next.js frontend talks to (prefix `/api/v2`). It does not
re-implement sar parsing: it imports the modules of a
[sarfile_analyzer_ng](https://github.com/jschaef/sarfile_analyzer_ng) checkout
(read-only, never modified) and shares that project's storage (`UPLOAD_DIR`)
and database (`code/data.db`: users, metric descriptions, headings).
sarfile_analyzer_ng's own API (`/api/v1`) and Streamlit app keep running
unchanged next to it.

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
temporary `UPLOAD_DIR`, a temporary copy of the checkout's `code/data.db` and
the checked-in small fixture; the run fails if the original `data.db` changed).

| Variable | Default | Purpose |
|---|---|---|
| `SAR_BACKEND_DIR` | `../sarfile_analyzer_ng` next to this repo | checkout whose `code/` and `api/` are imported |
| `SAR_WEB_DB` | `code/data.db` of the checkout | another data.db (users, metrics, headings) – for tests and local trials; give it its own `UPLOAD_DIR` (the parquet copies of the tables live in `$UPLOAD_DIR/config`) |
| `SAR_WEB_SIGNUP` | `true` | `false` turns off `POST /signup` (accounts only through an admin) |
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
| GET | `/info` | admin contact (`ADMIN_EMAIL`, `ADMIN_COMMUNICATION`), code links, whether signup is on – no login |
| POST | `/signup` | new account with role `user` – no login; `SAR_WEB_SIGNUP=false` → 403 |
| PUT | `/users/me/password` | change your own password (`current_password`, `new_password`) |
| GET | `/admin/users` | users with role, available roles, login counter |
| PUT | `/admin/users/{user}/role` · `/password` | set role / password of a user |
| DELETE | `/admin/users/{user}` | delete the user and their upload directory |
| GET · DELETE | `/admin/logins` | login history (newest first, `limit`) · delete records older than `before=YYYY-MM-DD` |
| GET · POST · DELETE | `/admin/metrics` | metric descriptions · add · delete (`?metric=a&metric=b`) |
| GET · POST · PUT · DELETE | `/admin/headers` | headings (header, alias, keyword, description) · add · update (`original_header`) · delete (`?header=`) |
| GET · DELETE | `/admin/redis` · `/admin/redis/fields` | Redis keys with hash fields · delete fields of a hash |

`/admin/*` needs the role `admin`. The role is read from data.db on every
request (a role change applies without a new login), and every request checks
that the user still exists (a deleted user's tokens stop working at once).
An admin cannot take away their own admin role or delete their own account,
so there is always an admin left.

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

## Writing to data.db

The account and admin endpoints (`sar_web_api/accounts.py`) write through the
same functions as the Streamlit pages Signup, Self Service, User Management,
DB Management and Redis Management – no own tables, no own schema:

- users: `sql_stuff.add_userdata`, `change_password`, `modify_user`,
  `delete_user` (+ the upload directory, like Streamlit)
- metric/heading tables: `sql_stuff.add_metric`, `delete_metric`,
  `add_header`, `update_header`, `delete_header`, then
  `sqlite2_polars.invalidate_table_cache` so every process sees the change
- logins: `handle_user_status.add_record`, `increment_login_counter`,
  `remove_old_logins` (the login history in `$UPLOAD_DIR/config`)

`sql_stuff` keeps one module-level SQLAlchemy session; sar-web-api serializes
every use of it with a lock. In production that is the server's `data.db`
(protected from `git pull` with `skip-worktree`, see sarfile_analyzer_ng's
`deployment/lab/README-lab.md`); the `data.db` in git stays the seed.

Differences to Streamlit: changing your own password needs the current
password; signup rejects the reserved name `config` (the shared directory in
`UPLOAD_DIR`); a header that already exists gives 409 instead of being skipped
silently.

E2E runs start the API with `python -m sar_web_api.e2e_server`: it copies the
`data.db` it would use into a temporary directory and serves the app on that
copy.

## How it is coupled to sarfile_analyzer_ng

Imported read-only (a change there can break this service; `tests/` pins the
behaviour against the small fixture, including value equality with the main
API's `/data` and `/statistics`):

- `api.services`: `load_df`, `resolve_header`, `file_info`, `upload_sar_file`,
  `delete_sar_file`, `list_sar_files`, `user_dir`, `_validate_file_name`,
  `_parse_bound`, `_CPU_LIKE`, `DEFAULT_OVERVIEW_ALIASES`, `ServiceError`
- `pl_helpers2`: `get_data_frames_from__headers`, `get_sub_device_from_header`,
  `get_metrics_from_df`, `get_restart_headers`
- `sqlite2_polars`: `get_table_df`, `invalidate_table_cache`,
  `refresh_all_tables`
- `sql_stuff`: the functions above, `get_role`, `view_all_users`,
  `ret_all_roles`, the models `User`/`Metrics`/`Headings`, and its globals
  `data_db`/`engine`/`Session`/`session` (rebound by `SAR_WEB_DB`)
- `handle_user_status`, `redis_mng.get_rs`, `hashing.verify_password`,
  `validation.is_valid_username`, `api.services.EXCLUDED_UPLOAD_DIRS`,
  `config.Config`

Before calling `get_metrics_from_df`, whitespace in the data column is collapsed
(the main project's `df_clean_spaces` only collapses the first run). The output
is identical (`tests/test_data.py::test_whitespace_normalisation_is_lossless`;
also checked on a real sar file and the 1 M-row fixture), the CPU section of
the large fixture parses in 1.3 s instead of 10 s.
