"""Running link verification over a workspace's postings.

Split from `verify.py` on purpose: that module decides whether one link
is alive and touches no database, which is what makes it testable
without a network or a Supabase project. This one owns the batching,
the pacing, and what gets written back.
"""

from __future__ import annotations

import logging
import time
from collections import defaultdict
from concurrent.futures import ThreadPoolExecutor
from datetime import timedelta
from urllib.parse import urlparse

import httpx

from ..clock import now as clock_now
from ..db import get_client
from .verify import USER_AGENT, TIMEOUT_SECONDS, Verification, verify_url

logger = logging.getLogger("clockwork.verify")

# Parallel ACROSS hosts, sequential WITHIN one.
#
# The first version simply threw every link into a six-wide pool, and 19
# of 30 checks came back HTTP 429. Almost all of them were Hacker News:
# most sourced postings are comment permalinks on the same thread, so
# "six at a time" meant six simultaneous requests to one server. The
# classification held up -- they were recorded as "couldn't check"
# rather than wrongly marked gone -- but a checker that gets itself
# throttled two times in three is not much of a checker.
#
# Grouping by host fixes it without slowing anything down that matters:
# different boards still run concurrently, and the only thing serialised
# is the queue that was rude in the first place.
MAX_PARALLEL_HOSTS = 6
# Comfortable for every remaining host now that Hacker News goes
# through its own API rather than its rate-limited web pages.
DELAY_BETWEEN_SAME_HOST_SECONDS = 0.6

# How long a check stays good. A posting that was live an hour ago has
# not plausibly been filled and un-filled since, and re-checking on every
# page load would hammer three job boards for no new information.
FRESH_FOR = timedelta(hours=6)

# What the agent is allowed to act on. `unreachable` is included
# deliberately: it means the *check* failed, not that the role did, and
# refusing to pitch because a board rate-limited us would quietly throw
# away good leads.
ACTIONABLE = {"live", "unreachable", "unchecked"}


def is_dead(link_status: str | None) -> bool:
    """Whether a posting should not be pitched or scored."""
    return link_status in ("gone", "closed")


def _stale(row: dict, now) -> bool:
    if row.get("link_status") in (None, "unchecked"):
        return True
    checked = row.get("link_checked_at")
    if not checked:
        return True
    from datetime import datetime

    try:
        return datetime.fromisoformat(str(checked)) < now - FRESH_FOR
    except ValueError:
        return True


def host_of(url: str | None) -> str:
    """The host a link belongs to, for pacing. Everything unparseable
    shares one bucket, which is correct: if we cannot tell hosts apart we
    should assume they are the same and go slowly.

    Hacker News links are bucketed under the API host they are actually
    checked against, not the page host, so the pacing matches where the
    requests really go.
    """
    try:
        host = (urlparse(url or "").hostname or "unknown").lower()
    except ValueError:
        return "unknown"
    return "hacker-news-api" if host == "news.ycombinator.com" else host


def group_by_host(rows: list[dict]) -> dict[str, list[dict]]:
    buckets: dict[str, list[dict]] = defaultdict(list)
    for row in rows:
        buckets[host_of(row.get("url"))].append(row)
    return dict(buckets)


def _check_all(rows: list[dict]) -> list[tuple[dict, Verification]]:
    """Check every link, parallel across hosts and paced within each."""
    buckets = group_by_host(rows)

    with httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    ) as http:

        def run_bucket(bucket: list[dict]) -> list[tuple[dict, Verification]]:
            out = []
            for index, row in enumerate(bucket):
                if index:
                    time.sleep(DELAY_BETWEEN_SAME_HOST_SECONDS)
                out.append((row, verify_url(row.get("url"), client=http)))
            return out

        workers = min(len(buckets), MAX_PARALLEL_HOSTS) or 1
        with ThreadPoolExecutor(max_workers=workers) as pool:
            return [item for bucket in pool.map(run_bucket, buckets.values()) for item in bucket]


def verify_opportunities(user_id: str, *, limit: int = 40, force: bool = False) -> dict:
    """Check the links on this workspace's live postings.

    Returns a count per outcome, so the UI can say "3 gone, 1 closed"
    rather than a bare "done".
    """
    client = get_client()
    now = clock_now(user_id)

    rows = (
        client.table("opportunity")
        .select("id, url, link_status, link_checked_at")
        .eq("user_id", user_id)
        .in_("status", ["new", "scored"])
        .order("link_checked_at", desc=False)
        .limit(limit * 3)
        .execute()
    ).data or []

    due = [r for r in rows if force or _stale(r, now)][:limit]
    if not due:
        return {"checked": 0, "live": 0, "closed": 0, "gone": 0, "unreachable": 0, "skipped": len(rows)}

    counts = {"live": 0, "closed": 0, "gone": 0, "unreachable": 0}
    results = _check_all(due)

    for row, result in results:
        counts[result.status] = counts.get(result.status, 0) + 1
        client.table("opportunity").update(
            {
                "link_status": result.status,
                "link_note": result.note,
                "link_final_url": result.final_url,
                "link_checked_at": now.isoformat(),
            }
        ).eq("id", row["id"]).eq("user_id", user_id).execute()

    logger.info("verified %d links for %s: %s", len(due), user_id, counts)
    return {"checked": len(due), **counts, "skipped": len(rows) - len(due)}
