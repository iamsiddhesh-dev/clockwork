"""Vercel entrypoint.

Vercel's Python runtime looks for a top-level `app` in `app.py` (or
`main.py`, `index.py`, ...) at the project root. The real application lives
in the `clockwork` package under `src/`, which is not on the import path by
default, so this file puts it there and re-exports the FastAPI instance.

Locally nothing changes -- `uvicorn clockwork.api:app` with PYTHONPATH=src
still works, and so does `uvicorn app:app` from this directory.
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent / "src"))

from clockwork.api import app  # noqa: E402

__all__ = ["app"]
