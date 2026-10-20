"""Session tokens with server-side revocation.

Tokens are HMAC-signed like the main API's, but with this service's own secret
(SAR_WEB_API_SECRET) and a token id (jti). Logging out stores the jti in a
small SQLite denylist until the token would have expired anyway, so a copied
token stops working immediately - also after a restart of the service.

Because the secret differs, these tokens are useless against the main API
(and vice versa): revocation cannot be bypassed by switching APIs.
"""

import base64
import hashlib
import hmac
import json
import logging
import os
import secrets
import sqlite3
import threading
import time
from dataclasses import dataclass
from pathlib import Path

from fastapi import Depends, HTTPException
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

logger = logging.getLogger("sar_web_api")

TOKEN_TTL_SECONDS = int(os.getenv("SAR_WEB_API_TOKEN_TTL", 12 * 3600))
_SECRET = os.getenv("SAR_WEB_API_SECRET") or ""
if not _SECRET:
    _SECRET = secrets.token_hex(32)
    logger.warning("SAR_WEB_API_SECRET not set - tokens will not survive a restart")

_bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class Session:
    username: str
    jti: str
    expires_at: int


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).decode().rstrip("=")


def _unb64(text: str) -> bytes:
    return base64.urlsafe_b64decode(text + "=" * (-len(text) % 4))


def _sign(payload: str) -> str:
    return hmac.new(_SECRET.encode(), payload.encode(), hashlib.sha256).hexdigest()


def create_token(username: str, ttl: int | None = None) -> dict:
    expires_at = int(time.time()) + (TOKEN_TTL_SECONDS if ttl is None else ttl)
    claims = {"sub": username, "exp": expires_at, "jti": secrets.token_urlsafe(16), "typ": "web"}
    payload = _b64(json.dumps(claims, separators=(",", ":")).encode())
    return {
        "access_token": f"{payload}.{_sign(payload)}",
        "token_type": "bearer",
        "expires_at": expires_at,
    }


def decode_token(token: str) -> Session:
    try:
        payload, signature = token.rsplit(".", 1)
    except ValueError:
        raise HTTPException(status_code=401, detail="Malformed token")
    if not hmac.compare_digest(_sign(payload), signature):
        raise HTTPException(status_code=401, detail="Invalid token signature")
    try:
        claims = json.loads(_unb64(payload))
        session = Session(str(claims["sub"]), str(claims["jti"]), int(claims["exp"]))
    except (ValueError, KeyError, TypeError):
        raise HTTPException(status_code=401, detail="Malformed token")
    if claims.get("typ") != "web":
        raise HTTPException(status_code=401, detail="Wrong token type")
    if session.expires_at < time.time():
        raise HTTPException(status_code=401, detail="Token expired")
    return session


class RevocationStore:
    """jti denylist in SQLite; entries are dropped once the token expired."""

    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self._path = str(path)
        self._lock = threading.Lock()
        with self._connect() as db:
            db.execute(
                "CREATE TABLE IF NOT EXISTS revoked (jti TEXT PRIMARY KEY, expires_at INTEGER NOT NULL)"
            )

    def _connect(self) -> sqlite3.Connection:
        return sqlite3.connect(self._path, timeout=10)

    def revoke(self, session: Session) -> None:
        with self._lock, self._connect() as db:
            db.execute(
                "INSERT OR IGNORE INTO revoked (jti, expires_at) VALUES (?, ?)",
                (session.jti, session.expires_at),
            )
            db.execute("DELETE FROM revoked WHERE expires_at < ?", (int(time.time()),))

    def is_revoked(self, jti: str) -> bool:
        with self._connect() as db:
            return db.execute("SELECT 1 FROM revoked WHERE jti = ?", (jti,)).fetchone() is not None


def _default_state_dir() -> Path:
    # next to the main API's shared state in UPLOAD_DIR/config (excluded from
    # the admin cleanup there), so it lives on the same persistent volume
    from config import Config

    return Path(Config.upload_dir) / "config" / "sar-web-api"


_store: RevocationStore | None = None


def revocations() -> RevocationStore:
    global _store
    if _store is None:
        state_dir = Path(os.getenv("SAR_WEB_STATE_DIR") or _default_state_dir())
        _store = RevocationStore(state_dir / "revoked.sqlite")
    return _store


def current_session(
    credentials: HTTPAuthorizationCredentials | None = Depends(_bearer),
) -> Session:
    if credentials is None:
        raise HTTPException(
            status_code=401, detail="Missing bearer token", headers={"WWW-Authenticate": "Bearer"}
        )
    session = decode_token(credentials.credentials)
    if revocations().is_revoked(session.jti):
        raise HTTPException(status_code=401, detail="Token revoked")
    return session


def current_user(session: Session = Depends(current_session)) -> str:
    return session.username
