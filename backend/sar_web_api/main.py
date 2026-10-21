"""sar-web-api: the API the Next.js frontend talks to (prefix /api/v2).

Run from backend/ (needs the sarfile_analyzer_ng checkout and its venv):
    SAR_BACKEND_DIR=../../sarfile_analyzer_ng UPLOAD_DIR=... SAR_WEB_API_SECRET=... \
        uvicorn sar_web_api.main:app --host 127.0.0.1 --port 8200

Shares users (code/data.db, read-only) and files (UPLOAD_DIR) with the main
API of sarfile_analyzer_ng, which keeps running unchanged on its own port.
"""

import logging

from fastapi import BackgroundTasks, Depends, FastAPI, HTTPException, Query, UploadFile
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from . import bootstrap  # noqa: F401  (must come before code/ imports)

import sql_stuff  # noqa: E402
from api import services  # noqa: E402

from . import data  # noqa: E402
from .auth import Session, create_token, current_session, current_user, revocations  # noqa: E402

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
    if not sql_stuff.login_user(request.username, request.password):
        raise HTTPException(status_code=401, detail="Invalid username or password")
    return create_token(request.username)


@app.post(f"{PREFIX}/logout")
def logout(session: Session = Depends(current_session)):
    """Revoke the presented token; it is rejected from now on."""
    revocations().revoke(session)
    return {"revoked": True}


@app.get(f"{PREFIX}/users/me")
def me(username: str = Depends(current_user)):
    return {"username": username, "role": sql_stuff.get_role(username)}


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
