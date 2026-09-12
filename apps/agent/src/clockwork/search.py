"""Cross-entity search.

The design puts a search box in the header with the placeholder "Search
clients, quotes, runs", and that promise is only worth making if it
actually searches all three. A box that filters whatever list happens to
be on screen is worse than no box: it looks like search and behaves like
a filter, so the first thing a user does -- search for a client while
looking at the Money screen -- returns nothing and teaches them the
feature is broken.

So this queries every entity a person might be looking for and returns
one ranked list. Postgres `ilike` rather than full-text search: at the
scale one freelancer's workspace reaches (hundreds of rows, not
millions) a substring match is exact, predictable and needs no index
maintenance, and "why didn't my search find it" is a worse problem than
"my search took 80ms".
"""

from __future__ import annotations

from dataclasses import asdict, dataclass

from .db import get_client

# Per entity, not overall -- a workspace with 200 opportunities should
# not push its three invoices off the results.
PER_KIND = 8


@dataclass
class Hit:
    kind: str  # opportunity | thread | deal | quote | invoice | run
    id: str
    title: str
    subtitle: str | None
    href: str
    meta: str | None = None


def _escape(term: str) -> str:
    """PostgREST passes `%` and `_` straight into LIKE, so a user
    searching for "50%" would otherwise match everything."""
    return term.replace("%", r"\%").replace("_", r"\_")


def search(user_id: str, query: str, *, limit_per_kind: int = PER_KIND) -> dict:
    term = (query or "").strip()
    if len(term) < 2:
        # One character matches half the workspace and reads as noise.
        return {"query": term, "hits": [], "note": "Type at least two characters."}

    client = get_client()
    pattern = f"%{_escape(term)}%"
    hits: list[Hit] = []

    def rows(table: str, select: str, or_filter: str):
        return (
            client.table(table)
            .select(select)
            .eq("user_id", user_id)
            .or_(or_filter)
            .limit(limit_per_kind)
            .execute()
        ).data or []

    for row in rows(
        "opportunity",
        "id, title, author, fit_score, status, link_status",
        f"title.ilike.{pattern},body.ilike.{pattern},author.ilike.{pattern}",
    ):
        hits.append(
            Hit(
                kind="opportunity",
                id=row["id"],
                title=row.get("title") or "Untitled posting",
                subtitle=row.get("author"),
                href="/opportunities",
                meta=f"fit {row['fit_score']}" if row.get("fit_score") is not None else row.get("status"),
            )
        )

    for row in rows(
        "thread",
        "id, contact_name, contact_email, channel",
        f"contact_name.ilike.{pattern},contact_email.ilike.{pattern}",
    ):
        hits.append(
            Hit(
                kind="thread",
                id=row["id"],
                title=row.get("contact_name") or "Unknown contact",
                subtitle=row.get("contact_email"),
                href=f"/threads/{row['id']}",
                meta=row.get("channel"),
            )
        )

    for row in rows(
        "deal",
        "id, thread_id, intent, stage, estimated_value",
        f"intent.ilike.{pattern},score_rationale.ilike.{pattern}",
    ):
        hits.append(
            Hit(
                kind="deal",
                id=row["id"],
                title=row.get("intent") or "Untitled deal",
                subtitle=None,
                href=f"/threads/{row['thread_id']}",
                meta=row.get("stage"),
            )
        )

    # Messages are searched but reported as their thread: a person
    # looking for "the Stripe migration email" wants the conversation,
    # not a row id they cannot open.
    seen_threads = {h.id for h in hits if h.kind == "thread"}
    for row in rows("message", "id, thread_id, body, direction", f"body.ilike.{pattern}"):
        if row["thread_id"] in seen_threads:
            continue
        seen_threads.add(row["thread_id"])
        body = " ".join((row.get("body") or "").split())
        hits.append(
            Hit(
                kind="message",
                id=row["thread_id"],
                title=body[:90] + ("…" if len(body) > 90 else ""),
                subtitle=f"{row['direction']} message",
                href=f"/threads/{row['thread_id']}",
            )
        )

    for row in rows("invoice", "id, number, amount, currency, status", f"number.ilike.{pattern}"):
        hits.append(
            Hit(
                kind="invoice",
                id=row["id"],
                title=f"{row['number']} — {row['currency']} {float(row['amount']):,.2f}",
                subtitle=None,
                href="/money",
                meta=row.get("status"),
            )
        )

    for row in rows("agent_run", "id, trigger_type, outcome, status", f"outcome.ilike.{pattern}"):
        outcome = " ".join((row.get("outcome") or "").split())
        hits.append(
            Hit(
                kind="run",
                id=row["id"],
                title=outcome[:90] + ("…" if len(outcome) > 90 else "") or f"{row['trigger_type']} run",
                subtitle=f"{row['trigger_type']} trigger",
                href=f"/runs/{row['id']}",
                meta=row.get("status"),
            )
        )

    return {"query": term, "hits": [asdict(h) for h in hits], "note": None}
