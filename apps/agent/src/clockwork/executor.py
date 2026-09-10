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


def _execute_send_pitch(approval: dict) -> dict:
    """Approving an outbound pitch is what turns a *sourced posting* into
    a real client relationship.

    This is the join between the outbound half (opportunity) and the
    inbound half that already existed (thread / message / deal): once the
    pitch goes out, there is a conversation to track, so it gets a thread
    with the pitch as its first outbound message and a deal at stage
    `new`. Everything already built -- qualify_lead, draft_reply, the
    follow-up ladder -- then works on it unchanged when someone replies.

    Note there is no contact email: none of the public feeds expose one
    (you apply via the posting's own link). `contact_email` is therefore
    honestly null rather than invented, and the opportunity URL is
    carried on the thread so a human can actually send it.
    """
    client = get_client()
    payload = approval["payload"]
    user_id = approval["user_id"]
    opportunity_id = payload["opportunity_id"]

    opp = (
        client.table("opportunity")
        .select("*")
        .eq("id", opportunity_id)
        .maybe_single()
        .execute()
    ).data or {}

    thread = (
        client.table("thread")
        .insert(
            {
                "user_id": user_id,
                "contact_name": opp.get("author") or payload.get("opportunity_title"),
                "contact_email": None,
                "channel": "outbound_pitch",
            }
        )
        .execute()
    )
    thread_id = thread.data[0]["id"]

    client.table("message").insert(
        {
            "thread_id": thread_id,
            "user_id": user_id,
            "direction": "outbound",
            "body": payload["body"],
        }
    ).execute()
    client.table("thread").update({"last_message_at": "now()"}).eq("id", thread_id).execute()

    deal = (
        client.table("deal")
        .insert(
            {
                "user_id": user_id,
                "thread_id": thread_id,
                "stage": "new",
                "source": "outbound_pitch",
                "intent": payload.get("opportunity_title"),
            }
        )
        .execute()
    )
    deal_id = deal.data[0]["id"]

    client.table("opportunity").update(
        {"status": "converted", "deal_id": deal_id, "updated_at": "now()"}
    ).eq("id", opportunity_id).eq("user_id", user_id).execute()

    # TODO: same Gmail gap as _execute_send_email -- the message is
    # recorded, not transmitted.
    return {
        "delivered_via": "stub",
        "thread_id": thread_id,
        "deal_id": deal_id,
        "opportunity_url": payload.get("opportunity_url"),
    }


EXECUTORS = {
    "send_email": _execute_send_email,
    "send_pitch": _execute_send_pitch,
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
