"""Seed a demo workspace: one freelancer profile + one inbound lead, so
run_agent() and the API can be exercised against real Supabase rows
instead of nothing.

Idempotent: reruns find the same demo auth user (by fixed email) and wipe
just that user's thread/deal/run data before reseeding, so this doubles
as the "one-command demo reset" the plan calls for later (Phase 4 will
wire this to a UI button; for now it's a script).

Run:
    cd apps/agent && .venv/Scripts/python.exe scripts/seed.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent / "src"))

from clockwork.db import get_client  # noqa: E402

DEMO_EMAIL = "demo@clockwork.dev"

PROFILE = {
    "name": "Jordan Rivera",
    "skills": ["React", "Node.js", "Stripe", "Postgres", "TypeScript"],
    "rates": {"hourly": 95, "currency": "USD"},
    "positioning": (
        "Freelance full-stack engineer specializing in payments and "
        "subscription billing integrations for SaaS products."
    ),
    "voice_samples": [
        "Thanks for reaching out! Happy to take a look -- could you share "
        "a bit more about your current billing setup and timeline?",
        "Just pushed the staging build, take a look when you get a "
        "chance. Let me know if the checkout flow feels right.",
    ],
    "portfolio": [
        {
            "title": "Stripe subscription migration for a B2B SaaS",
            "summary": (
                "Migrated a legacy invoicing flow to Stripe Billing with "
                "usage-based tiers, cutting failed-payment churn by 40%."
            ),
            "tags": ["Stripe", "subscriptions", "SaaS"],
        },
    ],
    "payment_terms": "50% upfront, 50% on delivery. Net 14 on invoices.",
}

# A realistic inbound lead that's exactly the profile's specialty -- gives
# extract_requirements / qualify_lead / draft_reply real material to work
# with, and lines up with PLAN.md's own example ("cites the Stripe case
# study, quoting the 40% result").
INBOUND_MESSAGE = (
    "Hi! We're a small SaaS company (about 200 customers) and our current "
    "billing is a mess of manual invoices. We need someone to migrate us "
    "onto Stripe with proper subscription tiers and usage-based add-ons. "
    "Budget is roughly $4-6k. Would love to get started within the next "
    "3 weeks if possible -- is this something you handle?"
)


def find_or_create_demo_user(client) -> str:
    users = client.auth.admin.list_users()
    for u in users:
        if u.email == DEMO_EMAIL:
            return u.id

    res = client.auth.admin.create_user(
        {
            "email": DEMO_EMAIL,
            "password": "clockwork-demo-not-a-real-login",
            "email_confirm": True,
            "user_metadata": {"name": "Jordan Rivera (demo)"},
        }
    )
    return res.user.id


def wipe_demo_data(client, user_id: str) -> None:
    """Delete everything tied to this user except the auth user and
    profile itself, so reruns start from a clean pipeline state."""
    # thread delete cascades to message + deal (see schema.sql / FKs)
    client.table("thread").delete().eq("user_id", user_id).execute()
    for table in ("approval", "agent_event", "agent_run", "token_ledger", "task"):
        client.table(table).delete().eq("user_id", user_id).execute()


def upsert_profile(client, user_id: str) -> None:
    existing = (
        client.table("profile").select("id").eq("user_id", user_id).maybe_single().execute()
    )
    if existing and existing.data:
        client.table("profile").update(PROFILE).eq("user_id", user_id).execute()
    else:
        client.table("profile").insert({**PROFILE, "user_id": user_id}).execute()


def ensure_app_setting(client, user_id: str) -> None:
    client.table("app_setting").upsert(
        {"user_id": user_id, "clock_offset_seconds": 0, "daily_spend_cap_usd": 5}
    ).execute()


def seed_thread_and_deal(client, user_id: str) -> tuple[str, str]:
    thread = (
        client.table("thread")
        .insert(
            {
                "user_id": user_id,
                "contact_name": "Priya Shah",
                "contact_email": "priya@example-saas.com",
                "channel": "intake_form",
            }
        )
        .execute()
    )
    thread_id = thread.data[0]["id"]

    client.table("message").insert(
        {
            "thread_id": thread_id,
            "user_id": user_id,
            "direction": "inbound",
            "body": INBOUND_MESSAGE,
        }
    ).execute()

    deal = (
        client.table("deal")
        .insert(
            {
                "user_id": user_id,
                "thread_id": thread_id,
                "stage": "new",
                "source": "intake_form",
                "intent": "Stripe subscription billing migration",
            }
        )
        .execute()
    )
    deal_id = deal.data[0]["id"]

    return thread_id, deal_id


def main() -> None:
    client = get_client()

    user_id = find_or_create_demo_user(client)
    wipe_demo_data(client, user_id)
    upsert_profile(client, user_id)
    ensure_app_setting(client, user_id)
    thread_id, deal_id = seed_thread_and_deal(client, user_id)

    print("Seeded demo workspace:")
    print(f"  user_id   = {user_id}")
    print(f"  thread_id = {thread_id}")
    print(f"  deal_id   = {deal_id}")
    print()
    print("Try it:")
    print(
        "  curl -X POST http://localhost:8000/runs "
        f'-H "Content-Type: application/json" -d \'{{"user_id": "{user_id}", '
        f'"trigger_type": "message", "trigger_ref": "{thread_id}", '
        f'"prompt": "A new inbound message just arrived on thread {thread_id} '
        f"(deal {deal_id}). Qualify the lead and draft a reply.\"}}'"
    )


if __name__ == "__main__":
    main()
