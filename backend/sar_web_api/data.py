"""Columnar, cached data access on top of sarfile_analyzer_ng's parser.

Parsing and header/alias semantics come from the main project (`api.services`,
`pl_helpers2`, `sqlite2_polars`); this module only adds what the main API
lacks: per-file and per-header caching, all devices of a header in one pass,
column-oriented output with clean rounding, optional LTTB down-sampling,
structured restarts and the list of sample timestamps.
"""

import os
import re
import threading
from collections import OrderedDict
from dataclasses import dataclass
from functools import cached_property
from typing import Callable, Hashable, TypeVar

import numpy as np
import pandas as pd
import polars as pl

from . import bootstrap  # noqa: F401  (must come before code/ imports)

import pl_helpers2 as pl_h2  # noqa: E402
import sqlite2_polars  # noqa: E402
from api import services  # noqa: E402
from api.services import ServiceError  # noqa: E402

from .lttb import union_indices  # noqa: E402

T = TypeVar("T")


class NotFound(Exception):
    pass


class _LRU:
    """Small thread-safe LRU; values are computed outside the lock."""

    def __init__(self, size: int):
        self.size = max(1, size)
        self._data: OrderedDict[Hashable, object] = OrderedDict()
        self._lock = threading.Lock()

    def get_or_compute(self, key: Hashable, compute: Callable[[], T]) -> T:
        with self._lock:
            if key in self._data:
                self._data.move_to_end(key)
                return self._data[key]  # type: ignore[return-value]
        value = compute()
        with self._lock:
            self._data[key] = value
            self._data.move_to_end(key)
            while len(self._data) > self.size:
                self._data.popitem(last=False)
        return value

    def drop(self, predicate: Callable[[Hashable], bool]) -> None:
        with self._lock:
            for key in [k for k in self._data if predicate(k)]:
                del self._data[key]


# A parsed 1M-row file is a few hundred MB in memory - keep the caches small.
_files = _LRU(int(os.getenv("SAR_WEB_CACHE_FILES", 2)))
_headers = _LRU(int(os.getenv("SAR_WEB_CACHE_HEADERS", 16)))


def _version(username: str, name: str) -> tuple[str, str, int]:
    """(user, file, mtime) - a re-upload changes the mtime and the cache key."""
    name = services._validate_file_name(name)
    directory = services.user_dir(username)
    for candidate in (directory / f"{name}.parquet", directory / name):
        try:
            return username, name, candidate.stat().st_mtime_ns
        except FileNotFoundError:
            continue
    raise NotFound(f"File {name} not found")


def forget(username: str, name: str) -> None:
    _files.drop(lambda key: key[:2] == (username, name))
    _headers.drop(lambda key: key[:2] == (username, name))


def forget_user(username: str) -> None:
    _files.drop(lambda key: key[0] == username)
    _headers.drop(lambda key: key[0] == username)


def forget_headings() -> None:
    """Header/alias resolution depends on the headings table."""
    _headers.drop(lambda key: True)


def load(username: str, name: str) -> pl.DataFrame:
    key = _version(username, name)
    return _files.get_or_compute(key, lambda: services.load_df(username, name))


@dataclass(frozen=True)
class HeaderFrame:
    header: str
    alias: str
    metrics: list[str]
    devices: list[str]  # empty when the header has no sub-devices
    cpu_like: bool
    wide: pl.DataFrame  # date, [sub_device], one Float64 column per metric

    @property
    def device_count(self) -> int:
        """Number of real devices; CPU-like headers also carry an 'all' row."""
        return len([d for d in self.devices if d != "all"])

    @cached_property
    def by_device(self) -> dict[str, pl.DataFrame]:
        """One frame per device, split once: filtering 1M rows per device for
        hundreds of CPUs would cost seconds on every request."""
        if not self.devices:
            return {}
        parts = self.wide.partition_by("sub_device", as_dict=True, include_key=False)
        return {str(key[0]): frame for key, frame in parts.items()}

    def overview_devices(self) -> list[str | None]:
        """What the Graphical Overview shows (dia_compute.prepare_df_for_pandas)."""
        if not self.devices:
            return [None]
        if self.cpu_like and "all" in self.devices:
            return ["all"]
        return list(self.devices)


