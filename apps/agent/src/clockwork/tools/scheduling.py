"""Scheduling a future check-in on something.

`write_task` is the plain function -- callable directly from other tools
(e.g. `draft_reply` uses it to guarantee a follow-up gets scheduled every
time, rather than hoping the model decides to). `schedule_task` is the
`@tool` wrapper so the orchestrator can *also* schedule ad-hoc check-ins
on its own judgement (e.g. "quote accepted, check in on invoice in 14
days"). Both write the same row; deterministic call sites (like
draft_reply's own follow-up) don't depend on the model choosing to.

Auto, not approval-gated: scheduling a check-in is internal state --
nothing client-facing happens until whatever fires later decides to act,
and that later action goes through the normal approval gate like
anything else.
"""

from datetime import timedelta

from strands import tool

from ..clock import now as clock_now
from ..context import current_user_id
from ..db import get_client


def write_task(*, kind: str, subject_type: str, subject_id: str, due_in_days: float, reason: str) -> str:
    """Write (or reschedule) a pending task. Returns the task id."""
    user_id = current_user_id()
    due_at = clock_now(user_id) + timedelta(days=due_in_days)
    # One idempotency key per (kind, subject) -- scheduling the same kind
    # of follow-up on the same subject again reschedules it in place
    # rather than piling up duplicate tasks.
    idempotency_key = f"{kind}:{subject_type}:{subject_id}"

    result = (
        get_client()
        .table("task")
        .upsert(
            {
                "user_id": user_id,
                "kind": kind,
                "subject_type": subject_type,
                "subject_id": subject_id,
                "due_at": due_at.isoformat(),
                "status": "pending",
                "payload": {"reason": reason},
                "idempotency_key": idempotency_key,
            },
            on_conflict="idempotency_key",
        )
        .execute()
    )
    return result.data[0]["id"]


@tool
def schedule_task(kind: str, subject_type: str, subject_id: str, due_in_days: float, reason: str) -> dict:
    """Schedule a future check-in on something -- a scheduled run will
    re-examine it when the virtual clock reaches the due time and decide
    what, if anything, to do. Use this for check-ins beyond the automatic
    one draft_reply already schedules for you -- e.g. checking on an
    accepted quote, or an invoice that isn't due yet but will be.

    Args:
        kind: What kind of check this is, e.g. "follow_up" for a thread
            that's gone quiet, "invoice_chase" for an overdue invoice.
        subject_type: What the task is about, e.g. "thread" or "deal".
        subject_id: The id of that thread/deal/etc.
        due_in_days: How many days from now (the virtual clock's now, not
            wall-clock) this should fire. Fractional days are fine.
        reason: One sentence on why this follow-up matters -- carried
            into the scheduled run's prompt so it stays grounded in why
            it exists rather than firing blind.
    """
    task_id = write_task(
        kind=kind, subject_type=subject_type, subject_id=subject_id,
        due_in_days=due_in_days, reason=reason,
    )
    return {"status": "success", "content": [{"json": {"task_id": task_id}}]}
