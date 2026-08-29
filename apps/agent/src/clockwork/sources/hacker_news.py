"""Hacker News, via the free Algolia API. No auth, no key, no scraping.

PLAN.md originally targeted the monthly *"Ask HN: Freelancer? Seeking
freelancer?"* thread. **That thread was discontinued after October 2025**
-- verified against the live API on Aug 30, 2026: the `whoishiring` bot
still posts monthly, but only "Who is hiring?" and "Who wants to be
hired?" editions now.

So this targets "Who is hiring?" instead and filters for contract /
freelance / part-time signals. Measured on the August 2026 thread: 240
top-level comments, 20 carrying such a signal. Fewer than the dead
freelancer thread would have given, but real, current, and free.

The thread id is looked up each run rather than hardcoded -- a new one
appears on the 1st of every month.
"""

from datetime import datetime, timezone
from typing import Any

import httpx

from .base import RawOpportunity, looks_freelance, strip_html

ALGOLIA = "https://hn.algolia.com/api/v1"
TIMEOUT = 30.0


class HackerNewsAdapter:
    kind = "hacker_news"
    name = "Hacker News — Who is hiring?"

    def _latest_thread_id(self, client: httpx.Client) -> tuple[str, str] | None:
        """Newest 'Who is hiring?' story by the whoishiring bot."""
        res = client.get(
            f"{ALGOLIA}/search_by_date",
            params={
                "query": "Who is hiring",
                "tags": "story,author_whoishiring",
                "hitsPerPage": 1,
            },
        )
        res.raise_for_status()
        hits = res.json().get("hits", [])
        if not hits:
            return None
        return str(hits[0]["objectID"]), hits[0].get("title", "Who is hiring?")

    def fetch(self, config: dict[str, Any]) -> list[RawOpportunity]:
        limit = int(config.get("limit", 40))

        with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
            found = self._latest_thread_id(client)
            if not found:
                return []
            thread_id, thread_title = found

            res = client.get(f"{ALGOLIA}/items/{thread_id}")
            res.raise_for_status()
            thread = res.json()

        out: list[RawOpportunity] = []
        for child in thread.get("children", []):
            text = child.get("text")
            if not text or child.get("author") is None:
                continue  # deleted/empty comment

            body = strip_html(text)
            if not looks_freelance(body):
                continue

            # HN posts follow "Company | Location | Role | ..." on the
            # first line by convention -- close enough to a title, and
            # far more readable in a list than the first 80 chars of
            # whatever prose follows.
            title = body.split("\n", 1)[0][:200].strip() or "Untitled HN post"

            posted_at = None
            if child.get("created_at"):
                try:
                    posted_at = datetime.fromisoformat(
                        child["created_at"].replace("Z", "+00:00")
                    ).astimezone(timezone.utc)
                except ValueError:
                    pass

            out.append(
                RawOpportunity(
                    external_id=f"hn:{child['id']}",
                    title=title,
                    body=body,
                    url=f"https://news.ycombinator.com/item?id={child['id']}",
                    author=child.get("author"),
                    posted_at=posted_at,
                    raw={"thread_id": thread_id, "thread_title": thread_title, "comment": child},
                )
            )
            if len(out) >= limit:
                break

        return out