def _build_header_frame(username: str, name: str, header: str, alias: str) -> HeaderFrame:
    df = load(username, name)
    df_h = pl_h2.get_data_frames_from__headers([header], df, "header")[0]
    sub_device_key = pl_h2.get_sub_device_from_header(header)
    # parse_into_polars collapses only the first whitespace run per line, so
    # get_metrics_from_df splits sar's column padding into ~5x more (empty)
    # tokens than values and spends most of its time casting them. Collapsing
    # whitespace first gives identical output ~8x faster (tests/test_parsing.py).
    df_h = df_h.with_columns(pl.col(header).str.replace_all(r"\s+", " ").str.strip_chars())
    parsed = pl_h2.get_metrics_from_df(df_h, header, alias, sub_device_key=sub_device_key)
    metrics = header.split()
    has_devices = "sub_device" in parsed.columns
    columns = [pl.col("date")]
    if has_devices:
        columns.append(pl.col("sub_device").cast(pl.String))
    columns += [
        pl.col(header).list.get(i, null_on_oob=True).cast(pl.Float64).round(2).alias(metric)
        for i, metric in enumerate(metrics)
    ]
    wide = parsed.select(columns).sort("date", maintain_order=True)
    devices = sorted(wide["sub_device"].unique().to_list()) if has_devices else []
    return HeaderFrame(
        header=header,
        alias=alias,
        metrics=metrics,
        devices=[str(d) for d in devices],
        cpu_like=bool(services._CPU_LIKE.search(alias)),
        wide=wide,
    )


def warm(username: str, name: str, aliases: list[str]) -> None:
    """Parse the given headers into the cache (after an upload)."""
    for alias in aliases:
        try:
            header_frame(username, name, alias)
        except (ServiceError, NotFound):
            continue


def header_frame(username: str, name: str, header_or_alias: str) -> HeaderFrame:
    df = load(username, name)
    header, alias = services.resolve_header(df, header_or_alias)
    key = (*_version(username, name), header)
    return _headers.get_or_compute(key, lambda: _build_header_frame(username, name, header, alias))


# --------------------------------------------------------------------------
# file details
# --------------------------------------------------------------------------
_HOST = re.compile(r"\(([^)]+)\)")
_CPUS = re.compile(r"\((\d+)\s+CPU\)")
_TIME = re.compile(r"\b(\d{1,2}):(\d{2}):(\d{2})\b")


def _epoch_ms(column: pl.Series) -> list[int]:
    return column.dt.epoch("ms").to_list()


