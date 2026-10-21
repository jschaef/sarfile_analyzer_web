"""sar-web-api for the Playwright run: same app, on a copy of the seed data.db.

    python -m sar_web_api.e2e_server [--port 8200]

The e2e tests sign up, change passwords and edit the metric/heading tables.
They must never do that in the checkout's code/data.db (the seed in git) or
in a production database, so this copies the data.db sql_stuff would use
into a temporary directory and points the app at the copy.
"""

import argparse
import shutil
import tempfile
from pathlib import Path

from . import bootstrap


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8200)
    args = parser.parse_args()

    import sql_stuff
    import uvicorn

    copy = Path(tempfile.mkdtemp(prefix="sar-web-e2e-")) / "data.db"
    shutil.copyfile(sql_stuff.data_db, copy)
    bootstrap.use_database(copy)
    print(f"sar-web-api e2e: data.db copy at {copy}", flush=True)

    from .main import app

    uvicorn.run(app, host=args.host, port=args.port)


if __name__ == "__main__":
    main()
