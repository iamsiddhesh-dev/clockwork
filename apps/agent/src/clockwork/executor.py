"""Executes an approved action's real side effect.

An approval-gated tool only ever queues an `approval` row -- it never
performs the side effect itself. Once a human approves it (via the API),
this module actually does the thing and flips the approval to `executed`.

Gmail send isn't wired yet (Phase 1 Day 4 item, needs OAuth setup in the
Google Cloud console -- a human task, not something to build blind). Until
then, `send_email` logs the outbound message to the thread so the rest of
the loop (Approval Inbox -> "sent" -> thread updated) is demoable, and
marks the approval executed with a note that delivery is stubbed.
"""

from datetime import datetime, timezone

from .context import run_context
from .db import get_client


def _execute_send_email(approval: dict) -> dict:
    payload = approval["payload"]
    thread_id = payload["thread_id"]
    body = payload["body"]

    get_client().table("message").insert(
        {
            "thread_id": thread_id,
            "user_id": approval["user_id"],
            "direction": "outbound",
            "body": body,
        }
    ).execute()
    get_client().table("thread").update({"last_message_at": "now()"}).eq(
        "id", thread_id
    ).execute()

    # TODO(Day 4 Gmail integration): actually call the Gmail API here once
    # OAuth (testing mode) is wired. Until then this only logs the message.
    return {"delivered_via": "stub", "thread_id": thread_id}


EXECUTORS = {
    "send_email": _execute_send_email,
}


def execute_approval(approval_id: str) -> dict:
    """Run the real side effect for an approved approval, then mark it
    executed (or failed, with the error recorded -- never a silent no-op)."""
    client = get_client()
    res = client.table("approval").select("*").eq("id", approval_id).maybe_single().execute()
    if not res or not res.data:
        raise ValueError(f"approval {approval_id} not found")
    approval = res.data

    executor = EXECUTORS.get(approval["action_type"])
    if executor is None:
        raise ValueError(f"no executor registered for action_type={approval['action_type']!r}")

    with run_context(user_id=approval["user_id"], run_id=approval.get("run_id")):
        try:
            result = executor(approval)
        except Exception as exc:
            client.table("approval").update({"status": "failed"}).eq("id", approval_id).execute()
            raise RuntimeError(f"execution failed for approval {approval_id}: {exc}") from exc

    client.table("approval").update(
        {"status": "executed", "executed_at": datetime.now(timezone.utc).isoformat()}
    ).eq("id", approval_id).execute()
    return result
