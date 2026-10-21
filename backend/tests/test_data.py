import math

import polars as pl
import pytest
from conftest import FIXTURE, USER

import pl_helpers2 as pl_h2
from api import services
from sar_web_api import data


def get(client, auth, path, **params):
    response = client.get(path, headers=auth, params=params)
    assert response.status_code == 200, response.text
    return response.json()


def test_file_list_has_metadata(client, auth, uploaded):
    files = get(client, auth, "/api/v2/files")["files"]
    entry = next(f for f in files if f["name"] == uploaded)
    assert entry["host"] == "synthetic-host"
    assert entry["sar_date"] == "2026-10-01"


def test_file_details(client, auth, uploaded):
    info = get(client, auth, f"/api/v2/files/{uploaded}")
    assert info["host"] == "synthetic-host"
    assert info["cpu_count"] == 4
    assert len(info["timestamps"]) == 96
    assert info["restarts"] == [
        {"time": 1790856000000, "iso": "2026-10-01T12:00:00", "raw": "12:00:00 LINUX RESTART"}
    ]
    assert "CPU" in {h["alias"] for h in info["headers"]}


def test_header_with_slash_in_alias(client, auth, uploaded):
    details = get(client, auth, f"/api/v2/files/{uploaded}/header", header="I/O and transfer rate")
    assert details["metrics"] == ["tps", "rtps", "wtps", "bread/s", "bwrtn/s"]
    assert details["devices"] == []


def test_cpu_overview_series(client, auth, uploaded):
    body = get(client, auth, f"/api/v2/files/{uploaded}/series", header="CPU")
    assert body["devices"] == ["0", "1", "2", "3", "all"]
    assert body["device_count"] == 4
    assert [s["device"] for s in body["series"]] == ["all"]
    series = body["series"][0]
    assert series["rows"] == 96 and len(series["x"]) == 96
    assert set(series["values"]) == set(body["metrics"])


def test_all_devices_in_one_request(client, auth, uploaded):
    body = get(client, auth, f"/api/v2/files/{uploaded}/series", header="Block Devices")
    assert [s["device"] for s in body["series"]] == ["nvme0n1", "sda"]
    body = get(client, auth, f"/api/v2/files/{uploaded}/series", header="CPU", devices="*")
    assert [s["device"] for s in body["series"]] == ["0", "1", "2", "3", "all"]


def test_unknown_device_and_metric(client, auth, uploaded):
    url = f"/api/v2/files/{uploaded}/series"
    assert client.get(url, headers=auth, params={"header": "CPU", "devices": "99"}).status_code == 400
    assert client.get(url, headers=auth, params={"header": "CPU", "metrics": "nope"}).status_code == 400


@pytest.mark.parametrize(
    "alias,device",
    [("CPU", None), ("Load", None), ("Memory utilization", None), ("Block Devices", "sda")],
)
def test_values_match_the_main_api(client, auth, uploaded, alias, device):
    """Same numbers as sarfile_analyzer_ng's GET /files/{name}/data."""
    devices = device or None
    body = get(
        client, auth, f"/api/v2/files/{uploaded}/series", header=alias, **({"devices": devices} if devices else {})
    )
    series = body["series"][0]
    table, _ = services.get_table(USER, uploaded, alias, device=device)
    assert len(series["x"]) == len(table)
    for metric in body["metrics"]:
        expected = [round(float(v), 2) for v in table[metric]]
        assert series["values"][metric] == expected, metric


def test_time_filter(client, auth, uploaded):
    body = get(client, auth, f"/api/v2/files/{uploaded}/series", header="CPU", start="06:00", end="12:00")
    assert body["series"][0]["rows"] == 25


