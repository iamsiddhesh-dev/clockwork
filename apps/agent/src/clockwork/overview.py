"""What the dashboard shows, computed from real rows.

Every number on the Overview screen is derived here from the same tables
the agent writes to -- there is no separate analytics store and nothing
is estimated. Where a figure genuinely cannot be known yet (a success
rate with no completed runs), this returns None and the UI says so rather
than printing a confident zero.

Kept out of api.py because it is the only part of the HTTP surface doing
real aggregation, and because the Overview is the screen most likely to
grow another tile the week after a deadline.
"""

from collections import defaultdict
from datetime import datetime, timedelta, timezone

from .clock import now as clock_now
from .db import get_client
from .ledger import _daily_spend_cap, spent_today_usd

# How far back the cost sparkline looks. Two weeks is long enough to show
# a trend and short enough that every bar is a day the user remembers.
COST_WINDOW_DAYS = 14

# The four stages of the spine, in the order work moves through them.
# These are lanes of one agent's work, not separate agents -- the names
# describe which tools ran, and the UI labels them Workflows for exactly
# that reason.
WORKFLOWS = [
    {
        "key": "sourcing",
        "name": "Sourcing",
        "blurb": "Pulls contract work from Hacker News, Remotive and RemoteOK, then scores each posting against your profile.",
        "tools": ["score_fit"],
        "action_types": [],
    },
    {
        "key": "pitch",
        "name": "Pitching",
        "blurb": "Writes outreach in your voice, citing the portfolio result that earned the score.",
        "tools": ["draft_pitch"],
        "action_types": ["send_pitch"],
    },
    {
        "key": "quote",
        "name": "Quoting",
        "blurb": "Prices agreed work off your rate card. Totals are computed in code, never by the model.",
        "tools": ["draft_quote", "draft_invoice"],
        "action_types": ["send_quote", "send_invoice"],
    },
    {
        "key": "collections",
        "name": "Collections",
        "blurb": "Tracks what is owed and escalates the reminder each time one goes unanswered.",
        "tools": ["chase_payment"],
        "action_types": ["send_payment_chase"],
    },
]


def _rows(table: str, user_id: str, select: str = "*", **filters) -> list[dict]:
    q = get_client().table(table).select(select).eq("user_id", user_id)
    for key, value in filters.items():
        q = q.eq(key, value)
    return (q.execute()).data or []


def _iso(value) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value))
    except ValueError:
        return None


def summary(user_id: str) -> dict:
    """The cheap payload the app chrome polls: badge count, spend against
    the cap, and when the agent next wakes up."""
    client = get_client()
    now = clock_now(user_id)

    pending = (
        client.table("approval")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "pending")
        .execute()
    ).data or []

    running = (
        client.table("agent_run")
        .select("id")
        .eq("user_id", user_id)
        .eq("status", "running")
        .execute()
    ).data or []

    tasks = _rows("task", user_id, "id, kind, due_at, payload", status="pending")
    upcoming = sorted(
        (t for t in tasks if _iso(t["due_at"])),
        key=lambda t: _iso(t["due_at"]),  # type: ignore[arg-type]
    )
    next_task = upcoming[0] if upcoming else None

    return {
        "now": now.isoformat(),
        "pending_approvals": len(pending),
        "running": len(running) > 0,
        "spent_today_usd": round(spent_today_usd(user_id), 4),
        "daily_cap_usd": _daily_spend_cap(user_id),
        "next_task": (
            {
                "kind": next_task["kind"],
                "due_at": next_task["due_at"],
                "reason": (next_task.get("payload") or {}).get("reason"),
            }
            if next_task
            else None
        ),
        "pending_tasks": len(tasks),
    }


