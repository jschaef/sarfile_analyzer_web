import numpy as np

from sar_web_api.lttb import lttb_indices, union_indices


def test_short_input_is_untouched():
    x = np.arange(5)
    assert lttb_indices(x, x * 2.0, 10).tolist() == [0, 1, 2, 3, 4]


def test_size_ends_and_order():
    x = np.arange(1000)
    y = np.sin(x / 20.0)
    keep = lttb_indices(x, y, 50)
    assert len(keep) == 50
    assert keep[0] == 0 and keep[-1] == 999
    assert np.all(np.diff(keep) > 0)


def test_keeps_a_single_spike():
    x = np.arange(10_000)
    y = np.zeros(10_000)
    y[4321] = 100.0
    assert 4321 in lttb_indices(x, y, 100)


def test_nan_does_not_break_selection():
    x = np.arange(100)
    y = np.ones(100)
    y[10:20] = np.nan
    keep = lttb_indices(x, y, 10)
    assert len(keep) == 10


def test_union_shares_one_axis():
    x = np.arange(1000)
    a = np.zeros(1000)
    a[100] = 5
    b = np.zeros(1000)
    b[900] = 5
    keep = union_indices(x, [a, b], 20)
    assert 100 in keep and 900 in keep
    assert len(keep) <= 40
