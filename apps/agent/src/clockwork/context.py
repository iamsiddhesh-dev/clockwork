"""Per-run context (current user_id, run_id) made available to tool
functions without threading them through every tool signature.

`run_agent()` sets these via `run_context(...)` before invoking the agent;
every tool reads them back with `current_user_id()` / `current_run_id()`.
Contextvars rather than globals so concurrent runs (different users, or
the scheduler firing many runs at once) never bleed into each other.
"""

import itertools
from contextlib import contextmanager
from contextvars import ContextVar

_user_id: ContextVar[str | None] = ContextVar("clockwork_user_id", default=None)
_run_id: ContextVar[str | None] = ContextVar("clockwork_run_id", default=None)

# Event numbering for runs a person starts with a button (see runs.py).
# The orchestrator's own AuditTrail hook numbers its events itself; this
# is only set inside `manual_run`, which is also how the ledger knows to
# write a model_call event into the trace -- nothing else would.
_event_seq: ContextVar["itertools.count[int] | None"] = ContextVar(
    "clockwork_event_seq", default=None
)


@contextmanager
def event_sequence():
    """Number the events written inside this block 1, 2, 3, ..."""
    token = _event_seq.set(itertools.count(1))
    try:
        yield
    finally:
        _event_seq.reset(token)


def next_event_seq() -> int | None:
    """The next event number, or None when not inside a manual run."""
    counter = _event_seq.get()
    return next(counter) if counter is not None else None


@contextmanager
def run_context(*, user_id: str, run_id: str | None):
    # run_id is optional: work triggered directly by the user (syncing
    # sources, scoring a batch) needs the user context so tools and the
    # ledger work, but isn't an agent_run and has nothing to attribute to.
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
