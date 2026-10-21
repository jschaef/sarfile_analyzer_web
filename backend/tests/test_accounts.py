import shutil
import socket
import subprocess
import time

import pytest
import sql_stuff
from conftest import FIXTURE, TEST_DB, USER, login

from sar_web_api import accounts

API = "/api/v2"


def signup(client, username, password="secret-1"):
    return client.post(f"{API}/signup", json={"username": username, "password": password})


def token_of(client, username, password="secret-1"):
    response = client.post(f"{API}/token", json={"username": username, "password": password})
    assert response.status_code == 200, response.text
    return {"Authorization": f"Bearer {response.json()['access_token']}"}


def test_writes_go_to_the_copy():
    assert sql_stuff.data_db == str(TEST_DB.resolve())


def test_info_is_public(client):
    body = client.get(f"{API}/info").json()
    assert body["code_url"].endswith("/sarfile_analyzer_ng")
    assert body["signup"] is True
    assert "admin_email" in body


def test_signup_and_login(client):
    assert signup(client, "alice").status_code == 201
    headers = token_of(client, "alice")
    assert client.get(f"{API}/users/me", headers=headers).json() == {"username": "alice", "role": "user"}
    assert signup(client, "alice").status_code == 409


def test_signup_rejects_bad_names_and_empty_passwords(client):
    for name in ["../x", ".hidden", "config", "a b"]:
        response = signup(client, name)
        assert response.status_code == 400, name
    assert signup(client, "bob", password="").status_code == 422


def test_signup_can_be_disabled(client, monkeypatch):
    monkeypatch.setenv("SAR_WEB_SIGNUP", "false")
    assert signup(client, "carol").status_code == 403
    assert client.get(f"{API}/info").json()["signup"] is False


def test_own_password_change(client):
    signup(client, "dave")
    headers = token_of(client, "dave")
    wrong = client.put(
        f"{API}/users/me/password",
        headers=headers,
        json={"current_password": "nope", "new_password": "secret-2"},
    )
    assert wrong.status_code == 403
    ok = client.put(
        f"{API}/users/me/password",
        headers=headers,
        json={"current_password": "secret-1", "new_password": "secret-2"},
    )
    assert ok.status_code == 200
    assert client.post(f"{API}/token", json={"username": "dave", "password": "secret-1"}).status_code == 401
    token_of(client, "dave", "secret-2")


def test_admin_endpoints_need_the_admin_role(client):
    signup(client, "erin")
    headers = token_of(client, "erin")
    for method, path in [
        ("get", "/admin/users"),
        ("get", "/admin/logins"),
        ("get", "/admin/metrics"),
        ("get", "/admin/headers"),
        ("get", "/admin/redis"),
        ("delete", "/admin/users/admin"),
    ]:
        assert getattr(client, method)(f"{API}{path}", headers=headers).status_code == 403, path


def test_role_change_takes_effect_without_a_new_login(client, auth):
    signup(client, "frank")
    headers = token_of(client, "frank")
    assert client.get(f"{API}/admin/users", headers=headers).status_code == 403
    response = client.put(f"{API}/admin/users/frank/role", headers=auth, json={"role": "admin"})
    assert response.status_code == 200
    assert client.get(f"{API}/admin/users", headers=headers).status_code == 200
    # an admin cannot take away their own admin role or delete themselves
    assert client.put(f"{API}/admin/users/frank/role", headers=headers, json={"role": "user"}).status_code == 400
    assert client.delete(f"{API}/admin/users/frank", headers=headers).status_code == 400
    assert client.put(f"{API}/admin/users/frank/role", headers=auth, json={"role": "boss"}).status_code == 400
    client.put(f"{API}/admin/users/frank/role", headers=auth, json={"role": "user"})
    assert client.get(f"{API}/admin/users", headers=headers).status_code == 403


def test_list_users(client, auth):
    signup(client, "gina")
    body = client.get(f"{API}/admin/users", headers=auth).json()
    assert {"username": "gina", "role": "user"} in body["users"]
    assert {"username": USER, "role": "admin"} in body["users"]
    assert body["roles"] == ["admin", "user"]
    assert body["login_count"] >= 1


def test_admin_sets_a_password(client, auth):
    signup(client, "hank")
    response = client.put(f"{API}/admin/users/hank/password", headers=auth, json={"password": "new-pw"})
    assert response.status_code == 200
    token_of(client, "hank", "new-pw")
    assert client.put(f"{API}/admin/users/nobody/password", headers=auth, json={"password": "x"}).status_code == 404


def test_delete_user_removes_files_and_sessions(client, auth):
    signup(client, "ivan")
    headers = token_of(client, "ivan")
    with FIXTURE.open("rb") as handle:
        upload = client.post(f"{API}/files", headers=headers, files=[("files", ("sar.txt", handle))])
    assert upload.status_code == 201
    response = client.delete(f"{API}/admin/users/ivan", headers=auth)
    assert response.json() == {"deleted": "ivan", "files_removed": True}
    assert not (accounts.Path(accounts.Config.upload_dir) / "ivan").exists()
    # the still valid token of the deleted user is rejected
    me = client.get(f"{API}/users/me", headers=headers)
    assert me.status_code == 401
    assert me.json()["detail"] == "User no longer exists"
    assert client.delete(f"{API}/admin/users/ivan", headers=auth).status_code == 404