def test_lttb_keeps_ends_and_bounds_size(client, auth, uploaded):
    full = get(client, auth, f"/api/v2/files/{uploaded}/series", header="Load")["series"][0]
    body = get(client, auth, f"/api/v2/files/{uploaded}/series", header="Load", max_points=10)
    sampled = body["series"][0]
    assert sampled["sampled"] is True
    assert sampled["x"][0] == full["x"][0] and sampled["x"][-1] == full["x"][-1]
    assert len(sampled["x"]) <= 10 * len(body["metrics"])
    # peaks survive: the maximum of every metric is still there
    for metric in body["metrics"]:
        assert max(sampled["values"][metric]) == max(full["values"][metric])


def test_statistics_match_the_main_api(client, auth, uploaded):
    body = get(client, auth, f"/api/v2/files/{uploaded}/statistics", header="Load")
    table, _ = services.get_table(USER, uploaded, "Load")
    expected = table.describe()
    stats = body["series"][0]["statistics"]
    for metric in expected.columns:
        for stat, value in expected[metric].items():
            assert math.isclose(stats[metric][stat], float(value), rel_tol=1e-5, abs_tol=1e-6), (metric, stat)


def test_metric_descriptions(client, auth):
    metrics = get(client, auth, "/api/v2/metrics")["metrics"]
    assert "%usr" in metrics and metrics["%usr"]


def test_whitespace_normalisation_is_lossless(uploaded):
    """data._build_header_frame collapses whitespace before calling
    pl_helpers2.get_metrics_from_df - the result must be identical."""
    df = data.load(USER, uploaded)
    for header in pl_h2.get_headers(df):
        if "RESTART" in header:
            continue
        alias = services.resolve_header(df, header)[1]
        df_h = pl_h2.get_data_frames_from__headers([header], df, "header")[0]
        key = pl_h2.get_sub_device_from_header(header)
        original = pl_h2.get_metrics_from_df(df_h, header, alias, sub_device_key=key)
        normalised = df_h.with_columns(pl.col(header).str.replace_all(r"\s+", " ").str.strip_chars())
        assert original.equals(pl_h2.get_metrics_from_df(normalised, header, alias, sub_device_key=key)), alias


def test_reupload_invalidates_the_cache(client, auth, uploaded):
    before = get(client, auth, f"/api/v2/files/{uploaded}/series", header="Load")
    with FIXTURE.open("rb") as handle:
        assert client.post("/api/v2/files", headers=auth, files=[("files", ("x.txt", handle))]).status_code == 201
    after = get(client, auth, f"/api/v2/files/{uploaded}/series", header="Load")
    assert before == after


def test_duplicate_timestamps_are_reported(client, auth, tmp_path):
    """A second CPU block for 00:00:00: the first value is kept (like
    dia_compute.final_results) and the duplicate is counted."""
    lines = FIXTURE.read_text().splitlines()
    lines[0] = lines[0].replace("(synthetic-host)", "(dup-host)")
    # lines[2:8] = header + 'all' + 4 CPUs at 00:00:00
    block = [line.replace("  7.17 ", " 99.99 ") for line in lines[2:8]]
    dup_file = tmp_path / "dup.txt"
    dup_file.write_text("\n".join(lines[:8] + [""] + block + lines[8:]) + "\n")
    with dup_file.open("rb") as handle:
        response = client.post("/api/v2/files", headers=auth, files=[("files", ("dup.txt", handle))])
    name = response.json()["uploaded"][0]["name"]
    try:
        series = get(client, auth, f"/api/v2/files/{name}/series", header="CPU")["series"][0]
        assert series["duplicates"] == 1
        assert series["rows"] == 96
        assert series["values"]["%usr"][0] == 7.17
    finally:
        client.delete(f"/api/v2/files/{name}", headers=auth)


def test_delete(client, auth):
    with FIXTURE.open("rb") as handle:
        name = client.post(
            "/api/v2/files", headers=auth, files=[("files", ("y.txt", handle))]
        ).json()["uploaded"][0]["name"]
    assert client.delete(f"/api/v2/files/{name}", headers=auth).status_code == 200
    assert client.get(f"/api/v2/files/{name}", headers=auth).status_code == 404
