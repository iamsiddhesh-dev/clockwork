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

from .clock import now as clock_now
from .context import run_context
from .db import get_client
from .tools.money import INVOICE_CHASE_INTERVAL_DAYS, QUOTE_CHASE_DAYS
from .tools.scheduling import write_task


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


def _log_outbound(*, user_id: str, thread_id: str, body: str) -> None:
    """Record an outbound message on a thread and bump its timestamp.

    Shared by every money-tail executor: a quote, an invoice and a chase
    are all, mechanically, an outbound message on the deal's thread. That
    matters beyond saving three copies of the insert -- it means the
    follow-up ladder, get_thread and the Run Trace all see money
    correspondence exactly as they see any other message, with no
    special-casing.
    """
    client = get_client()
    client.table("message").insert(
        {"thread_id": thread_id, "user_id": user_id, "direction": "outbound", "body": body}
    ).execute()
    client.table("thread").update({"last_message_at": "now()"}).eq("id", thread_id).execute()


def _execute_send_quote(approval: dict) -> dict:
    """Approving a quote is what turns a conversation into a number the
    freelancer is committed to.

    The quote row already exists (draft_quote wrote it); this marks it
    sent, moves the deal to `quoted`, and -- the part that matters -- puts
    a check-in on the calendar. An unanswered quote is the single most
    common place freelance money quietly dies, and nothing else in the
    system would ever look at it again.
    """
    client = get_client()
    payload = approval["payload"]
    user_id = approval["user_id"]
    quote_id = payload["quote_id"]

    _log_outbound(user_id=user_id, thread_id=payload["thread_id"], body=payload["body"])

    client.table("quote").update(
        {"status": "sent", "sent_at": "now()", "updated_at": "now()"}
    ).eq("id", quote_id).eq("user_id", user_id).execute()

    client.table("deal").update(
        {"stage": "quoted", "estimated_value": payload.get("total"), "updated_at": "now()"}
    ).eq("id", payload["deal_id"]).eq("user_id", user_id).execute()

    with run_context(user_id=user_id, run_id=approval.get("run_id")):
        task_id = write_task(
            kind="quote_chase",
            subject_type="quote",
            subject_id=quote_id,
            due_in_days=QUOTE_CHASE_DAYS,
            reason=(
                "A quote was sent on this deal. Check whether the client has responded; "
                "if they've gone quiet, nudge once rather than letting the quote expire "
                "unanswered."
            ),
        )

    return {"delivered_via": "stub", "quote_id": quote_id, "follow_up_task_id": task_id}


def _execute_send_invoice(approval: dict) -> dict:
    """Issue the invoice and arm the chaser.

    `due_at` was computed when the invoice was drafted, but `issued_at`
    is stamped here, at the moment it actually goes out -- a draft that
    sat in the inbox for two days was not issued two days ago. The chase
    task is armed for the day after it falls due: chasing on the due date
    itself reads as distrust, and never chasing at all is how invoices
    age into bad debt.
    """
    client = get_client()
    payload = approval["payload"]
    user_id = approval["user_id"]
    invoice_id = payload["invoice_id"]

    _log_outbound(user_id=user_id, thread_id=payload["thread_id"], body=payload["body"])

    client.table("invoice").update(
        {"status": "sent", "issued_at": "now()", "updated_at": "now()"}
    ).eq("id", invoice_id).eq("user_id", user_id).execute()

    invoice = (
        client.table("invoice")
        .select("due_at, number")
        .eq("id", invoice_id)
        .maybe_single()
        .execute()
    ).data or {}

    with run_context(user_id=user_id, run_id=approval.get("run_id")):
        days_until_due = 0.0
        if invoice.get("due_at"):
            delta = datetime.fromisoformat(invoice["due_at"]) - clock_now(user_id)
            days_until_due = max(delta.total_seconds() / 86400, 0.0)
        task_id = write_task(
            kind="invoice_chase",
            subject_type="invoice",
            subject_id=invoice_id,
            due_in_days=days_until_due + 1,
            reason=(
                f"Invoice {invoice.get('number')} was issued and falls due on "
                f"{str(invoice.get('due_at'))[:10]}. Check whether it has been paid; if "
                "not, draft the next reminder."
            ),
        )

    return {
        "delivered_via": "stub",
        "invoice_id": invoice_id,
        "number": invoice.get("number"),
        "chase_task_id": task_id,
    }


def _execute_send_payment_chase(approval: dict) -> dict:
    """Send a reminder, advance the escalation counter, and re-arm.

    `chase_count` advances *here* rather than when the reminder was
    drafted: a chase the human read and rejected shouldn't make the next
    one angrier. And the next check-in is armed unconditionally, because
    the one thing worse than chasing an invoice is chasing it twice and
    then forgetting about it.
    """
    client = get_client()
    payload = approval["payload"]
    user_id = approval["user_id"]
    invoice_id = payload["invoice_id"]

    current = (
        client.table("invoice")
        .select("chase_count, number, status")
        .eq("id", invoice_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    ).data or {}

    # Re-check at the last possible moment. Marking an invoice paid
    # rejects any pending chase for it, but a reminder can be approved in
    # the same breath as the payment landing, and there is exactly one
    # place where that race turns into a real dunning message going out
    # to someone who already paid: here. Checked against the invoice's
    # live status rather than whatever was true when the draft was
    # written.
    if current.get("status") != "sent":
        return {
            "skipped": True,
            "invoice_id": invoice_id,
            "reason": (
                f"invoice {current.get('number')} is {current.get('status')!r} -- not "
                "chasing it. Nothing was sent."
            ),
        }

    _log_outbound(user_id=user_id, thread_id=payload["thread_id"], body=payload["body"])

    client.table("invoice").update(
        {
            "chase_count": (current.get("chase_count") or 0) + 1,
            "last_chased_at": "now()",
            "updated_at": "now()",
        }
    ).eq("id", invoice_id).eq("user_id", user_id).execute()

    with run_context(user_id=user_id, run_id=approval.get("run_id")):
        task_id = write_task(
            kind="invoice_chase",
            subject_type="invoice",
            subject_id=invoice_id,
            due_in_days=INVOICE_CHASE_INTERVAL_DAYS,
            reason=(
                "A payment reminder was sent on this invoice. Check whether it has been "
                "paid before sending another; if it's still outstanding, escalate."
            ),
        )

    return {"delivered_via": "stub", "invoice_id": invoice_id, "next_chase_task_id": task_id}


EXECUTORS = {
    "send_email": _execute_send_email,
    "send_pitch": _execute_send_pitch,
    "send_quote": _execute_send_quote,
    "send_invoice": _execute_send_invoice,
    "send_payment_chase": _execute_send_payment_chase,
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
