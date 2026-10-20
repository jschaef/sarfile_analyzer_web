"""Largest-Triangle-Three-Buckets down-sampling (Steinarsson 2013)."""

import numpy as np


def lttb_indices(x: np.ndarray, y: np.ndarray, threshold: int) -> np.ndarray:
    """Indices of the points LTTB keeps; always includes first and last.

    NaN values are treated as 0 for the area computation, so gaps never break
    the selection (the caller keeps NaN in the output).
    """
    n = len(x)
    if threshold >= n or threshold < 3:
        return np.arange(n)
    x = x.astype(np.float64)
    y = np.nan_to_num(y.astype(np.float64))
    keep = np.empty(threshold, dtype=np.int64)
    keep[0] = 0
    keep[-1] = n - 1
    # bucket edges for the n-2 inner points
    edges = np.linspace(1, n - 1, threshold - 1).astype(np.int64)
    a = 0
    for i in range(threshold - 2):
        start, end = edges[i], edges[i + 1]
        next_start, next_end = edges[i + 1], edges[i + 2] if i + 2 < len(edges) else n
        if next_start >= next_end:
            next_start, next_end = n - 1, n
        avg_x = x[next_start:next_end].mean()
        avg_y = y[next_start:next_end].mean()
        bucket_x = x[start:end]
        bucket_y = y[start:end]
        area = np.abs(
            (x[a] - avg_x) * (bucket_y - y[a]) - (x[a] - bucket_x) * (avg_y - y[a])
        )
        a = start + int(area.argmax())
        keep[i + 1] = a
    return keep


def union_indices(x: np.ndarray, columns: list[np.ndarray], threshold: int) -> np.ndarray:
    """LTTB per column, merged into one shared, sorted index set.

    All metrics of a chart share one time axis; taking the union keeps every
    column's peaks at the cost of up to len(columns) * threshold points.
    """
    if len(x) <= threshold:
        return np.arange(len(x))
    picked = [lttb_indices(x, column, threshold) for column in columns]
    return np.unique(np.concatenate(picked)) if picked else np.arange(len(x))
