"""Accounts and administration: users, roles, login history, the metric and
heading tables, Redis keys, the admin settings of config.py.

Every read and write goes through sarfile_analyzer_ng's own functions
(`sql_stuff`, `handle_user_status`, `sqlite2_polars`, `redis_mng`) - the code
paths of its Streamlit pages Signup, Self Service, User Management,
DB Management and Redis Management. data.db is the one of the checkout, or
SAR_WEB_DB (see bootstrap.use_database).

sql_stuff keeps one module-level SQLAlchemy session and FastAPI runs sync
endpoints in a thread pool, so every use of that session is serialized here.
"""

import datetime
import logging
import os
import shutil
import threading
from contextlib import contextmanager
from pathlib import Path

from . import bootstrap  # noqa: F401  (must come before code/ imports)

import config  # noqa: E402
import handle_user_status  # noqa: E402
import hashing  # noqa: E402
import redis_mng  # noqa: E402
import sql_stuff  # noqa: E402
import sqlite2_polars  # noqa: E402
import validation  # noqa: E402
from api import services  # noqa: E402
from api.services import ServiceError  # noqa: E402
from config import Config  # noqa: E402

from . import data  # noqa: E402

logger = logging.getLogger("sar_web_api")

CODE_URL = "https://github.com/jschaef/sarfile_analyzer_ng"
WEB_CODE_URL = "https://github.com/jschaef/sarfile_analyzer_web"


class Conflict(Exception):
    pass


class Forbidden(Exception):
    pass


class Unsupported(Exception):
    """The sarfile_analyzer_ng checkout is too old for this feature."""


_db_lock = threading.RLock()
# read-modify-write of the login history parquet files
_history_lock = threading.Lock()


@contextmanager
def _db():
    with _db_lock:
        try:
            yield sql_stuff.session
        except Exception:
            sql_stuff.session.rollback()
            raise


def signup_enabled() -> bool:
    return os.getenv("SAR_WEB_SIGNUP", "true").lower() in ("true", "1", "yes")


def info() -> dict:
    return {
        "admin_email": Config.admin_email,
        "admin_communication": Config.admin_communication,
        "code_url": CODE_URL,
        "web_code_url": WEB_CODE_URL,
        "signup": signup_enabled(),
        "max_header_count": Config.max_header_count,
    }


# --------------------------------------------------------------------------
# users
# --------------------------------------------------------------------------
def verify_password(username: str, password: str) -> bool:
    """sql_stuff.login_user, with the slow PBKDF2 check outside the lock."""
    with _db() as session:
        row = session.query(sql_stuff.User.password).filter(sql_stuff.User.username == username).first()
    stored = row[0] if row else None
    return bool(stored) and hashing.verify_password(stored, password)


def role(username: str) -> str | None:
    """The user's role, None if the user does not exist (anymore)."""
    with _db():
        return sql_stuff.get_role(username)


def record_login(username: str, success: bool) -> None:
    """Login history and counter, like the Streamlit login."""
    try:
        with _history_lock:
            handle_user_status.add_record(username, datetime.datetime.now(), success)
            if success:
                handle_user_status.increment_login_counter(username)
    except Exception:
        logger.exception("could not record the login of %s", username)


def _check_new_username(username: str) -> None:
    if not validation.is_valid_username(username):
        raise ServiceError(
            "Invalid username. Use letters, digits and . _ @ + - "
            "and start with a letter or digit."
        )
    # the upload directory holds one directory per user next to these
    if username in services.EXCLUDED_UPLOAD_DIRS:
        raise ServiceError(f"The username {username!r} is reserved")


def signup(username: str, password: str) -> dict:
    if not signup_enabled():
        raise Forbidden("Signup is disabled")
    _check_new_username(username)
    if not password:
        raise ServiceError("An empty password is not allowed")
    with _db():
        if not sql_stuff.add_userdata(username, password, "user"):
            raise Conflict(f"User {username} already exists")
    return {"username": username, "role": "user"}


def change_own_password(username: str, current: str, new: str) -> None:
    if not verify_password(username, current):
        raise Forbidden("The current password is wrong")
    set_password(username, new)


