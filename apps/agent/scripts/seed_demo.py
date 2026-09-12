"""Build a populated demo workspace, without touching a model or a feed.

Why this exists: a recording depends on three job boards being up, a
model provider not rate-limiting, and roughly a minute of live sourcing
finishing on cue. Two of those are other people's servers. This script
writes the same rows those runs would have produced, so a demo has
something real to show even on a bad network -- and so the same screens
look identical on every take.

**Every row it writes is marked.** `deal.source` and `thread.channel`
carry a `demo_` prefix, opportunities get `external_id` starting
`demo:`, and the profile is a named fictional freelancer. Nothing here
pretends to be live data, and `--wipe` finds its own rows by those marks
rather than deleting anything it did not create.

What it does NOT fake: agent runs, agent events, token ledger rows and
approvals. Those are the audit trail -- claiming the agent did work it
never did would be exactly the dishonesty this project spends its whole
README avoiding. Run the real thing once and those fill in properly.

    python scripts/seed_demo.py                 # new workspace, print the id
    python scripts/seed_demo.py --account <id>  # seed an existing one
    python scripts/seed_demo.py --account <id> --wipe
"""

from __future__ import annotations

import argparse
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from clockwork.auth import create_account  # noqa: E402
from clockwork.db import get_client  # noqa: E402

DEMO_CHANNEL = "demo_intake"
DEMO_SOURCE = "demo_intake"
DEMO_EXTERNAL_PREFIX = "demo:"

NOW = datetime.now(timezone.utc)


def ago(days: float) -> str:
    return (NOW - timedelta(days=days)).isoformat()


def ahead(days: float) -> str:
    return (NOW + timedelta(days=days)).isoformat()


PROFILE = {
    "name": "Maya Okonkwo",
    "title": "Backend engineer · payments and billing",
    "email": "maya@okonkwo.dev",
    "skills": ["TypeScript", "Stripe Billing", "Postgres", "Node.js", "React"],
    "years_experience": 8,
    "rates": {"hourly": 95, "currency": "USD"},
    "min_project_budget": 3000,
    "availability_hours": 25,
    "payment_terms": "Net 14",
    "timezone": "Europe/Lisbon",
    "positioning": (
        "I rebuild billing and subscription systems for B2B SaaS teams — migrations off "
        "legacy processors, dunning and retry logic, proration edge cases. Usually brought "
        "in when invoicing has grown organically and quietly started losing money."
    ),
    "portfolio": [
        {
            "title": "Stripe Billing migration for a B2B SaaS",
            "summary": (
                "Migrated a legacy invoicing flow to Stripe Billing, cutting failed-payment "
                "churn by 40% and removing three weeks of manual reconciliation a quarter."
            ),
            "tags": ["stripe", "billing", "saas"],
        },
        {
            "title": "Dunning rebuild for a 40k-subscriber platform",
            "summary": (
                "Replaced a single retry-on-failure with a staged dunning ladder; recovered "
                "18% of previously written-off revenue in the first quarter."
            ),
            "tags": ["dunning", "retention"],
        },
    ],
    "voice_samples": [
        "Hi Sam — had a look at the repo. The retry logic is the bit I'd start with: right now a "
        "failed charge is retried once and then written off, which is where most of the leakage "
        "is. Happy to walk through what a staged ladder would look like."
    ],
}

