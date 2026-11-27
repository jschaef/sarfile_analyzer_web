import pytest
from conftest import FIXTURE, USER

from api import services


def get(client, auth, path, **params):
    response = client.get(path, headers=auth, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def cpu_usr_values() -> list[tuple[str, str, float]]:
    """(time, device, %usr) straight from the fixture text."""
    rows = []
    for line in FIXTURE.read_text().splitlines():
        parts = line.split()
        # time, device and 10 CPU columns
        if len(parts) == 12 and parts[0].count(":") == 2 and parts[1] != "CPU":
            rows.append((parts[0], parts[1], float(parts[2])))
    return rows


def test_range_only_without_bounds(client, auth, uploaded):
    body = get(client, auth, f"/api/v2/files/{uploaded}/threshold", header="CPU", metric="%usr")
    values = [v for _, _, v in cpu_usr_values()]
    assert body["value_min"] == min(values)
    assert body["value_max"] == max(values)
    assert "matches" not in body


def test_matches_per_device(client, auth, uploaded):
    body = get(
        client, auth, f"/api/v2/files/{uploaded}/threshold", header="CPU", metric="%usr", min=40, max=60
    )
    expected = [(t, d, v) for t, d, v in cpu_usr_values() if 40 <= v <= 60]
    assert body["matches"] == len(expected)
    counts = {d["device"]: d["count"] for d in body["devices"]}
    for _, device, _ in expected:
        counts[device] -= 1
    assert set(counts.values()) == {0}
    # natural order: 'all' first, then CPUs numerically
    order = [d["device"] for d in body["devices"]]
    assert order == sorted(order, key=lambda d: (d != "all", int(d) if d.isdigit() else 0))
    assert all(40 <= row["value"] <= 60 for row in body["rows"])
    # rows: by time, and within a timestamp in the same natural device order
    first_time = body["rows"][0]["time"]
    same_time = [r["device"] for r in body["rows"] if r["time"] == first_time]
    assert same_time == sorted(same_time, key=lambda d: (d != "all", int(d) if d.isdigit() else 0))


def test_time_window_and_limit(client, auth, uploaded):
    url = f"/api/v2/files/{uploaded}/threshold"
    body = get(client, auth, url, header="CPU", metric="%usr", min=0, max=100, start="06:00", end="06:45", limit=3)
    # 4 samples (06:00, 06:15, 06:30, 06:45) x 5 devices (all + 4 CPUs)
    assert body["matches"] == 20
    assert body["rows_returned"] == 3
    assert len(body["rows"]) == 3


def test_no_match_inside_the_time_window(client, auth, uploaded):
    url = f"/api/v2/files/{uploaded}/threshold"
    rows = cpu_usr_values()
    first = rows[0][0]
    # above every value of the first sample, but hit later in the file
    low = max(v for t, _, v in rows if t == first) + 0.01
    assert any(v >= low for _, _, v in rows)
    body = get(client, auth, url, header="CPU", metric="%usr", min=low, start=first, end=first)
    assert body["matches"] == 0
    assert body["devices"] == [] and body["rows"] == []
    # a window without any samples is still an error
    response = client.get(
        url, headers=auth, params={"header": "CPU", "metric": "%usr", "min": 0, "start": "23:59:59"}
    )
    assert response.status_code == 400
    assert "empty data set" in response.text


def test_header_without_devices_is_rejected(client, auth, uploaded):
    response = client.get(
        f"/api/v2/files/{uploaded}/threshold", headers=auth, params={"header": "Load", "metric": "ldavg-1"}
    )
    assert response.status_code == 400


# ---------------------------------------------------------------------------
# api.services.metric_range of sarfile_analyzer_ng: what /api/v1 and the MCP
# server reach and this view does not. The computation is shared - the tests
# above pin that /api/v2 keeps behaving as before.
# ---------------------------------------------------------------------------
def test_shared_function_handles_a_header_without_devices(uploaded):
    """Load has no sub-devices; /api/v2 rejects it (see above), the shared
    function reports the single series with device null - that is how an agent
    asks about ldavg-1."""
    body = services.threshold(USER, uploaded, "Load", "ldavg-1")
    assert body["alias"] == "Load"
    assert body["value_min"] <= body["value_max"]
    assert "matches" not in body

    hits = services.threshold(USER, uploaded, "Load", "ldavg-1", low=body["value_max"])
    assert hits["matches"] >= 1
    assert [d["device"] for d in hits["devices"]] == [None]
    assert hits["devices"][0]["peak"] == body["value_max"]


def test_shared_function_keeps_every_cpu(uploaded):
    """prepare_header_frames collapses CPU-like headers to 'all'; the search
    across devices must see each CPU."""
    body = services.threshold(USER, uploaded, "CPU", "%usr", low=0)
    devices = {d["device"] for d in body["devices"]}
    assert "all" in devices
    assert {"0", "1", "2", "3"} <= devices


def test_shared_function_agrees_with_the_v2_endpoint(client, auth, uploaded):
    """Same numbers on both paths - they share the computation, this catches a
    caller that drifts (a changed default, a lost sort)."""
    v2 = get(
        client, auth, f"/api/v2/files/{uploaded}/threshold",
        header="CPU", metric="%usr", min=40, max=60,
    )
    shared = services.threshold(USER, uploaded, "CPU", "%usr", low=40, high=60)
    assert shared["matches"] == v2["matches"]
    assert shared["devices"] == v2["devices"]
    assert shared["rows"] == v2["rows"]


def test_shared_function_rejects_an_unknown_metric(uploaded):
    with pytest.raises(services.ServiceError) as error:
        services.threshold(USER, uploaded, "CPU", "%nonsense")
    assert "%nonsense" in str(error.value)
