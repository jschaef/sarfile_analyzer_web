import time

from conftest import PASSWORD, USER, login

from sar_web_api import auth


def test_login_and_me(client):
    headers = login(client)
    assert client.get("/api/v2/users/me", headers=headers).json() == {"username": USER, "role": "admin"}


def test_wrong_password(client):
    response = client.post("/api/v2/token", json={"username": USER, "password": PASSWORD + "x"})
    assert response.status_code == 401


def test_missing_and_tampered_token(client):
    assert client.get("/api/v2/files").status_code == 401
    token = login(client)["Authorization"].removeprefix("Bearer ")
    payload, signature = token.rsplit(".", 1)
    forged = f"{payload}.{'0' * len(signature)}"
    assert client.get("/api/v2/files", headers={"Authorization": f"Bearer {forged}"}).status_code == 401


def test_expired_token(client):
    token = auth.create_token(USER, ttl=-1)["access_token"]
    response = client.get("/api/v2/files", headers={"Authorization": f"Bearer {token}"})
    assert response.status_code == 401
    assert response.json()["detail"] == "Token expired"


def test_main_api_token_is_rejected(client):
    # a token of sarfile_analyzer_ng's API: base64(user|expiry|purpose).hmac
    import base64

    legacy = base64.urlsafe_b64encode(f"{USER}|{int(time.time()) + 60}|api".encode()).decode()
    response = client.get("/api/v2/files", headers={"Authorization": f"Bearer {legacy}.abc"})
    assert response.status_code == 401


def test_logout_revokes_the_token(client):
    headers = login(client)
    other = login(client)
    assert client.post("/api/v2/logout", headers=headers).status_code == 200
    response = client.get("/api/v2/users/me", headers=headers)
    assert response.status_code == 401
    assert response.json()["detail"] == "Token revoked"
    # only that session ends
    assert client.get("/api/v2/users/me", headers=other).status_code == 200


def test_revocation_survives_a_new_store(client, tmp_path):
    store = auth.RevocationStore(tmp_path / "revoked.sqlite")
    session = auth.decode_token(auth.create_token(USER)["access_token"])
    store.revoke(session)
    assert auth.RevocationStore(tmp_path / "revoked.sqlite").is_revoked(session.jti)


def test_expired_revocations_are_pruned(tmp_path):
    store = auth.RevocationStore(tmp_path / "revoked.sqlite")
    old = auth.Session(USER, "old", int(time.time()) - 10)
    store.revoke(old)
    store.revoke(auth.Session(USER, "new", int(time.time()) + 60))
    assert not store.is_revoked("old")
    assert store.is_revoked("new")