# Three conversations at three different points in the spine, so the
# Money screen shows a quote out, an invoice overdue, and one paid.
THREADS = [
    {
        "key": "whitecliff",
        "contact_name": "Priya Shah",
        "contact_email": "priya@whitecliff.example",
        "intent": "Stripe subscription billing migration",
        "stage": "qualified",
        "score": "hot",
        "score_rationale": (
            "Names the exact failed-payment problem in the portfolio, has a stated budget "
            "above the floor, and wants it inside a month."
        ),
        "estimated_value": 12000,
        "messages": [
            (
                "inbound",
                7.0,
                "Hi! We're a small SaaS company (about 200 customers) and our billing has grown "
                "organically on top of a processor we've outgrown. Failed payments just get "
                "written off. We'd like to move to Stripe Billing, ideally within a month. "
                "Budget is around $12k. Is that something you take on?",
            ),
            (
                "outbound",
                6.8,
                "Thanks for reaching out — that is close to exactly the migration I did for a "
                "B2B SaaS last year, where cleaning up failed payments cut churn by 40%.\n\n"
                "Two things before I can price it properly: how are subscriptions modelled "
                "today (fixed plans, usage, or a mix), and is there anything currently reading "
                "the invoice data downstream — accounting, a CRM?",
            ),
            (
                "inbound",
                5.2,
                "Mostly fixed plans with two usage add-ons. Invoices get exported to Xero once "
                "a month by hand, which is honestly part of why we want this fixed.",
            ),
        ],
    },
    {
        "key": "halden",
        "contact_name": "Morgan Lee",
        "contact_email": "morgan@halden.example",
        "intent": "Billing audit and dunning rebuild",
        "stage": "quoted",
        "score": "warm",
        "score_rationale": "Smaller scope than usual but squarely in the dunning work she has done before.",
        "estimated_value": 4750,
        "messages": [
            (
                "inbound",
                34.0,
                "We run a design agency and our client invoicing is still in spreadsheets. We'd "
                "like recurring retainer billing in Stripe. Around $5k budget.",
            ),
            (
                "outbound",
                33.5,
                "That is a clean piece of work and I can scope it tightly. Quote to follow.",
            ),
        ],
        "quote": {
            "status": "accepted",
            "line_items": [
                ("Stripe integration setup and API configuration", 10, "hour", 95),
                ("Recurring retainer billing (plans, proration, webhooks)", 8, "hour", 95),
                ("Spreadsheet migration and mapping", 12, "hour", 95),
                ("Testing, QA and handover", 20, "hour", 95),
            ],
            "timeline": "3 weeks from kickoff",
            "sent_days_ago": 32,
        },
        "invoice": {
            "number": "INV-0001",
            "status": "sent",
            "issued_days_ago": 28,
            "due_days_ago": 14,
            "chase_count": 2,
            "last_chased_days_ago": 6,
        },
    },
    {
        "key": "nordlys",
        "contact_name": "Jonas Berg",
        "contact_email": "jonas@nordlys.example",
        "intent": "Checkout rebuild and retry logic",
        "stage": "won",
        "score": "hot",
        "score_rationale": "Direct match to the dunning rebuild in the portfolio.",
        "estimated_value": 7400,
        "messages": [
            ("inbound", 72.0, "Our checkout drops about 8% of cards on first attempt. Can you help?"),
            ("outbound", 71.5, "Yes — that is usually retry timing rather than the cards. Quote attached."),
            ("inbound", 64.0, "Approved, let's go."),
        ],
        "quote": {
            "status": "accepted",
            "line_items": [
                ("Checkout retry and dunning rebuild", 60, "hour", 95),
                ("Instrumentation and reporting", 18, "hour", 95),
            ],
            "timeline": "5 weeks",
            "sent_days_ago": 66,
        },
        "invoice": {
            "number": "INV-0002",
            "status": "paid",
            "issued_days_ago": 30,
            "due_days_ago": 16,
            "paid_days_ago": 12,
            "chase_count": 1,
            "last_chased_days_ago": 15,
        },
    },
]

