"""sar-web-api: the API the Next.js frontend talks to (prefix /api/v2).

Run from backend/ (needs the sarfile_analyzer_ng checkout and its venv):
    SAR_BACKEND_DIR=../../sarfile_analyzer_ng UPLOAD_DIR=... SAR_WEB_API_SECRET=... \
        uvicorn sar_web_api.main:app --host 127.0.0.1 --port 8200

Shares users and the metric/heading tables (code/data.db, or SAR_WEB_DB) and
files (UPLOAD_DIR) with sarfile_analyzer_ng, which keeps running unchanged on
its own port. Writes to data.db go through that project's own functions, like
its Streamlit pages (see accounts.py).
"""

import datetime
import logging

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from . import bootstrap  # noqa: F401  (must come before code/ imports)

from api import services  # noqa: E402

from . import accounts, data  # noqa: E402
from .auth import (  # noqa: E402
    Session,
    admin_user,
    create_token,
    current_session,
    current_user,
    revocations,
)

logging.basicConfig(level=logging.INFO)

PREFIX = "/api/v2"

app = FastAPI(
    title="SAR Analyzer web API",
    version="2.0.0",
    description=(
        "Data API for the Next.js frontend: column-oriented series for all devices "
        "of a header in one request, server-side caching, optional LTTB "
        "down-sampling, structured restarts, sample timestamps, metric "
        "descriptions and revocable sessions. Reuses sarfile_analyzer_ng's parser."
    ),
)


@app.exception_handler(data.ServiceError)
async def _service_error(_, exc: data.ServiceError):
    return JSONResponse(status_code=400, content={"detail": str(exc)})


@app.exception_handler(data.NotFound)
async def _not_found(_, exc: data.NotFound):
    return JSONResponse(status_code=404, content={"detail": str(exc)})


@app.exception_handler(accounts.Conflict)
async def _conflict(_, exc: accounts.Conflict):
    return JSONResponse(status_code=409, content={"detail": str(exc)})


@app.exception_handler(accounts.Forbidden)
async def _forbidden(_, exc: accounts.Forbidden):
    return JSONResponse(status_code=403, content={"detail": str(exc)})


@app.exception_handler(accounts.Unsupported)
async def _unsupported(_, exc: accounts.Unsupported):
    return JSONResponse(status_code=501, content={"detail": str(exc)})


@app.get(f"{PREFIX}/health")
def health():
    return {"status": "ok"}


# --------------------------------------------------------------------------
# sessions
# --------------------------------------------------------------------------
class TokenRequest(BaseModel):
    username: str
    password: str


@app.post(f"{PREFIX}/token")
def token(request: TokenRequest):
    ok = accounts.verify_password(request.username, request.password)
    accounts.record_login(request.username, ok)
    if not ok:
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return create_token(request.username)


@app.post(f"{PREFIX}/logout")
def logout(session: Session = Depends(current_session)):
    """Revoke the presented token; it is rejected from now on."""
    revocations().revoke(session)
    return {"revoked": True}


@app.get(f"{PREFIX}/users/me")
def me(username: str = Depends(current_user)):
    return {"username": username, "role": accounts.role(username)}


@app.get(f"{PREFIX}/info")
def info():
    """Contact and project links for the Help and Info pages (no login)."""
    return accounts.info()


# --------------------------------------------------------------------------
# accounts (Signup, Self Service)
# --------------------------------------------------------------------------
Username = Field(min_length=1, max_length=50)
Password = Field(min_length=1, max_length=1024)


class SignupRequest(BaseModel):
    username: str = Username
    password: str = Password


@app.post(f"{PREFIX}/signup", status_code=201)
def signup(request: SignupRequest):
    """Create an account with role 'user'. SAR_WEB_SIGNUP=false turns it off."""
    return accounts.signup(request.username.strip(), request.password)


class OwnPasswordRequest(BaseModel):
    current_password: str = Field(max_length=1024)
    new_password: str = Password


@app.put(f"{PREFIX}/users/me/password")
def change_own_password(request: OwnPasswordRequest, username: str = Depends(current_user)):
    accounts.change_own_password(username, request.current_password, request.new_password)
    return {"changed": True}


# --------------------------------------------------------------------------
# User Management (admin)
# --------------------------------------------------------------------------
@app.get(f"{PREFIX}/admin/users")
def admin_users(admin: str = Depends(admin_user)):
    return accounts.users()


