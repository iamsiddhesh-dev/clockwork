"""Per-run context (current user_id, run_id) made available to tool
functions without threading them through every tool signature.

`run_agent()` sets these via `run_context(...)` before invoking the agent;
every tool reads them back with `current_user_id()` / `current_run_id()`.
Contextvars rather than globals so concurrent runs (different users, or
the scheduler firing many runs at once) never bleed into each other.
"""

from contextlib import contextmanager
from contextvars import ContextVar

_user_id: ContextVar[str | None] = ContextVar("clockwork_user_id", default=None)
_run_id: ContextVar[str | None] = ContextVar("clockwork_run_id", default=None)


@contextmanager
def run_context(*, user_id: str, run_id: str):
    user_token = _user_id.set(user_id)
    run_token = _run_id.set(run_id)
    try:
        yield
    finally:
        _user_id.reset(user_token)
        _run_id.reset(run_token)


def current_user_id() -> str:
    user_id = _user_id.get()
    if user_id is None:
        raise RuntimeError("No Clockwork run context set -- call this from within run_agent().")
    return user_id


def current_run_id() -> str | None:
    return _run_id.get()