# Cached postings, so the Opportunities screen has something to show
# without three job boards having to be up.
OPPORTUNITIES = [
    {
        "external_id": f"{DEMO_EXTERNAL_PREFIX}hn-billing-migration",
        "title": "Stripe Billing migration for a B2B SaaS",
        "author": "whitecliff_eng",
        "url": "https://news.ycombinator.com/item?id=1",
        "body": (
            "We're looking for a contractor to move our subscription billing off a legacy "
            "processor and onto Stripe Billing. Proration and dunning are the hard parts. "
            "Roughly 6 weeks, budget in the low five figures."
        ),
        "fit_score": 86,
        "fit_rationale": (
            "Near-exact match to the invoicing migration in the portfolio: same processor "
            "story, same failed-payment problem, same subscription shape."
        ),
        "fit_evidence": {
            "evidence": [
                "Migrated a legacy invoicing flow to Stripe Billing, cutting failed-payment churn by 40%",
                "Portfolio lists dunning and proration work explicitly",
            ],
            "concerns": ["Timeline is tight against 25 hours a week"],
        },
        "status": "scored",
        "link_status": "live",
        "link_note": "resolved and still open",
    },
    {
        "external_id": f"{DEMO_EXTERNAL_PREFIX}remotive-payments-react",
        "title": "Contract React engineer, payments team",
        "author": "Nordlys",
        "url": "https://remotive.com/remote-jobs/demo-1",
        "body": "Six-month contract on our payments squad. React and TypeScript, some Node.",
        "fit_score": 74,
        "fit_rationale": "Payments-adjacent front-end at the right seniority; six-month term fits stated availability.",
        "fit_evidence": {
            "evidence": ["TypeScript and React both listed", "Payments domain match"],
            "concerns": ["More front-end than the billing work she usually takes"],
        },
        "status": "scored",
        "link_status": "live",
        "link_note": "resolved and still open",
    },
    {
        "external_id": f"{DEMO_EXTERNAL_PREFIX}remoteok-analytics",
        "title": "Subscription analytics dashboard build",
        "author": "Kestrel Labs",
        "url": "https://remoteok.com/remote-jobs/demo-2",
        "body": "Build a churn and MRR dashboard. Mostly charting work on top of an existing API.",
        "fit_score": 38,
        "fit_rationale": "Relevant domain, but the brief is charting with no billing logic — thin evidence in the portfolio.",
        "fit_evidence": {
            "evidence": ["Subscription domain familiarity"],
            "concerns": ["No billing logic at all", "Stated budget is under her floor"],
        },
        "status": "scored",
        "link_status": "live",
        "link_note": "resolved and still open",
    },
    {
        "external_id": f"{DEMO_EXTERNAL_PREFIX}hn-filled-role",
        "title": "Senior Platform Engineer (contract)",
        "author": "closed_co",
        "url": "https://news.ycombinator.com/item?id=2",
        "body": "Contract platform role, 3 months, remote.",
        "fit_score": 61,
        "fit_rationale": "Reasonable stack overlap, but the posting is no longer open.",
        "fit_evidence": {"evidence": ["Postgres and Node overlap"], "concerns": []},
        "status": "scored",
        # The one dead posting, so the Opportunities screen demonstrates
        # the refusal rather than only claiming it happens.
        "link_status": "gone",
        "link_note": "the comment was deleted",
    },
]


def price(line_items: list[tuple[str, float, str, float]]) -> tuple[list[dict], float]:
    rows, total = [], 0.0
    for description, quantity, unit, unit_price in line_items:
        amount = round(quantity * unit_price, 2)
        rows.append(
            {
                "description": description,
                "quantity": quantity,
                "unit": unit,
                "unit_price": unit_price,
                "amount": amount,
            }
        )
        total += amount
    return rows, round(total, 2)


def wipe(client, account: str) -> None:
    """Remove only what this script created, identified by its own marks."""
    threads = (
        client.table("thread").select("id").eq("user_id", account).eq("channel", DEMO_CHANNEL).execute()
    ).data or []
    thread_ids = [t["id"] for t in threads]

    deals = (
        client.table("deal").select("id").eq("user_id", account).eq("source", DEMO_SOURCE).execute()
    ).data or []
    deal_ids = [d["id"] for d in deals]

    for deal_id in deal_ids:
        client.table("invoice").delete().eq("deal_id", deal_id).execute()
        client.table("quote").delete().eq("deal_id", deal_id).execute()
    for thread_id in thread_ids:
        client.table("message").delete().eq("thread_id", thread_id).execute()
    for deal_id in deal_ids:
        client.table("deal").delete().eq("id", deal_id).execute()
    for thread_id in thread_ids:
        client.table("thread").delete().eq("id", thread_id).execute()

    client.table("opportunity").delete().eq("user_id", account).like(
        "external_id", f"{DEMO_EXTERNAL_PREFIX}%"
    ).execute()

    print(f"wiped {len(thread_ids)} threads, {len(deal_ids)} deals and their demo opportunities")