class RoleRequest(BaseModel):
    role: str


@app.put(f"{PREFIX}/admin/users/{{username}}/role")
def admin_set_role(username: str, request: RoleRequest, admin: str = Depends(admin_user)):
    accounts.set_role(admin, username, request.role)
    return {"username": username, "role": request.role}


class PasswordRequest(BaseModel):
    password: str = Password


@app.put(f"{PREFIX}/admin/users/{{username}}/password")
def admin_set_password(username: str, request: PasswordRequest, admin: str = Depends(admin_user)):
    accounts.set_password(username, request.password)
    return {"changed": True}


@app.delete(f"{PREFIX}/admin/users/{{username}}")
def admin_delete_user(username: str, admin: str = Depends(admin_user)):
    """Delete the user and their uploaded files."""
    return accounts.delete_user(admin, username)


@app.get(f"{PREFIX}/admin/logins")
def admin_logins(limit: int = Query(default=1000, ge=1, le=100_000), admin: str = Depends(admin_user)):
    """Login history, newest first."""
    return accounts.logins(limit)


@app.delete(f"{PREFIX}/admin/logins")
def admin_delete_logins(before: datetime.date, admin: str = Depends(admin_user)):
    """Delete every login record older than `before` (YYYY-MM-DD)."""
    return accounts.delete_logins_before(before)


# --------------------------------------------------------------------------
# DB Management (admin)
# --------------------------------------------------------------------------
@app.get(f"{PREFIX}/admin/metrics")
def admin_metrics(admin: str = Depends(admin_user)):
    return {"metrics": accounts.metrics()}


class MetricRequest(BaseModel):
    metric: str = Field(min_length=1, max_length=100)
    description: str = Field(default="", max_length=1000)


@app.post(f"{PREFIX}/admin/metrics", status_code=201)
def admin_add_metric(request: MetricRequest, admin: str = Depends(admin_user)):
    accounts.add_metric(request.metric, request.description)
    return {"added": request.metric.strip()}


# metric names contain '/' (rkB/s): query parameters, not path segments
@app.delete(f"{PREFIX}/admin/metrics")
def admin_delete_metrics(metric: list[str] = Query(min_length=1), admin: str = Depends(admin_user)):
    return {"deleted": accounts.delete_metrics(metric)}


@app.get(f"{PREFIX}/admin/headers")
def admin_headers(admin: str = Depends(admin_user)):
    return {"headers": accounts.headers()}


class HeaderRequest(BaseModel):
    header: str = Field(min_length=1, max_length=1000)
    alias: str = Field(min_length=1, max_length=200)
    keyword: str = Field(default="", max_length=20)
    description: str = Field(default="", max_length=1000)


class HeaderUpdateRequest(HeaderRequest):
    original_header: str = Field(min_length=1, max_length=1000)


@app.post(f"{PREFIX}/admin/headers", status_code=201)
def admin_add_header(request: HeaderRequest, admin: str = Depends(admin_user)):
    accounts.add_header(request.header, request.alias, request.keyword, request.description)
    return {"added": request.alias}


@app.put(f"{PREFIX}/admin/headers")
def admin_update_header(request: HeaderUpdateRequest, admin: str = Depends(admin_user)):
    accounts.update_header(
        request.original_header, request.header, request.alias, request.keyword, request.description
    )
    return {"updated": request.alias}


@app.delete(f"{PREFIX}/admin/headers")
def admin_delete_header(header: str, admin: str = Depends(admin_user)):
    accounts.delete_header(header)
    return {"deleted": header}


# --------------------------------------------------------------------------
# Redis Management (admin)
# --------------------------------------------------------------------------
@app.get(f"{PREFIX}/admin/redis")
def admin_redis(admin: str = Depends(admin_user)):
    return accounts.redis_keys()


@app.delete(f"{PREFIX}/admin/redis/fields")
def admin_delete_redis_fields(
    key: str, field: list[str] = Query(min_length=1), admin: str = Depends(admin_user)
):
    return {"deleted": accounts.delete_redis_fields(key, field)}


# --------------------------------------------------------------------------
# files
# --------------------------------------------------------------------------
@app.get(f"{PREFIX}/files")
def list_files(username: str = Depends(current_user)):
    return {"files": data.user_files(username)}