def set_password(username: str, password: str) -> None:
    if not password:
        raise ServiceError("An empty password is not allowed")
    with _db():
        if sql_stuff.get_role(username) is None:
            raise data.NotFound(f"User {username} not found")
        sql_stuff.change_password(username, password)


def users() -> dict:
    with _db():
        listed = sql_stuff.view_all_users("show")
        roles = sql_stuff.ret_all_roles()
    return {
        "users": [{"username": name, "role": user_role} for name, user_role in listed],
        "roles": roles,
        "login_count": handle_user_status.get_login_counter(),
        "login_count_excludes": handle_user_status.COUNTER_EXCLUDED_USER,
    }


def set_role(actor: str, username: str, new_role: str) -> None:
    # an admin can only lose the admin role through another admin, so there
    # is always one left
    if username == actor and new_role != "admin":
        raise ServiceError("You cannot remove your own admin role")
    with _db():
        if new_role not in sql_stuff.ret_all_roles():
            raise ServiceError(f"Unknown role {new_role!r}")
        if sql_stuff.get_role(username) is None:
            raise data.NotFound(f"User {username} not found")
        sql_stuff.modify_user(username, new_role)


def delete_user(actor: str, username: str) -> dict:
    """Delete the user and their uploads, like User Management > Delete User."""
    if username == actor:
        raise ServiceError("You cannot delete your own account")
    with _db():
        if sql_stuff.get_role(username) is None:
            raise data.NotFound(f"User {username} not found")
        sql_stuff.delete_user(username)
    removed = False
    # only names that can be an upload directory, never the shared config dir
    if validation.is_valid_username(username) and username not in services.EXCLUDED_UPLOAD_DIRS:
        directory = Path(Config.upload_dir) / username
        if directory.is_dir():
            shutil.rmtree(directory, ignore_errors=True)
            removed = True
    data.forget_user(username)
    return {"deleted": username, "files_removed": removed}


# --------------------------------------------------------------------------
# login history
# --------------------------------------------------------------------------
def logins(limit: int) -> dict:
    df = handle_user_status.get_user_status_df().sort("login_time", descending=True)
    return {
        "total": df.height,
        "logins": [
            {
                "username": row["user_name"],
                "time": row["login_time"].isoformat(timespec="seconds"),
                "success": bool(row["success"]),
            }
            for row in df.head(limit).iter_rows(named=True)
        ],
    }


def delete_logins_before(day: datetime.date) -> dict:
    """User Management > Login History > Delete Login Times."""
    with _history_lock:
        df = handle_user_status.get_user_status_df()
        result = handle_user_status.remove_old_logins(df, day)
        deleted = df.height - result.height
        if result.is_empty():
            result = handle_user_status.create_user_status_df()
        handle_user_status.write_df_to_file(result)
    return {"deleted": deleted, "remaining": result.height}


# --------------------------------------------------------------------------
# metric and heading tables (DB Management)
# --------------------------------------------------------------------------
def metrics() -> list[dict]:
    table = sqlite2_polars.get_table_df("metric").sort("metric")
    return [
        {"metric": row["metric"], "description": row["description"] or ""}
        for row in table.select("metric", "description").iter_rows(named=True)
    ]


def add_metric(metric: str, description: str) -> None:
    metric = metric.strip()
    if not metric:
        raise ServiceError("The metric name is empty")
    with _db() as session:
        if session.query(sql_stuff.Metrics).filter(sql_stuff.Metrics.metric == metric).first():
            raise Conflict(f"Metric {metric} already exists")
        sql_stuff.add_metric(metric, description.strip())
    sqlite2_polars.invalidate_table_cache("metric")


def delete_metrics(names: list[str]) -> list[str]:
    deleted = []
    with _db() as session:
        for metric in names:
            if session.query(sql_stuff.Metrics).filter(sql_stuff.Metrics.metric == metric).first():
                sql_stuff.delete_metric(metric)
                deleted.append(metric)
    if deleted:
        sqlite2_polars.invalidate_table_cache("metric")
    return deleted


def headers() -> list[dict]:
    table = sqlite2_polars.get_table_df("headingstable").sort("alias", "header")
    return [
        {
            "header": row["header"],
            "alias": row["alias"] or "",
            "keyword": row["keywd"] or "",
            "description": row["description"] or "",
        }
        for row in table.iter_rows(named=True)
    ]


