"""The money tail: quote -> invoice -> chase.

Everything upstream of this file stops at "the conversation is going
well", which is the half of freelancing people are happy to do. This is
the other half -- the half that decides whether the work turns into
money, and the half people put off, because every step of it feels like
asking for something.

Three deliberate constraints run through all of it:

1. **Python does the arithmetic, never the model.** The writer proposes
   line items with quantities and unit prices; totals, due dates and
   invoice numbers are computed here. A quote that adds up wrong is the
   one document where being confidently off by a digit costs real money.

2. **You cannot invoice for work that was never agreed.** `draft_invoice`
   refuses unless the quote is `accepted`, and acceptance is recorded by
   a human, not inferred by the agent from an enthusiastic-sounding
   email. This is a hard guard because getting it wrong means dunning a
   client for money they never said they owed.

3. **Chasing escalates.** The fourth reminder reading exactly like the
   first is precisely why freelancers give up on sending them, so tone
   is driven by `invoice.chase_count` -- and that counter only advances
   when a chase is actually approved and sent, never when one is merely
   drafted and rejected.
"""

import re
from datetime import datetime, timedelta

from strands import tool

from ..clock import now as clock_now
from ..context import current_user_id
from ..db import get_client
from ..ledger import invoke_model
from ..models import Role
from ..schemas import QuoteDraft
from .approvals import create_approval

# How long a quote stands before it goes stale. Long enough not to feel
# like pressure, short enough that a price from two months ago isn't
# still binding.
QUOTE_VALID_DAYS = 14

# Default payment window when the profile doesn't state terms. Net 14 is
# the freelance norm; net 30 is a big-company default that quietly costs
# small operators a fortnight of cashflow.
DEFAULT_TERMS_DAYS = 14

# When to look at an unanswered quote, and how often to come back to an
# unpaid invoice once it is overdue.
QUOTE_CHASE_DAYS = 5
INVOICE_CHASE_INTERVAL_DAYS = 7


# ── helpers ─────────────────────────────────────────────────────────────


def _load_profile(user_id: str) -> dict:
    res = (
        get_client().table("profile").select("*").eq("user_id", user_id).maybe_single().execute()
    )
    return (res.data if res else None) or {}


# Appended to every client-facing system prompt in this file. The first
# live run produced "Hi [Client]," in a payment reminder -- which is the
# single most embarrassing thing that could go out under someone's name,
# because it announces that a machine wrote it and nobody read it. The
# contact's name is right there on the thread, so pass it in and forbid
# the placeholder explicitly.
NO_PLACEHOLDERS = (
    "Address the client by the name given. If no name is given, open with 'Hi there'. "
    "NEVER write a bracketed placeholder like [Client], [Name] or [Your name] -- this "
    "text goes out exactly as you write it, with nothing filled in afterwards."
)