@app.post(f"{PREFIX}/files", status_code=201)
async def upload(
    files: list[UploadFile], background: BackgroundTasks, username: str = Depends(current_user)
):
    results, errors = [], []
    for item in files:
        content = await item.read()
        try:
            uploaded = services.upload_sar_file(username, item.filename or "upload", content)
            data.forget(username, uploaded["name"])
            # parse the Overview defaults now, so the first page view is fast
            background.add_task(
                data.warm, username, uploaded["name"], services.DEFAULT_OVERVIEW_ALIASES
            )
            results.append(uploaded)
        except data.ServiceError as exc:
            errors.append({"file": item.filename, "detail": str(exc)})
    if not results and errors:
        return JSONResponse(status_code=400, content={"uploaded": [], "errors": errors})
    return {"uploaded": results, "errors": errors}


@app.delete(f"{PREFIX}/files/{{name}}")
def delete_file(name: str, username: str = Depends(current_user)):
    services.delete_sar_file(username, name)
    data.forget(username, name)
    return {"deleted": name}


@app.get(f"{PREFIX}/files/{{name}}")
def file_details(name: str, username: str = Depends(current_user)):
    return data.file_details(username, name)


# The header travels as a query parameter: as a path parameter (main API)
# aliases like "I/O and transfer rate" cannot be addressed.
@app.get(f"{PREFIX}/files/{{name}}/header")
def header_details(
    name: str,
    header: str = Query(description="Alias (e.g. 'CPU') or raw header string"),
    username: str = Depends(current_user),
):
    return data.header_details(username, name, header)


@app.get(f"{PREFIX}/files/{{name}}/series")
def series(
    name: str,
    header: str = Query(description="Alias (e.g. 'CPU') or raw header string"),
    devices: str | None = Query(
        default=None,
        description="Omitted: what the Graphical Overview shows (CPU-like: 'all', "
        "other device headers: every device). '*': every device. Or a comma list.",
    ),
    metrics: str | None = Query(default=None, description="Comma list; default all metrics"),
    start: str | None = Query(default=None, description="'HH:MM[:SS]' or ISO timestamp"),
    end: str | None = None,
    max_points: int | None = Query(
        default=None,
        ge=3,
        le=100_000,
        description="LTTB per metric, merged into one time axis: at most "
        "metrics x max_points rows per device",
    ),
    username: str = Depends(current_user),
):
    return data.series(username, name, header, devices, metrics, start, end, max_points)


@app.get(f"{PREFIX}/files/{{name}}/threshold")
def threshold(
    name: str,
    header: str,
    metric: str,
    low: float | None = Query(default=None, alias="min", description="lower bound (inclusive)"),
    high: float | None = Query(default=None, alias="max", description="upper bound (inclusive)"),
    start: str | None = None,
    end: str | None = None,
    limit: int = Query(default=500, ge=0, le=100_000, description="rows to return"),
    username: str = Depends(current_user),
):
    """Devices where low <= metric <= high ("Metrics on many devices").
    Without min/max only the value range of the metric is returned."""
    return data.threshold(username, name, header, metric, low, high, start, end, limit)


@app.get(f"{PREFIX}/files/{{name}}/statistics")
def statistics(
    name: str,
    header: str,
    devices: str | None = None,
    start: str | None = None,
    end: str | None = None,
    username: str = Depends(current_user),
):
    return data.statistics(username, name, header, devices, start, end)


@app.get(f"{PREFIX}/metrics")
def metrics(username: str = Depends(current_user)):
    """Descriptions of the sar metrics (the "man pages" of the Streamlit UI)."""
    return {"metrics": data.metric_descriptions()}


# --------------------------------------------------------------------------
# Settings (admin): the runtime-editable values of config.py
# --------------------------------------------------------------------------
@app.get(f"{PREFIX}/admin/settings")
def admin_settings(admin: str = Depends(admin_user)):
    return {"settings": accounts.settings()}


class SettingsRequest(BaseModel):
    # name -> new value; null removes the admin value (back to the environment)
    values: dict[str, str | int | bool | None]


@app.put(f"{PREFIX}/admin/settings")
def admin_update_settings(request: SettingsRequest, admin: str = Depends(admin_user)):
    return {"settings": accounts.update_settings(request.values)}
