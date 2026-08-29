"""Source registry + the fetch/normalize/cache path.

`sync_sources(user_id)` is the whole outbound-sourcing entry point: run
every enabled adapter, upsert what comes back into `opportunity`, and
record per-source success/failure. One adapter blowing up (a feed down,
a shape change) must never take the others with it -- a demo that shows
two of three sources is fine, a demo that shows a stack trace is not.
"""

import logging
from typing import Any

from ..clock import now as clock_now
from ..db import get_client
from .base import RawOpportunity, SourceAdapter
from .hacker_news import HackerNewsAdapter
from .remoteok import RemoteOkAdapter
from .remotive import RemotiveAdapter

logger = logging.getLogger("clockwork.sources")

ADAPTERS: dict[str, SourceAdapter] = {
    a.kind: a
    for a in (HackerNewsAdapter(), RemotiveAdapter(), RemoteOkAdapter())
}

# What a brand-new user gets. All three are free, public, and need no
# credentials -- see each adapter's docstring for its licence conditions
# (RemoteOK requires attribution wherever results are shown).
DEFAULT_SOURCES = [
    {"kind": a.kind, "name": a.name, "config": {}, "enabled": True} for a in ADAPTERS.values()
]


def ensure_sources(user_id: str) -> list[dict]:
    """Give a user the default feed set if they have none yet, and return
    their sources. Called before every sync so a fresh account works
    without a separate setup step."""
    client = get_client()
    existing = client.table("source").select("*").eq("user_id", user_id).execute()
    if existing.data:
        return existing.data

    created = (
        client.table("source")
        .insert([{**s, "user_id": user_id} for s in DEFAULT_SOURCES])
        .execute()
    )
    return created.data


def _upsert_opportunities(user_id: str, source_id: str, items: list[RawOpportunity]) -> int:
    """Write a batch, deduped on (user_id, external_id).

    `on_conflict` updates rather than inserts, so re-running a sync
    refreshes existing rows instead of piling up duplicates. Deliberately
    does NOT touch fit_score/status: re-fetching a posting must not wipe
    a score you already paid a model to produce, nor un-dismiss something
    the human explicitly rejected.
    """
    if not items:
        return 0

    rows = [
        {
            "user_id": user_id,
            "source_id": source_id,
            "external_id": item.external_id,
            "title": item.title,
            "body": item.body,
            "url": item.url,
            "author": item.author,
            "posted_at": item.posted_at.isoformat() if item.posted_at else None,
            "raw": item.raw,
            "updated_at": "now()",
        }
        for item in items
    ]

    get_client().table("opportunity").upsert(rows, on_conflict="user_id,external_id").execute()
    return len(rows)


def sync_sources(user_id: str, kinds: list[str] | None = None) -> dict[str, Any]:
    """Fetch every enabled source for this user and cache the results.
    Returns a per-source report -- the UI shows this so a silent empty
    result is distinguishable from a feed that errored."""
    client = get_client()
    sources = ensure_sources(user_id)
    report: list[dict[str, Any]] = []
    total = 0

    for source in sources:
        kind = source["kind"]
        if kinds and kind not in kinds:
            continue
        if not source.get("enabled", True):
            continue

        adapter = ADAPTERS.get(kind)
        if adapter is None:
            report.append({"kind": kind, "ok": False, "error": "no adapter registered"})
            continue

        try:
            items = adapter.fetch(source.get("config") or {})
            count = _upsert_opportunities(user_id, source["id"], items)
            total += count
            client.table("source").update(
                {"last_fetched_at": clock_now(user_id).isoformat(), "last_error": None}
            ).eq("id", source["id"]).execute()
            report.append({"kind": kind, "ok": True, "fetched": count})
        except Exception as exc:
            # One bad feed must not sink the sync -- record and continue.
            logger.exception("source %s failed", kind)
            client.table("source").update({"last_error": str(exc)[:500]}).eq(
                "id", source["id"]
            ).execute()
            report.append({"kind": kind, "ok": False, "error": str(exc)[:300]})

    return {"total": total, "sources": report}


__all__ = ["ADAPTERS", "ensure_sources", "sync_sources"]
