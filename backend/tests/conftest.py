"""Test setup: isolated UPLOAD_DIR and state dir, the checked-in small fixture.

Needs the sarfile_analyzer_ng checkout (SAR_BACKEND_DIR, default
../../sarfile_analyzer_ng relative to this directory's repo) and its venv.
Uses the seed login admin/password from that checkout's code/data.db
(read-only).
"""

import os
import sys
import tempfile
from pathlib import Path

import pytest

_TMP = Path(tempfile.mkdtemp(prefix="sar-web-api-tests-"))
os.environ["UPLOAD_DIR"] = str(_TMP / "upload")
os.environ["SAR_WEB_STATE_DIR"] = str(_TMP / "state")
os.environ["SAR_WEB_API_SECRET"] = "test-secret"
os.environ["REDIS_ENABLED"] = "false"

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from fastapi.testclient import TestClient  # noqa: E402

from sar_web_api.main import app  # noqa: E402

FIXTURE = Path(__file__).resolve().parents[2] / "e2e" / "fixtures" / "sar_small.txt"
USER, PASSWORD = "admin", "password"


@pytest.fixture(scope="session")
def client() -> TestClient:
    return TestClient(app)


def login(client: TestClient) -> dict:
    response = client.post("/api/v2/token", json={"username": USER, "password": PASSWORD})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


@pytest.fixture(scope="session")
def auth(client: TestClient) -> dict:
    return login(client)


@pytest.fixture(scope="session")
def uploaded(client: TestClient, auth: dict) -> str:
    with FIXTURE.open("rb") as handle:
        response = client.post(
            "/api/v2/files", headers=auth, files=[("files", ("sar_small.txt", handle))]
        )
    assert response.status_code == 201, response.text
    return response.json()["uploaded"][0]["name"]
