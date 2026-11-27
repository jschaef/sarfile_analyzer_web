"""api.services.find_anomalies of sarfile_analyzer_ng.

It has no /api/v2 endpoint - the web frontend does not offer the feature - so
these tests call it directly, like test_data.py does for other ng functions.
"""

import pytest
from conftest import USER

from api import services


def anomalies(uploaded, **kwargs) -> dict:
    return services.find_anomalies(USER, uploaded, **kwargs)


def test_reports_what_it_looked_at_and_how(uploaded):
    body = anomalies(uploaded)
    assert body["file"] == uploaded
    assert body["series_checked"] > 0
    # found counts every finding, anomalies is the cut-down list
    assert body["found"] >= len(body["anomalies"])
    # the thresholds travel with the result: a caller can see what was applied
    assert body["criteria"]["spike_iqr"] == 3.0
    assert body["criteria"]["min_ratio"] == 2.0
    assert len(body["anomalies"]) <= 20


def test_findings_carry_their_numbers_and_are_ranked(uploaded):
    body = anomalies(uploaded, spike_iqr=0.5, min_ratio=1.0)
    assert body["anomalies"], "the fixture should produce at least one finding"
    for finding in body["anomalies"]:
        assert finding["kind"] in ("spike", "elevated")
        assert finding["samples"] > 0
        # judgeable without trusting the label
        assert finding["median"] is not None and finding["value"] is not None
        if finding["kind"] == "spike":
            assert finding["value"] >= finding["q3"]
            assert finding["time"]
    spikes = [f["score"] for f in body["anomalies"] if f["kind"] == "spike"]
    assert spikes == sorted(spikes, reverse=True)


def test_constant_series_are_never_checked(uploaded):
    """A metric that never moves has nothing to report, so it must not even
    reach the criteria - the fixture has several that are flat zero."""
    wide, meta = services.header_wide(USER, uploaded, "CPU")
    flat = [m for m in meta["metrics"] if wide[m].drop_nulls().min() == wide[m].drop_nulls().max()]
    assert flat, "the fixture should have at least one constant CPU metric"
    for metric in flat:
        body = anomalies(uploaded, metrics=[metric], spike_iqr=0.01, min_ratio=1.0, top=500)
        assert body["series_checked"] == 0
        assert body["anomalies"] == []


def test_metrics_narrow_the_search(uploaded):
    everything = anomalies(uploaded, top=0)["series_checked"]
    narrowed = anomalies(uploaded, metrics=["%usr"], top=0)
    assert 0 < narrowed["series_checked"] < everything


def test_headers_accept_an_alias(uploaded):
    by_alias = anomalies(uploaded, headers=["CPU"], top=0)
    assert by_alias["series_checked"] > 0
    assert by_alias["series_checked"] < anomalies(uploaded, top=0)["series_checked"]


def test_a_high_fence_silences_the_spikes(uploaded):
    loose = anomalies(uploaded, spike_iqr=0.5, min_ratio=1.0, top=500)["anomalies"]
    strict = anomalies(uploaded, spike_iqr=10_000, min_ratio=1.0, top=500)["anomalies"]
    assert any(f["kind"] == "spike" for f in loose)
    assert not any(f["kind"] == "spike" for f in strict)


def test_an_unknown_file_is_a_service_error(uploaded):
    with pytest.raises(services.ServiceError):
        anomalies("does-not-exist")
