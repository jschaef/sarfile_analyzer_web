"""Make the sarfile_analyzer_ng code importable (read-only use).

This service does not copy the parsing logic: it imports `api.services` and the
`code/` modules of a sarfile_analyzer_ng checkout, exactly like that project's
own FastAPI does. SAR_BACKEND_DIR points to the checkout (default: a sibling
directory ../sarfile_analyzer_ng of this repository).

Must be imported before anything from code/ or api/.
"""

import os
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
BACKEND_DIR = Path(
    os.environ.get("SAR_BACKEND_DIR", REPO_ROOT.parent / "sarfile_analyzer_ng")
).resolve()

if not (BACKEND_DIR / "api" / "bootstrap.py").is_file():
    raise RuntimeError(
        f"sarfile_analyzer_ng checkout not found at {BACKEND_DIR} - set SAR_BACKEND_DIR"
    )

# appended, not prepended: the checkout's code/ directory is a package named
# "code" and would otherwise shadow the standard library module of that name
if str(BACKEND_DIR) not in sys.path:
    sys.path.append(str(BACKEND_DIR))

# puts code/ on sys.path and defaults UPLOAD_DIR to code/upload - set
# UPLOAD_DIR explicitly so this service shares the storage of the main API
from api import bootstrap as _backend_bootstrap  # noqa: E402,F401