def _contact_name(thread_id: str, user_id: str) -> str | None:
    res = (
        get_client()
        .table("thread")
        .select("contact_name")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    return (res.data or {}).get("contact_name") if res else None


def _transcript(thread_id: str, user_id: str) -> str:
    messages = (
        get_client()
        .table("message")
        .select("direction, body")
        .eq("thread_id", thread_id)
        .eq("user_id", user_id)
        .order("sent_at")
        .execute()
    ).data or []
    return "\n".join(f"[{m['direction']}] {m['body']}" for m in messages)


def _terms_days(payment_terms: str | None) -> int:
    """Read a payment window out of free-text terms.

    Profiles store terms as prose ("net 14", "50% upfront, balance on
    delivery, net 30") because that is how freelancers actually write
    them. Pull the first number out; fall back to the default rather than
    guessing, since a wrong due date is what a chase message is built on.
    """
    if not payment_terms:
        return DEFAULT_TERMS_DAYS
    match = re.search(r"net\s*(\d{1,3})", payment_terms, re.IGNORECASE)
    if not match:
        match = re.search(r"(\d{1,3})\s*days?", payment_terms, re.IGNORECASE)
    if not match:
        return DEFAULT_TERMS_DAYS
    days = int(match.group(1))
    return days if 1 <= days <= 120 else DEFAULT_TERMS_DAYS


def _price(draft: QuoteDraft) -> tuple[list[dict], float, float]:
    """Turn the model's line items into priced rows plus totals.

    This is the arithmetic the model is deliberately not trusted with.
    """
    line_items: list[dict] = []
    for item in draft.line_items:
        amount = round(item.quantity * item.unit_price, 2)
        line_items.append(
            {
                "description": item.description,
                "quantity": item.quantity,
                "unit": item.unit,
                "unit_price": round(item.unit_price, 2),
                "amount": amount,
            }
        )
    subtotal = round(sum(item["amount"] for item in line_items), 2)
    # No tax handling: VAT/sales tax depends on the freelancer's
    # jurisdiction and their client's, which is a real compliance
    # question and not one to guess at in a hackathon. Total == subtotal,
    # stated as separate columns so adding tax later doesn't require a
    # migration.
    return line_items, subtotal, subtotal


def _money(amount: float, currency: str) -> str:
    return f"{currency} {amount:,.2f}"


def render_quote(quote: dict) -> str:
    """The client-facing text of a quote. Rendered here, deterministically,
    from the stored numbers -- so what the client reads and what the
    database holds cannot drift apart."""
    currency = quote.get("currency") or "USD"
    lines = [quote.get("covering_note") or ""]
    lines.append("")
    for item in quote.get("line_items") or []:
        qty, unit = item.get("quantity", 1), item.get("unit", "project")
        detail = "" if (qty == 1 and unit == "project") else f"  ({qty:g} × {unit})"
        lines.append(f"- {item['description']}{detail}: {_money(item['amount'], currency)}")
    lines.append("")
    lines.append(f"Total: {_money(quote.get('total') or 0, currency)}")
    if quote.get("timeline"):
        lines.append(f"Timeline: {quote['timeline']}")
    if quote.get("payment_terms"):
        lines.append(f"Payment terms: {quote['payment_terms']}")
    if quote.get("assumptions"):
        lines.append("")
        lines.append("This assumes:")
        lines += [f"- {a}" for a in quote["assumptions"]]
    if quote.get("exclusions"):
        lines.append("")
        lines.append("Not included (happy to quote separately):")
        lines += [f"- {e}" for e in quote["exclusions"]]
    return "\n".join(lines).strip()


def render_invoice(invoice: dict) -> str:
    currency = invoice.get("currency") or "USD"
    lines = [f"Invoice {invoice['number']}", ""]
    for item in invoice.get("line_items") or []:
        lines.append(f"- {item['description']}: {_money(item['amount'], currency)}")
    lines.append("")
    lines.append(f"Amount due: {_money(invoice.get('amount') or 0, currency)}")
    if invoice.get("due_at"):
        lines.append(f"Due: {str(invoice['due_at'])[:10]}")
    if invoice.get("payment_terms"):
        lines.append(f"Terms: {invoice['payment_terms']}")
    return "\n".join(lines)


def _next_invoice_number(user_id: str) -> str:
    """Sequential per freelancer, e.g. INV-0007.

    Derived from the highest number already issued rather than a row
    count, so voiding an invoice doesn't cause the next one to reuse a
    number that a client has already seen. `unique (user_id, number)` in
    the schema is the real guard against a race here; this just picks a
    sensible next value.
    """
    rows = (
        get_client().table("invoice").select("number").eq("user_id", user_id).execute()
    ).data or []
    highest = 0
    for row in rows:
        match = re.search(r"(\d+)", row.get("number") or "")
        if match:
            highest = max(highest, int(match.group(1)))
    return f"INV-{highest + 1:04d}"


def _load_deal(deal_id: str, user_id: str) -> dict:
    res = (
        get_client()
        .table("deal")
        .select("*")
        .eq("id", deal_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise ValueError(f"deal {deal_id} not found")
    return res.data


# ── quote ───────────────────────────────────────────────────────────────


def draft_quote_for(deal_id: str) -> dict:
    """Price one deal and queue the quote for approval. Nothing is sent."""
    user_id = current_user_id()
    client = get_client()

    deal = _load_deal(deal_id, user_id)
    profile = _load_profile(user_id)
    if not profile:
        raise ValueError(
            "No profile yet -- a quote has to be priced off your real rates, so there is "
            "nothing to base one on."
        )

    existing = (
        client.table("quote")
        .select("id, status")
        .eq("deal_id", deal_id)
        .in_("status", ["draft", "sent"])
        .execute()
    ).data or []
    if existing:
        raise ValueError(
            f"deal {deal_id} already has a quote in status "
            f"{existing[0]['status']!r} -- decide on that one before writing another."
        )

    rates = profile.get("rates") or {}
    currency = rates.get("currency") or "USD"
    payment_terms = profile.get("payment_terms") or f"Net {DEFAULT_TERMS_DAYS}"

    result = invoke_model(
        Role.WRITER,
        (
            "FREELANCER\n"
            f"Name: {profile.get('name')}\n"
            f"Skills: {', '.join(profile.get('skills') or []) or 'none listed'}\n"
            f"Positioning: {profile.get('positioning') or 'none given'}\n"
            f"Rates: {rates}\n"
            f"Portfolio (for scale of comparable work): {profile.get('portfolio') or []}\n\n"
            "THE DEAL\n"
            f"Client: {_contact_name(deal['thread_id'], user_id) or '(name unknown)'}\n"
            f"What they want: {deal.get('intent') or 'not yet summarised'}\n"
            f"Qualification: {deal.get('score') or 'unscored'} -- "
            f"{deal.get('score_rationale') or 'no rationale'}\n"
            f"Earlier value estimate: {deal.get('estimated_value')}\n\n"
            "THE CONVERSATION\n"
            f"{_transcript(deal['thread_id'], user_id) or '(no messages logged)'}\n\n"
            "Price this work."
        ),
        system_prompt=(
            "You price freelance work on behalf of the freelancer, using their own "
            "stated rates. Break the job into two to five lines the client can "
            "actually evaluate. Quantities and unit prices only -- do not compute "
            "totals, they are calculated separately. Base every number on the rates "
            "in the profile and the scope in the conversation; if the conversation "
            "doesn't pin something down, put it in assumptions rather than inventing "
            "a requirement. Do not undercut the freelancer's stated rate to look "
            "competitive.\n\n"
            f"The covering note is client-facing. {NO_PLACEHOLDERS}"
        ),
        structured_output_model=QuoteDraft,
    )
    draft: QuoteDraft = result.structured_output

    line_items, subtotal, total = _price(draft)
    valid_until = clock_now(user_id) + timedelta(days=QUOTE_VALID_DAYS)

    quote_row = (
        client.table("quote")
        .insert(
            {
                "user_id": user_id,
                "deal_id": deal_id,
                "currency": currency,
                "line_items": line_items,
                "subtotal": subtotal,
                "total": total,
                "timeline": draft.timeline,
                "assumptions": draft.assumptions,
                "exclusions": draft.exclusions,
                "payment_terms": payment_terms,
                "valid_until": valid_until.isoformat(),
                "status": "draft",
            }
        )
        .execute()
    )
    quote = quote_row.data[0]

    body = render_quote({**quote, "covering_note": draft.covering_note})

    approval_id = create_approval(
        action_type="send_quote",
        # High, not medium: a sent quote is a number the freelancer is
        # then anchored to for the rest of the negotiation. Unlike a
        # reply, you cannot really walk it back.
        risk="high",
        payload={
            "quote_id": quote["id"],
            "deal_id": deal_id,
            "thread_id": deal["thread_id"],
            "body": body,
            "total": total,
            "currency": currency,
        },
        rationale=draft.rationale,
        citations=[deal["thread_id"]],
        state_diff={
            "quote_id": quote["id"],
            "deal_stage": f"{deal['stage']} -> quoted",
            "total": _money(total, currency),
            "valid_until": valid_until.date().isoformat(),
        },
    )

    return {
        "approval_id": approval_id,
        "quote_id": quote["id"],
        "total": total,
        "currency": currency,
        "body": body,
    }


@tool
def draft_quote(deal_id: str) -> dict:
    """Price a deal and queue the quote for approval, using the
    freelancer's real rates and the scope in the conversation. Totals are
    computed, not written by the model. Does NOT send anything.

    Args:
        deal_id: The deal to quote for.
    """
    try:
        return {"status": "success", "content": [{"json": draft_quote_for(deal_id)}]}
    except ValueError as exc:
        return {"status": "error", "content": [{"text": str(exc)}]}


# ── invoice ─────────────────────────────────────────────────────────────


def draft_invoice_for(quote_id: str) -> dict:
    """Raise an invoice against an accepted quote and queue it for
    approval. Nothing is sent."""
    user_id = current_user_id()
    client = get_client()

    quote_res = (
        client.table("quote")
        .select("*")
        .eq("id", quote_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not quote_res or not quote_res.data:
        raise ValueError(f"quote {quote_id} not found")
    quote = quote_res.data

    # The hard guard. "The client sounded keen" is not acceptance, and an
    # agent that infers it will eventually invoice someone who never
    # agreed to anything.
    if quote["status"] != "accepted":
        raise ValueError(
            f"quote {quote_id} is {quote['status']!r}, not 'accepted' -- an invoice can "
            "only be raised once the client has actually accepted the quote, and that "
            "acceptance has to be recorded by a human, not inferred from the thread."
        )

    existing = (
        client.table("invoice")
        .select("id, number, status")
        .eq("quote_id", quote_id)
        .not_.in_("status", ["void"])
        .execute()
    ).data or []
    if existing:
        raise ValueError(
            f"quote {quote_id} was already invoiced as {existing[0]['number']} "
            f"(status {existing[0]['status']!r})."
        )

    profile = _load_profile(user_id)
    terms = quote.get("payment_terms") or profile.get("payment_terms")
    now = clock_now(user_id)
    due_at = now + timedelta(days=_terms_days(terms))

    invoice_row = (
        client.table("invoice")
        .insert(
            {
                "user_id": user_id,
                "deal_id": quote["deal_id"],
                "quote_id": quote_id,
                "number": _next_invoice_number(user_id),
                "currency": quote["currency"],
                "amount": quote["total"],
                "line_items": quote["line_items"],
                "payment_terms": terms,
                "status": "draft",
                "due_at": due_at.isoformat(),
            }
        )
        .execute()
    )
    invoice = invoice_row.data[0]
    body = render_invoice(invoice)

    deal = _load_deal(quote["deal_id"], user_id)
    approval_id = create_approval(
        action_type="send_invoice",
        risk="high",
        payload={
            "invoice_id": invoice["id"],
            "deal_id": quote["deal_id"],
            "thread_id": deal["thread_id"],
            "body": body,
        },
        rationale=(
            f"Quote {quote_id} was accepted for {_money(quote['total'], quote['currency'])}. "
            f"Invoicing that amount, due {due_at.date().isoformat()} ({terms})."
        ),
        citations=[quote_id],
        state_diff={
            "invoice": invoice["number"],
            "amount": _money(quote["total"], quote["currency"]),
            "due_at": due_at.date().isoformat(),
        },
    )

    return {
        "approval_id": approval_id,
        "invoice_id": invoice["id"],
        "number": invoice["number"],
        "amount": invoice["amount"],
        "due_at": invoice["due_at"],
        "body": body,
    }


@tool
def draft_invoice(quote_id: str) -> dict:
    """Raise an invoice for an accepted quote and queue it for approval.
    Fails if the quote has not been marked accepted by a human. Does NOT
    send anything.

    Args:
        quote_id: The accepted quote to invoice.
    """
    try:
        return {"status": "success", "content": [{"json": draft_invoice_for(quote_id)}]}
    except ValueError as exc:
        return {"status": "error", "content": [{"text": str(exc)}]}


# ── chase ───────────────────────────────────────────────────────────────

# What tone each successive reminder takes. Indexed by how many chases
# have already been *sent*. Written out rather than left to the model so
# the ladder is inspectable and the same at every step of a demo.
CHASE_LADDER = [
    "This is the FIRST reminder. Assume it was genuinely missed -- people are busy and "
    "invoices fall behind email. Light, short, no hint of accusation. Restate the amount "
    "and the due date, and offer to resend the invoice.",
    "This is the SECOND reminder. Still friendly, but drop the assumption that it was an "
    "oversight. State plainly that the invoice is overdue, restate the agreed payment "
    "terms, and ask for a specific date they expect to pay.",
    "This is the THIRD reminder or later. Direct and businesslike -- no apologising for "
    "chasing. State how far overdue it is, ask them to confirm a payment date in writing, "
    "and say that further work is on hold until it is settled. Do not threaten legal "
    "action or invent late fees that were never in the terms.",
]


def chase_payment_for(invoice_id: str) -> dict:
    """Draft the next payment reminder for an overdue invoice and queue it
    for approval. Returns `{"action": "none", ...}` if there is nothing to
    chase -- which is the correct outcome most of the time."""
    user_id = current_user_id()
    client = get_client()

    res = (
        client.table("invoice")
        .select("*")
        .eq("id", invoice_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise ValueError(f"invoice {invoice_id} not found")
    invoice = res.data

    if invoice["status"] != "sent":
        # paid / void / still a draft -- all of them mean "do not chase".
        # Returning a plain result rather than raising: this is the normal
        # happy path for a scheduled run, not an error.
        return {
            "action": "none",
            "reason": f"invoice {invoice['number']} is {invoice['status']!r}, nothing to chase",
        }

    now = clock_now(user_id)
    due_at = invoice.get("due_at")
    days_overdue = 0
    if due_at:
        days_overdue = (now - datetime.fromisoformat(due_at)).days
    if days_overdue < 0:
        return {
            "action": "none",
            "reason": f"invoice {invoice['number']} isn't due yet ({abs(days_overdue)} days to go)",
        }

    profile = _load_profile(user_id)
    deal = _load_deal(invoice["deal_id"], user_id)
    stage = CHASE_LADDER[min(invoice["chase_count"], len(CHASE_LADDER) - 1)]

    result = invoke_model(
        Role.WRITER,
        (
            f"Freelancer: {profile.get('name')}\n"
            f"How they write: {(profile.get('voice_samples') or ['(no samples)'])[0]}\n"
            f"Client: {_contact_name(deal['thread_id'], user_id) or '(name unknown)'}\n\n"
            f"Invoice {invoice['number']} for "
            f"{_money(invoice['amount'], invoice['currency'])}\n"
            f"Work: {deal.get('intent') or 'the agreed work'}\n"
            f"Due: {str(due_at)[:10]} -- {days_overdue} days overdue\n"
            f"Terms: {invoice.get('payment_terms') or 'not stated'}\n"
            f"Reminders already sent: {invoice['chase_count']}\n\n"
            "Write the reminder."
        ),
        system_prompt=(
            "You write payment reminders for a freelancer chasing an unpaid invoice. "
            "Under 100 words. No grovelling, no apologising for asking to be paid, no "
            "passive aggression. Reference the invoice number and the amount. Never "
            "invent fees, interest or legal steps that aren't in the stated terms.\n\n"
            f"{NO_PLACEHOLDERS}\n\n"
            f"{stage}"
        ),
    )
    body = str(result)

    approval_id = create_approval(
        action_type="send_payment_chase",
        risk="medium",
        payload={
            "invoice_id": invoice_id,
            "thread_id": deal["thread_id"],
            "body": body,
        },
        rationale=(
            f"Invoice {invoice['number']} ({_money(invoice['amount'], invoice['currency'])}) "
            f"is {days_overdue} days overdue; {invoice['chase_count']} reminder(s) already sent."
        ),
        citations=[invoice_id],
        state_diff={
            "invoice": invoice["number"],
            "chase_count": f"{invoice['chase_count']} -> {invoice['chase_count'] + 1}",
            "days_overdue": days_overdue,
        },
    )

    return {
        "action": "chase_drafted",
        "approval_id": approval_id,
        "invoice_id": invoice_id,
        "days_overdue": days_overdue,
        "body": body,
    }


@tool
def chase_payment(invoice_id: str) -> dict:
    """Draft the next payment reminder for an overdue invoice and queue it
    for approval. Tone escalates with how many reminders have already
    been sent. Correctly does nothing if the invoice is already paid,
    void, or not yet due. Does NOT send anything.

    Args:
        invoice_id: The invoice to chase.
    """
    try:
        return {"status": "success", "content": [{"json": chase_payment_for(invoice_id)}]}
    except ValueError as exc:
        return {"status": "error", "content": [{"text": str(exc)}]}