def _cost_series(user_id: str) -> list[dict]:
    """Daily model spend for the last two weeks, zero-filled.

    Zero-filling matters: without it a quiet day is simply absent and the
    chart silently compresses time, which makes a sporadic week look like
    a busy one.
    """
    start = datetime.now(timezone.utc) - timedelta(days=COST_WINDOW_DAYS - 1)
    start = start.replace(hour=0, minute=0, second=0, microsecond=0)
    rows = (
        get_client()
        .table("token_ledger")
        .select("cost_usd, created_at")
        .eq("user_id", user_id)
        .gte("created_at", start.isoformat())
        .execute()
    ).data or []

    per_day: dict[str, float] = defaultdict(float)
    for row in rows:
        stamp = _iso(row["created_at"])
        if stamp:
            per_day[stamp.date().isoformat()] += float(row["cost_usd"])

    return [
        {
            "day": (start + timedelta(days=offset)).date().isoformat(),
            "usd": round(per_day.get((start + timedelta(days=offset)).date().isoformat(), 0.0), 6),
        }
        for offset in range(COST_WINDOW_DAYS)
    ]


def _workflow_lanes(
    user_id: str,
    events: list[dict],
    approvals: list[dict],
    *,
    opportunities: list[dict],
    quotes: list[dict],
    invoices: list[dict],
) -> list[dict]:
    """Turn real rows into the four lanes the UI shows.

    Counting only `agent_event.tool_name` was the obvious implementation
    and it was wrong: work started from a screen (onboarding's kickoff,
    the Opportunities buttons) calls the tool functions directly rather
    than through the orchestrator, so it writes no tool_call event. The
    dashboard cheerfully reported "0 of 4 workflows have run" seconds
    after sourcing 67 postings, which is the single most damaging thing a
    status board can do -- be confidently wrong about something the user
    just watched happen.

    So each lane is measured by what it actually produced, and the event
    log only supplies cost and timing on top.
    """
    by_tool: dict[str, list[dict]] = defaultdict(list)
    for event in events:
        if event.get("tool_name"):
            by_tool[event["tool_name"]].append(event)

    pending_by_type: dict[str, int] = defaultdict(int)
    for approval in approvals:
        if approval["status"] == "pending":
            pending_by_type[approval["action_type"]] += 1

    scored = [o for o in opportunities if o.get("fit_score") is not None]
    pitched = [o for o in opportunities if o.get("status") in ("pitched", "converted")]
    live_invoices = [i for i in invoices if i["status"] in ("sent", "paid")]
    chased = [i for i in invoices if (i.get("chase_count") or 0) > 0]

    # What each lane has to show for itself, in its own units.
    produced = {
        "sourcing": (
            len(opportunities),
            f"{len(scored)} of {len(opportunities)} scored" if opportunities else None,
        ),
        "pitch": (len(pitched), f"{len(pitched)} pitched" if pitched else None),
        "quote": (
            len(quotes) + len(live_invoices),
            ", ".join(
                part
                for part in (
                    f"{len(quotes)} quote{'' if len(quotes) == 1 else 's'}" if quotes else "",
                    f"{len(live_invoices)} invoice{'' if len(live_invoices) == 1 else 's'}"
                    if live_invoices
                    else "",
                )
                if part
            )
            or None,
        ),
        "collections": (
            len(chased),
            (
                lambda n: f"{n} reminder{'' if n == 1 else 's'} sent"
            )(sum(i.get("chase_count") or 0 for i in chased))
            if chased
            else None,
        ),
    }

    lanes = []
    for spec in WORKFLOWS:
        waiting = sum(pending_by_type.get(a, 0) for a in spec["action_types"])
        calls = [e for tool in spec["tools"] for e in by_tool.get(tool, [])]
        last = max((e["created_at"] for e in calls), default=None)
        cost = round(sum(float(e.get("cost_usd") or 0) for e in calls), 4)
        count, detail = produced[spec["key"]]

        if waiting:
            state, tone = f"{waiting} awaiting approval", "pending"
        elif detail:
            state, tone = detail, "done"
        else:
            state, tone = "not run yet", "idle"

        lanes.append(
            {
                "key": spec["key"],
                "name": spec["name"],
                "blurb": spec["blurb"],
                "tools": spec["tools"],
                "state": state,
                "tone": tone,
                "waiting": waiting,
                "last_at": last,
                "produced": count,
                "calls": len(calls),
                "cost_usd": cost,
            }
        )
    return lanes