def seed(account: str) -> None:
    client = get_client()

    existing = (
        client.table("profile").select("id").eq("user_id", account).maybe_single().execute()
    )
    payload = {**PROFILE, "user_id": account}
    if existing and existing.data:
        client.table("profile").update(payload).eq("user_id", account).execute()
    else:
        client.table("profile").insert(payload).execute()
    print(f"profile: {PROFILE['name']}")

    source = (
        client.table("source")
        .upsert(
            {"user_id": account, "kind": "hacker_news", "name": "Hacker News", "enabled": True},
            on_conflict="user_id,kind",
        )
        .execute()
    ).data[0]

    for item in OPPORTUNITIES:
        client.table("opportunity").upsert(
            {
                **item,
                "user_id": account,
                "source_id": source["id"],
                "posted_at": ago(3),
                "link_checked_at": ago(0.1),
                "raw": {"seeded": True},
            },
            on_conflict="user_id,external_id",
        ).execute()
    print(f"opportunities: {len(OPPORTUNITIES)} (one deliberately dead, to show the refusal)")

    for spec in THREADS:
        thread = (
            client.table("thread")
            .insert(
                {
                    "user_id": account,
                    "contact_name": spec["contact_name"],
                    "contact_email": spec["contact_email"],
                    "channel": DEMO_CHANNEL,
                    "last_message_at": ago(spec["messages"][-1][1]),
                }
            )
            .execute()
        ).data[0]

        for direction, days, body in spec["messages"]:
            client.table("message").insert(
                {
                    "thread_id": thread["id"],
                    "user_id": account,
                    "direction": direction,
                    "body": body,
                    "sent_at": ago(days),
                }
            ).execute()

        deal = (
            client.table("deal")
            .insert(
                {
                    "user_id": account,
                    "thread_id": thread["id"],
                    "intent": spec["intent"],
                    "stage": spec["stage"],
                    "score": spec["score"],
                    "score_rationale": spec["score_rationale"],
                    "estimated_value": spec["estimated_value"],
                    "source": DEMO_SOURCE,
                }
            )
            .execute()
        ).data[0]

        quote_spec = spec.get("quote")
        quote_id = None
        if quote_spec:
            line_items, total = price(quote_spec["line_items"])
            quote = (
                client.table("quote")
                .insert(
                    {
                        "user_id": account,
                        "deal_id": deal["id"],
                        "currency": "USD",
                        "line_items": line_items,
                        "subtotal": total,
                        "total": total,
                        "timeline": quote_spec["timeline"],
                        "payment_terms": "Net 14",
                        "status": quote_spec["status"],
                        "sent_at": ago(quote_spec["sent_days_ago"]),
                        "decided_at": ago(quote_spec["sent_days_ago"] - 2),
                        "valid_until": ahead(4),
                    }
                )
                .execute()
            ).data[0]
            quote_id = quote["id"]

        invoice_spec = spec.get("invoice")
        if invoice_spec:
            line_items, total = price(quote_spec["line_items"])  # type: ignore[index]
            client.table("invoice").insert(
                {
                    "user_id": account,
                    "deal_id": deal["id"],
                    "quote_id": quote_id,
                    "number": invoice_spec["number"],
                    "currency": "USD",
                    "amount": total,
                    "line_items": line_items,
                    "payment_terms": "Net 14",
                    "status": invoice_spec["status"],
                    "issued_at": ago(invoice_spec["issued_days_ago"]),
                    "due_at": ago(invoice_spec["due_days_ago"]),
                    "paid_at": ago(invoice_spec["paid_days_ago"]) if "paid_days_ago" in invoice_spec else None,
                    "chase_count": invoice_spec["chase_count"],
                    "last_chased_at": ago(invoice_spec["last_chased_days_ago"]),
                }
            ).execute()

        print(f"thread: {spec['contact_name']} ({spec['stage']})")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--account", help="workspace id to seed; a new one is created if omitted")
    parser.add_argument("--wipe", action="store_true", help="remove this script's rows and stop")
    args = parser.parse_args()

    account = args.account or create_account()
    client = get_client()

    if args.wipe:
        if not args.account:
            parser.error("--wipe needs --account: it will not create a workspace just to empty it")
        wipe(client, account)
        return

    print(f"workspace {account}")
    wipe(client, account)  # idempotent: re-seeding never doubles up
    seed(account)
    print()
    print("Seeded. To use it, set this cookie on the app's origin:")
    print(f"  document.cookie = 'cw_account={account}; Path=/; Max-Age=31536000; SameSite=Lax'")
    print()
    print("Runs, events and approvals are deliberately NOT faked -- trigger one real")
    print("run so the Run Trace shows work that actually happened.")


if __name__ == "__main__":
    main()