def test_login_history(client, auth):
    client.post(f"{API}/token", json={"username": USER, "password": "wrong"})
    login(client)
    body = client.get(f"{API}/admin/logins?limit=5", headers=auth).json()
    assert body["total"] >= 2
    newest = body["logins"][0]
    assert newest["username"] == USER and newest["success"] is True
    assert any(entry["success"] is False for entry in body["logins"])

    # nothing is older than 2000-01-01, everything is older than 2999-01-01
    assert client.delete(f"{API}/admin/logins?before=2000-01-01", headers=auth).json()["deleted"] == 0
    cleared = client.delete(f"{API}/admin/logins?before=2999-01-01", headers=auth).json()
    # like Streamlit: an empty history is re-created with one seed record
    assert cleared["remaining"] == 1
    assert client.delete(f"{API}/admin/logins?before=yesterday", headers=auth).status_code == 422


def test_metrics_table(client, auth):
    metric = "e2e_x/s"
    response = client.post(f"{API}/admin/metrics", headers=auth, json={"metric": metric, "description": "test"})
    assert response.status_code == 201
    assert client.post(f"{API}/admin/metrics", headers=auth, json={"metric": metric}).status_code == 409
    listed = client.get(f"{API}/admin/metrics", headers=auth).json()["metrics"]
    assert {"metric": metric, "description": "test"} in listed
    # the descriptions endpoint of the analysis views sees it at once
    assert client.get(f"{API}/metrics", headers=auth).json()["metrics"][metric] == "test"

    deleted = client.delete(f"{API}/admin/metrics", headers=auth, params={"metric": [metric, "unknown"]})
    assert deleted.json() == {"deleted": [metric]}
    assert metric not in client.get(f"{API}/metrics", headers=auth).json()["metrics"]


def test_headings_table(client, auth, uploaded):
    headers = client.get(f"{API}/admin/headers", headers=auth).json()["headers"]
    load = next(h for h in headers if h["alias"] == "Load")
    original = load["header"]
    # stored with sar's column spacing, kept as it is by an update
    assert original.startswith("runq-sz  plist-sz")

    body = {**load, "alias": "Run queue", "original_header": original}
    assert client.put(f"{API}/admin/headers", headers=auth, json=body).status_code == 200
    # the cached header frames follow the new alias
    details = client.get(f"{API}/files/{uploaded}/header", headers=auth, params={"header": "Run queue"})
    assert details.status_code == 200, details.text
    assert details.json()["alias"] == "Run queue"
    client.put(f"{API}/admin/headers", headers=auth, json={**body, "alias": "Load"})
    after = client.get(f"{API}/admin/headers", headers=auth).json()["headers"]
    assert next(h for h in after if h["alias"] == "Load")["header"] == original

    new = {"header": "  foo/s   bar/s ", "alias": "Foo bar", "keyword": "", "description": "test"}
    assert client.post(f"{API}/admin/headers", headers=auth, json=new).status_code == 201
    assert client.post(f"{API}/admin/headers", headers=auth, json=new).status_code == 409
    listed = client.get(f"{API}/admin/headers", headers=auth).json()["headers"]
    assert {"header": "foo/s bar/s", "alias": "Foo bar", "keyword": "", "description": "test"} in listed
    rename = {**new, "header": original, "original_header": "foo/s bar/s"}
    assert client.put(f"{API}/admin/headers", headers=auth, json=rename).status_code == 409
    assert client.delete(f"{API}/admin/headers", headers=auth, params={"header": "foo/s bar/s"}).status_code == 200
    assert client.delete(f"{API}/admin/headers", headers=auth, params={"header": "foo/s bar/s"}).status_code == 404


def test_redis_disabled(client, auth):
    body = client.get(f"{API}/admin/redis", headers=auth).json()
    assert body == {"enabled": False, "reachable": False, "keys": []}
    response = client.delete(f"{API}/admin/redis/fields", headers=auth, params={"key": "k", "field": ["f"]})
    assert response.status_code == 400


@pytest.fixture
def redis_server(monkeypatch, tmp_path):
    """A throw-away redis-server on a free port; skipped without one."""
    binary = shutil.which("redis-server")
    if not binary:
        pytest.skip("redis-server not installed")
    with socket.socket() as probe:
        probe.bind(("127.0.0.1", 0))
        port = probe.getsockname()[1]
    process = subprocess.Popen(
        [binary, "--port", str(port), "--save", "", "--appendonly", "no", "--dir", str(tmp_path)],
        stdout=subprocess.DEVNULL,
    )
    import redis

    client = redis.Redis(port=port, decode_responses=True)
    for _ in range(50):
        try:
            client.ping()
            break
        except redis.ConnectionError:
            time.sleep(0.1)
    monkeypatch.setattr(accounts.Config, "redis_enabled", True)
    monkeypatch.setattr(accounts.Config, "redis_port", port)
    monkeypatch.setattr(accounts.redis_mng, "_redis_cache", {})
    monkeypatch.setattr(accounts.redis_mng, "_redis_disabled", False)
    yield client
    process.terminate()
    process.wait()


def test_redis_keys(client, auth, redis_server):
    redis_server.hset("admin", mapping={"file-a": "1", "file-b": "2"})
    redis_server.set("plain", "x")
    body = client.get(f"{API}/admin/redis", headers=auth).json()
    assert body["enabled"] is True and body["reachable"] is True
    assert body["keys"] == [
        {"key": "admin", "type": "hash", "fields": ["file-a", "file-b"]},
        {"key": "plain", "type": "string", "fields": []},
    ]
    response = client.delete(
        f"{API}/admin/redis/fields", headers=auth, params={"key": "admin", "field": ["file-a", "nope"]}
    )
    assert response.json() == {"deleted": 1}
    assert redis_server.hkeys("admin") == ["file-b"]
