#!/usr/bin/env python3
"""Response times: main API (/api/v1/.../data) vs sar-web-api (/api/v2/.../series).

Both services must run against the same UPLOAD_DIR with the file uploaded.
Start sar-web-api fresh right before this script, so its first request is a
cold one (parquet load + header parse); later requests hit its cache.

    python3 perf/api_timing.py --file 2026-10-20_bighost_2026-10-01 --runs 5

Stdlib only. Prints JSON with every timing and the response sizes.
"""

import argparse
import json
import statistics
import time
import urllib.parse
import urllib.request


def token(base: str, prefix: str, user: str, password: str) -> str:
    body = json.dumps({"username": user, "password": password}).encode()
    request = urllib.request.Request(
        f"{base}{prefix}/token", data=body, headers={"content-type": "application/json"}
    )
    with urllib.request.urlopen(request) as response:
        return json.load(response)["access_token"]


def timed_get(url: str, bearer: str) -> tuple[float, int]:
    request = urllib.request.Request(url, headers={"authorization": f"Bearer {bearer}"})
    start = time.perf_counter()
    with urllib.request.urlopen(request, timeout=600) as response:
        size = len(response.read())
    return time.perf_counter() - start, size


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--file", required=True)
    parser.add_argument("--header", default="CPU")
    parser.add_argument("--runs", type=int, default=5)
    parser.add_argument("--v1", default="http://127.0.0.1:8100")
    parser.add_argument("--v2", default="http://127.0.0.1:8200")
    parser.add_argument("--user", default="admin")
    parser.add_argument("--password", default="password")
    args = parser.parse_args()

    name = urllib.parse.quote(args.file)
    header = urllib.parse.quote(args.header)
    cases = {
        # sar-web-api first: its very first request is the cold one
        "v2 series (overview default)": (
            args.v2, "/api/v2", f"/files/{name}/series?header={header}"
        ),
        "v1 data (device default)": (args.v1, "/api/v1", f"/files/{name}/data?header={header}"),
    }
    result = {}
    for label, (base, prefix, path) in cases.items():
        bearer = token(base, prefix, args.user, args.password)
        timings, size = [], 0
        for _ in range(args.runs):
            seconds, size = timed_get(f"{base}{prefix}{path}", bearer)
            timings.append(round(seconds, 3))
        result[label] = {
            "seconds": timings,
            "first": timings[0],
            "median_after_first": statistics.median(timings[1:]) if len(timings) > 1 else None,
            "bytes": size,
        }
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
