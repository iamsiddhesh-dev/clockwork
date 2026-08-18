"""The approval pattern, shared by every approval-gated tool.

An approval-gated tool never performs its side effect directly -- it writes
an `approval` row and returns "queued". A separate executor (see
`clockwork.executor`) performs the real side effect once a human clicks
approve in the Approval Inbox. Get this right once, reuse everywhere.
"""

from ..context import current_run_id, current_user_id
from ..db import get_client


def create_approval(
    *,
    action_type: str,
    risk: str,
    payload: dict,
    rationale: str,
    citations: list | None = None,
    state_diff: dict | None = None,
) -> str:
    """Queue an action for human approval. Returns the new approval id.

    Every approval card shows four things: what it will do (action_type +
    payload), why (rationale), what it read (citations into the source
    thread/messages), and what changes (state_diff) -- that's what makes
    this read as an employee reporting to you, not a chatbot guessing.
    """
    res = (
        get_client()
        .table("approval")
        .insert(
            {
                "user_id": current_user_id(),
                "run_id": current_run_id(),
                "action_type": action_type,
                "risk": risk,
                "payload": payload,
                "rationale": rationale,
                "citations": citations or [],
                "state_diff": state_diff or {},
            }
        )
        .execute()
    )
    return res.data[0]["id"]
