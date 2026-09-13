"""Runs for work a person starts with a button.

`run_agent()` records a run whenever the orchestrator decides what to do --
a client message arrives, or a scheduled check-in fires. But most of what
someone actually does in the product is direct: onboarding's first sweep,
Score fit, Draft a pitch, Draft quote, Raise invoice, Chase now, and every
approval. Those call the same tools and the same models, and used to open
no run at all -- so a whole onboarding made twenty-odd model calls and left
Runs, the Run Trace and the Overview activity feed completely empty. From
the outside, the agent looked like it had done nothing.

`manual_run` gives that work the same audit trail: an `agent_run` row with
trigger `manual`, the model calls it makes (written by the ledger), a step
for each thing it decided, and a terminal status with the real total cost.
"""

from contextlib import contextmanager
from typing import Iterator

from .audit import log_event
from .context import event_sequence, next_event_seq, run_context
from .db import get_client
from .ledger import total_run_cost_usd


class RunRecord:
    """Handle for the run in progress: write steps, set the outcome."""

    def __init__(self, run_id: str, user_id: str):
        self.id = run_id
        self.user_id = user_id
        #: One line shown on the Runs list. Defaults to the run's label.
        self.outcome: str | None = None

    def step(self, text: str, *, tool: str | None = None, payload: dict | None = None) -> None:
        """Record something this run did, in order, in the trace."""
        log_event(
            run_id=self.id,
            user_id=self.user_id,
            seq=next_event_seq() or 0,
            kind="decision",
            tool_name=tool,
            rationale=text,
            payload=payload,
        )


def _error_text(exc: BaseException) -> str:
    # HTTPException carries its message on `.detail`; str() of it is just
    # the status code, which says nothing in a trace.
    detail = getattr(exc, "detail", None)
    return str(detail) if detail else f"{type(exc).__name__}: {exc}"


@contextmanager
def manual_run(user_id: str, *, label: str, trigger_ref: str | None = None) -> Iterator[RunRecord]:
    """Record everything inside this block as one run, started by a person.

    A failure still ends the run -- marked `failed` with the reason -- and
    is re-raised, so the audit trail always reaches a terminal status and
    the caller still sees the error. Same contract as `run_agent()`.
    """
    client = get_client()
    run_id = (
        client.table("agent_run")
        .insert(
            {
                "user_id": user_id,
                "trigger_type": "manual",
                "trigger_ref": trigger_ref,
                "status": "running",
            }
        )
        .execute()
    ).data[0]["id"]

    record = RunRecord(run_id, user_id)
    with event_sequence(), run_context(user_id=user_id, run_id=run_id):
        try:
            yield record
        except BaseException as exc:
            error = _error_text(exc)
            try:
                log_event(
                    run_id=run_id,
                    user_id=user_id,
                    seq=next_event_seq() or 0,
                    kind="error",
                    rationale=error,
                )
                client.table("agent_run").update(
                    {
                        "status": "failed",
                        "completed_at": "now()",
                        "error": error,
                        "outcome": label,
                        "total_cost_usd": total_run_cost_usd(run_id),
                    }
                ).eq("id", run_id).execute()
            except Exception:
                pass  # never let bookkeeping hide the original failure
            raise

    client.table("agent_run").update(
        {
            "status": "completed",
            "completed_at": "now()",
            "outcome": record.outcome or label,
            "total_cost_usd": total_run_cost_usd(run_id),
        }
    ).eq("id", run_id).execute()