def overview(user_id: str) -> dict:
    """Everything the dashboard renders, in one round trip."""
    client = get_client()
    now = clock_now(user_id)

    runs = (
        client.table("agent_run")
        .select("id, trigger_type, status, started_at, outcome, total_cost_usd")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
        .limit(40)
        .execute()
    ).data or []

    events = (
        client.table("agent_event")
        .select("id, run_id, kind, tool_name, rationale, cost_usd, created_at")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .limit(120)
        .execute()
    ).data or []

    approvals = _rows("approval", user_id, "id, action_type, status, created_at")
    opportunities = _rows("opportunity", user_id, "id, status, fit_score")
    invoices = _rows(
        "invoice", user_id, "id, amount, status, due_at, paid_at, issued_at, chase_count"
    )
    quotes = _rows("quote", user_id, "id, total, status")

    finished = [r for r in runs if r["status"] in ("completed", "failed")]
    success_rate = (
        round(len([r for r in finished if r["status"] == "completed"]) / len(finished), 4)
        if finished
        else None
    )

    outstanding = sum(float(i["amount"]) for i in invoices if i["status"] == "sent")
    collected = sum(float(i["amount"]) for i in invoices if i["status"] == "paid")
    overdue = [
        i
        for i in invoices
        if i["status"] == "sent" and (_iso(i["due_at"]) or now) < now
    ]

    # Days from issue to payment, averaged over invoices that actually got
    # paid. Empty rather than zero when nothing has been paid yet.
    turnarounds = []
    for invoice in invoices:
        issued, paid = _iso(invoice["issued_at"]), _iso(invoice["paid_at"])
        if issued and paid:
            turnarounds.append((paid - issued).days)
    avg_days_to_paid = (
        round(sum(turnarounds) / len(turnarounds), 1) if turnarounds else None
    )

    scored = [o for o in opportunities if o.get("fit_score") is not None]
    strong = [o for o in scored if (o["fit_score"] or 0) >= 60]

    tasks = _rows("task", user_id, "id, kind, subject_type, due_at, payload", status="pending")
    scheduled = sorted(
        (t for t in tasks if _iso(t["due_at"])),
        key=lambda t: _iso(t["due_at"]),  # type: ignore[arg-type]
    )[:4]

    activity = [
        {
            "id": event["id"],
            "run_id": event["run_id"],
            "kind": event["kind"],
            "tool": event["tool_name"],
            "text": event.get("rationale") or event.get("tool_name") or event["kind"],
            "cost_usd": float(event["cost_usd"]) if event.get("cost_usd") else None,
            "at": event["created_at"],
        }
        for event in events[:8]
    ]

    return {
        "summary": summary(user_id),
        "metrics": {
            "opportunities_scored": len(scored),
            "opportunities_strong": len(strong),
            "opportunities_total": len(opportunities),
            "pending_approvals": len([a for a in approvals if a["status"] == "pending"]),
            "quotes_out": len([q for q in quotes if q["status"] == "sent"]),
            "quotes_accepted": len([q for q in quotes if q["status"] == "accepted"]),
            "outstanding_usd": round(outstanding, 2),
            "collected_usd": round(collected, 2),
            "overdue_count": len(overdue),
            "avg_days_to_paid": avg_days_to_paid,
        },
        "runs": {
            "total": len(runs),
            "success_rate": success_rate,
            "last_at": runs[0]["started_at"] if runs else None,
            "recent": runs[:5],
        },
        "workflows": _workflow_lanes(
            user_id,
            events,
            approvals,
            opportunities=opportunities,
            quotes=quotes,
            invoices=invoices,
        ),
        "activity": activity,
        "cost_series": _cost_series(user_id),
        "scheduled": [
            {
                "kind": task["kind"],
                "subject_type": task["subject_type"],
                "due_at": task["due_at"],
                "reason": (task.get("payload") or {}).get("reason"),
            }
            for task in scheduled
        ],
    }