def parse_restart(raw: str, day: pd.Timestamp) -> dict:
    """Restart line -> timestamp. parse_into_polars appends the time as the last
    token; the AM/PM marker (12-hour sar output) is only in the line itself."""
    hours = minutes = seconds = 0
    matches = _TIME.findall(raw)
    if matches:
        hours, minutes, seconds = (int(v) for v in matches[-1])
    upper = raw.upper()
    if " PM" in upper and hours < 12:
        hours += 12
    elif " AM" in upper and hours == 12:
        hours = 0
    moment = day.normalize() + pd.Timedelta(hours=hours, minutes=minutes, seconds=seconds)
    return {
        "time": int(moment.value // 1_000_000),
        "iso": moment.strftime("%Y-%m-%dT%H:%M:%S"),
        "raw": " ".join(raw.split()[:3]),
    }


def file_details(username: str, name: str) -> dict:
    df = load(username, name)
    info = services.file_info(df)
    os_details = info["os_details"]
    host = _HOST.search(os_details)
    cpus = _CPUS.search(os_details)
    dates = df["date"]
    first = pd.Timestamp(dates.min())
    headers = []
    for entry in info["headers"]:
        headers.append(
            {
                "header": entry["header"],
                "alias": entry["alias"],
                "metrics": entry["metrics"],
                # per-device data (CPU, DEV, IFACE, ...) - same lookup the
                # "Metrics on many devices" page of the UI filters with
                "has_devices": bool(pl_h2.get_sub_device_from_header(entry["header"])),
            }
        )
    return {
        "name": name,
        "os_details": os_details,
        "host": host.group(1) if host else None,
        "cpu_count": int(cpus.group(1)) if cpus else None,
        "start": info["start"],
        "end": info["end"],
        "restarts": [parse_restart(r, first) for r in pl_h2.get_restart_headers(df)],
        # every sample time of the file (union over all headers) for the
        # start/end pickers - what Streamlit's translate_dates_into_list offers
        "timestamps": _epoch_ms(dates.unique().sort()),
        "headers": headers,
    }


def header_details(username: str, name: str, header_or_alias: str) -> dict:
    frame = header_frame(username, name, header_or_alias)
    dates = frame.wide["date"]
    return {
        "header": frame.header,
        "alias": frame.alias,
        "metrics": frame.metrics,
        "devices": frame.devices,
        "device_count": frame.device_count,
        "cpu_like": frame.cpu_like,
        "overview_devices": frame.overview_devices(),
        "start": str(dates.min()),
        "end": str(dates.max()),
        "timestamps": _epoch_ms(dates.unique().sort()),
    }


# --------------------------------------------------------------------------
# series / statistics
# --------------------------------------------------------------------------
def _select_devices(frame: HeaderFrame, devices: str | None) -> list[str | None]:
    """None -> overview default; '*' -> every device; 'a,b' -> those."""
    if devices is None or devices == "":
        return frame.overview_devices()
    if not frame.devices:
        raise ServiceError(f"Header {frame.alias!r} has no devices")
    if devices == "*":
        return list(frame.devices)
    wanted = [d.strip() for d in devices.split(",") if d.strip()]
    unknown = [d for d in wanted if d not in frame.devices]
    if unknown:
        raise ServiceError(f"Unknown device(s) {unknown} for {frame.alias!r}; available: {frame.devices}")
    return wanted


def _device_rows(frame: HeaderFrame, device: str | None, start: str | None, end: str | None) -> pl.DataFrame:
    rows = frame.by_device[device] if device is not None else frame.wide
    return _time_filter(rows, start, end)


def _time_filter(rows: pl.DataFrame, start: str | None, end: str | None) -> pl.DataFrame:
    if (start or end) and rows.height:
        # same bound semantics as the main API (HH:MM[:SS] or ISO timestamp)
        reference = pd.Timestamp(rows["date"].min())
        start_ts = services._parse_bound(start, reference)
        end_ts = services._parse_bound(end, reference)
        if start_ts is not None:
            rows = rows.filter(pl.col("date") >= start_ts.to_pydatetime())
        if end_ts is not None:
            rows = rows.filter(pl.col("date") <= end_ts.to_pydatetime())
        if rows.height == 0:
            raise ServiceError("Time range selection produced an empty data set")
    return rows


def series(
    username: str,
    name: str,
    header_or_alias: str,
    devices: str | None = None,
    metrics: str | None = None,
    start: str | None = None,
    end: str | None = None,
    max_points: int | None = None,
) -> dict:
    frame = header_frame(username, name, header_or_alias)
    chosen_metrics = frame.metrics
    if metrics:
        chosen_metrics = [m.strip() for m in metrics.split(",") if m.strip()]
        unknown = [m for m in chosen_metrics if m not in frame.metrics]
        if unknown:
            raise ServiceError(f"Unknown metric(s) {unknown}; available: {frame.metrics}")

    result = []
    for device in _select_devices(frame, devices):
        rows = _device_rows(frame, device, start, end)
        before = rows.height
        # charts get one value per timestamp, like dia_compute.final_results
        # (keep='first'); the count feeds the "multiple indexes" warning
        rows = rows.unique("date", keep="first", maintain_order=True)
        duplicates = before - rows.height
        sampled = False
        if max_points and rows.height > max_points:
            x = rows["date"].dt.epoch("ms").to_numpy()
            keep = union_indices(x, [rows[m].to_numpy() for m in chosen_metrics], max_points)
            rows = rows[keep.tolist()]
            sampled = True
        result.append(
            {
                "device": device,
                "rows": before - duplicates,
                "returned": rows.height,
                "sampled": sampled,
                "duplicates": duplicates,
                "x": _epoch_ms(rows["date"]),
                "values": {m: rows[m].fill_nan(None).to_list() for m in chosen_metrics},
            }
        )

    return {
        "file": name,
        "header": frame.header,
        "alias": frame.alias,
        "metrics": chosen_metrics,
        "devices": frame.devices,
        "device_count": frame.device_count,
        "cpu_like": frame.cpu_like,
        "time_basis": "sar wall-clock time as epoch milliseconds (interpreted as UTC)",
        "series": result,
    }


def threshold(
    username: str,
    name: str,
    header_or_alias: str,
    metric: str,
    low: float | None = None,
    high: float | None = None,
    start: str | None = None,
    end: str | None = None,
    limit: int = 500,
) -> dict:
    """Which devices hit low <= metric <= high, and when ("Metrics on many
    devices", display_multi.py). Without low/high only the metric's value
    range is returned - what the threshold slider needs."""
    frame = header_frame(username, name, header_or_alias)
    if not frame.devices:
        raise ServiceError(f"Header {frame.alias!r} has no devices")
    if metric not in frame.metrics:
        raise ServiceError(f"Unknown metric {metric!r}; available: {frame.metrics}")
    values = frame.wide.select(
        pl.col("date"), pl.col("sub_device").alias("device"), pl.col(metric).alias("value")
    ).drop_nulls("value")
    result: dict = {
        "header": frame.header,
        "alias": frame.alias,
        "metric": metric,
        "value_min": values["value"].min(),
        "value_max": values["value"].max(),
        "start": str(values["date"].min()),
        "end": str(values["date"].max()),
    }
    if low is None and high is None:
        return result

    hits = values
    if low is not None:
        hits = hits.filter(pl.col("value") >= low)
    if high is not None:
        hits = hits.filter(pl.col("value") <= high)
    if hits.height:
        hits = _time_filter(hits, start, end)
    # same device order as _natural: 'all', CPUs numerically, then names
    hits = hits.sort(
        [
            pl.col("date"),
            pl.when(pl.col("device") == "all").then(0).when(pl.col("device").str.contains(r"^\d+$")).then(1).otherwise(2),
            pl.col("device").cast(pl.Int64, strict=False),
            pl.col("device"),
        ],
        nulls_last=True,
        maintain_order=True,
    )
    per_device = (
        hits.group_by("device")
        .agg(
            pl.len().alias("count"),
            pl.col("date").min().alias("first"),
            pl.col("date").max().alias("last"),
            pl.col("value").max().alias("peak"),
        )
        .with_columns(pl.col("first").dt.epoch("ms"), pl.col("last").dt.epoch("ms"))
    )
    shown = hits.head(limit).with_columns(pl.col("date").dt.epoch("ms").alias("time"))
    result.update(
        {
            "matches": hits.height,
            "devices": sorted(per_device.to_dicts(), key=lambda d: _natural(d["device"])),
            "rows": shown.select("time", "device", "value").to_dicts(),
            "rows_returned": shown.height,
        }
    )
    return result


def _natural(device: str) -> tuple:
    """'all' first, then numbers numerically (CPU 2 before CPU 10), then names."""
    if device == "all":
        return (0, 0, "")
    return (1, int(device), "") if device.isdigit() else (2, 0, device)


_QUANTILES = {"25%": 0.25, "50%": 0.5, "75%": 0.75}


def statistics(
    username: str,
    name: str,
    header_or_alias: str,
    devices: str | None = None,
    start: str | None = None,
    end: str | None = None,
) -> dict:
    """pandas describe() per device: count, mean, std (ddof=1), min, quartiles
    (linear interpolation), max - same numbers as the main API's /statistics."""
    frame = header_frame(username, name, header_or_alias)
    result = []
    for device in _select_devices(frame, devices):
        rows = _device_rows(frame, device, start, end)
        exprs = []
        for m in frame.metrics:
            col = pl.col(m)
            exprs += [
                col.count().cast(pl.Float64).alias(f"{m}\x00count"),
                col.mean().alias(f"{m}\x00mean"),
                col.std(ddof=1).alias(f"{m}\x00std"),
                col.min().alias(f"{m}\x00min"),
                *[
                    col.quantile(q, interpolation="linear").alias(f"{m}\x00{label}")
                    for label, q in _QUANTILES.items()
                ],
                col.max().alias(f"{m}\x00max"),
            ]
        values = rows.select(exprs).row(0, named=True) if rows.height else {}
        stats: dict[str, dict[str, float | None]] = {m: {} for m in frame.metrics}
        for key, value in values.items():
            metric, stat = key.split("\x00")
            stats[metric][stat] = None if value is None or value != value else float(value)
        result.append({"device": device, "statistics": stats})
    return {"header": frame.header, "alias": frame.alias, "series": result}


def metric_descriptions() -> dict[str, str]:
    table = sqlite2_polars.get_table_df("metric")
    return {
        str(row["metric"]).strip(): str(row["description"] or "").strip()
        for row in table.select("metric", "description").iter_rows(named=True)
    }


def user_files(username: str) -> list[dict]:
    files = services.list_sar_files(username)
    for entry in files:
        match = re.match(r"^(\d{4}-\d{2}-\d{2})_(.+)_(\d{4}-\d{2}-\d{2})$", entry["name"])
        entry["uploaded"], entry["host"], entry["sar_date"] = (
            match.groups() if match else (None, None, None)
        )
    return files

