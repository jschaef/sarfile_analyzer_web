from conftest import FIXTURE


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


def test_header_without_devices_is_rejected(client, auth, uploaded):
    response = client.get(
        f"/api/v2/files/{uploaded}/threshold", headers=auth, params={"header": "Load", "metric": "ldavg-1"}
    )
    assert response.status_code == 400