def _header_exists(session, header: str) -> bool:
    return session.query(sql_stuff.Headings).filter(sql_stuff.Headings.header == header).first() is not None


def _clean_header(header: str, alias: str, normalize: bool) -> tuple[str, str]:
    # sql_stuff.add_header normalizes whitespace, update_header keeps the text
    # as it is (the seed headers keep sar's column spacing)
    header = " ".join(header.split()) if normalize else header.strip()
    alias = alias.strip()
    if not header or not alias:
        raise ServiceError("Header and alias are required")
    return header, alias


def _headings_changed() -> None:
    sqlite2_polars.invalidate_table_cache("headingstable")
    data.forget_headings()


def add_header(header: str, alias: str, keyword: str, description: str) -> None:
    header, alias = _clean_header(header, alias, normalize=True)
    with _db() as session:
        if _header_exists(session, header):
            raise Conflict("This header already exists")
        sql_stuff.add_header(header, description.strip(), alias, keyword.strip() or None)
    _headings_changed()


def update_header(original: str, header: str, alias: str, keyword: str, description: str) -> None:
    header, alias = _clean_header(header, alias, normalize=False)
    with _db() as session:
        if not _header_exists(session, original):
            raise data.NotFound("Header not found")
        if header != original and _header_exists(session, header):
            raise Conflict("Another heading already has this header")
        sql_stuff.update_header(
            original,
            header=header,
            alias=alias,
            description=description.strip(),
            keyword=keyword.strip() or None,
        )
    _headings_changed()


def delete_header(header: str) -> None:
    with _db() as session:
        if not _header_exists(session, header):
            raise data.NotFound("Header not found")
        sql_stuff.delete_header(header)
    _headings_changed()


# --------------------------------------------------------------------------
# Redis (Redis Management)
# --------------------------------------------------------------------------
MAX_REDIS_KEYS = 1000


def redis_keys() -> dict:
    rs = redis_mng.get_rs()
    result = {"enabled": bool(Config.redis_enabled), "reachable": rs is not None, "keys": []}
    if rs is None:
        return result
    try:
        for key in rs.scan_iter("*", count=500):
            kind = rs.type(key)
            entry = {"key": key, "type": kind, "fields": []}
            if kind == "hash":
                entry["fields"] = sorted(rs.hkeys(key))
            result["keys"].append(entry)
            if len(result["keys"]) >= MAX_REDIS_KEYS:
                result["truncated"] = True
                break
    except Exception as exc:  # e.g. connection lost after the first ping
        raise ServiceError(f"Redis error: {exc}")
    result["keys"].sort(key=lambda e: e["key"])
    return result


def delete_redis_fields(key: str, fields: list[str]) -> int:
    rs = redis_mng.get_rs()
    if rs is None:
        raise ServiceError("Redis is not available")
    if not fields:
        return 0
    try:
        return int(rs.hdel(key, *fields))
    except Exception as exc:
        raise ServiceError(f"Redis error: {exc}")


# --------------------------------------------------------------------------
# admin settings (config.py: values stored in $UPLOAD_DIR/config/settings.json
# take precedence over the environment)
# --------------------------------------------------------------------------
def _settings_support() -> None:
    if not hasattr(config, "EDITABLE_SETTINGS"):
        raise Unsupported("Settings need a newer sarfile_analyzer_ng (config.EDITABLE_SETTINGS)")


def settings() -> list[dict]:
    _settings_support()
    stored = config.stored_settings()
    result = []
    for name, (kind, env_var, low, high) in config.EDITABLE_SETTINGS.items():
        secret = name in config.SECRET_SETTINGS
        value = getattr(Config, name)
        if name in stored:
            source = "admin"
        elif env_var in os.environ:
            source = "environment"
        else:
            source = "default"
        result.append(
            {
                "name": name,
                "type": kind.__name__,
                "min": low,
                "max": high,
                "env_var": env_var,
                "source": source,
                "secret": secret,
                # a secret is never sent back, only whether one is set
                "value": bool(value) if secret else value,
            }
        )
    return result


def update_settings(changes: dict) -> list[dict]:
    """Store settings; None removes the admin value (back to the environment)."""
    _settings_support()
    try:
        config.update_settings(changes)
    except ValueError as exc:
        raise ServiceError(str(exc))
    return settings()
