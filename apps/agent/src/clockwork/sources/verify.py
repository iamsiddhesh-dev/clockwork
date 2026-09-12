"""Is this posting still real?

Pitching a role that was filled three weeks ago wastes the freelancer's
time and looks sloppy to the one person they were trying to impress. Job
feeds go stale fast, so every sourced link gets checked before it is
worth scoring.

**Why this is not a headless browser.** A browser would answer the same
question, but all three sources here put the posting in the HTML
response -- Hacker News is plain HTML, Remotive is a JSON API, RemoteOK
server-renders. Playwright would cost a 400MB install and seconds per
link to learn what one HTTP request already knows. The case where a
browser genuinely wins is a listing whose "this role is closed" banner
only appears after hydration; if a source like that is ever added, this
module is the right place to special-case it, not the whole pipeline.

Four things are checked, in the order they actually fail:
  1. does the host resolve and answer at all
  2. is the status 2xx (404/410 mean the listing is gone)
  3. did it redirect to a site root -- the classic "listing removed,
     bounced to the homepage" pattern, which returns a cheerful 200 and
     would otherwise read as healthy
  4. does the body say the role is closed
"""

from __future__ import annotations

import re
import time
from dataclasses import dataclass
from urllib.parse import urlparse

import httpx

# Deliberately generous. These are third-party servers being polite to,
# and a slow response is not the same as a dead link.
TIMEOUT_SECONDS = 12.0

# A real browser UA. Several job boards return 403 to obviously-automated
# clients, and a 403 here would be misread as "gone" -- the check has to
# be accurate before it is fastidious.
USER_AGENT = (
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/140.0 Safari/537.36 Clockwork/1.0 "
    "(+link verification for one freelancer's own shortlist)"
)

# Phrases that mean the role is shut. Matched against visible-ish text
# only after tags are stripped, because "closed" appears in markup far
# more often than it appears in prose.
CLOSED_PATTERNS = re.compile(
    r"(?:"
    r"no longer (?:accepting|available|active|open)"
    r"|position (?:has been )?filled"
    r"|this (?:job|role|position|listing) (?:is|has been) (?:closed|filled|expired|removed)"
    r"|applications? (?:are )?closed"
    r"|we(?:'| a)re no longer hiring"
    r"|job (?:posting )?(?:expired|no longer exists)"
    r"|this posting has expired"
    r"|vacancy (?:is )?closed"
    r")",
    re.IGNORECASE,
)

_TAG = re.compile(r"<(script|style)[^>]*>.*?</\1>", re.IGNORECASE | re.DOTALL)
_ANY_TAG = re.compile(r"<[^>]+>")

# Only scan the first slice of the body. A closed banner is at the top of
# a posting, never buried under the footer, and some of these pages are
# a megabyte of inlined JSON.
MAX_SCAN_CHARS = 40_000


@dataclass(frozen=True)
class Verification:
    status: str  # live | closed | gone | unreachable
    note: str
    final_url: str | None = None
    http_status: int | None = None


def _visible_text(html: str) -> str:
    body = _TAG.sub(" ", html[:MAX_SCAN_CHARS])
    return _ANY_TAG.sub(" ", body)


def is_site_root(url: str) -> bool:
    """Whether a URL is just a domain with nothing meaningful after it.

    Landing here after following redirects is the single most reliable
    signal that a listing was removed: the server has no page for it any
    more, so it sends you to the homepage with a perfectly healthy 200.
    """
    try:
        parsed = urlparse(url)
    except ValueError:
        return False
    path = (parsed.path or "/").rstrip("/")
    # "/", "", "/jobs", "/careers" -- a bare section index, not a posting.
    return path in ("", "/jobs", "/careers", "/job", "/remote-jobs", "/search")


def classify(
    *,
    original_url: str,
    final_url: str | None,
    http_status: int | None,
    body: str | None,
    error: str | None = None,
) -> Verification:
    """The decision, split out from the network call so it is testable
    without touching anyone else's server."""
    if error:
        return Verification("unreachable", error, final_url, http_status)

    if http_status in (404, 410):
        return Verification("gone", f"HTTP {http_status} — the listing is not there", final_url, http_status)

    if http_status is not None and http_status >= 500:
        return Verification("unreachable", f"HTTP {http_status} from the host", final_url, http_status)

    # 403/429 mean the board is refusing *us*, which says nothing about
    # whether the role is open. Calling that "gone" would quietly delete
    # good leads, so it stays explicitly unknown.
    if http_status in (401, 403, 429):
        return Verification(
            "unreachable",
            f"HTTP {http_status} — the board blocked the check, not necessarily the role",
            final_url,
            http_status,
        )

    if final_url and not is_site_root(original_url) and is_site_root(final_url):
        return Verification(
            "gone",
            "redirected to the site homepage — the posting was removed",
            final_url,
            http_status,
        )

    if body:
        match = CLOSED_PATTERNS.search(_visible_text(body))
        if match:
            return Verification(
                "closed",
                f"the page says: “{match.group(0).strip()}”",
                final_url,
                http_status,
            )

    if http_status is not None and 200 <= http_status < 400:
        return Verification("live", "resolved and still open", final_url, http_status)

    return Verification(
        "unreachable",
        f"unexpected response{f' (HTTP {http_status})' if http_status else ''}",
        final_url,
        http_status,
    )


# Hacker News rate-limits its web pages aggressively, and it is where
# most sourced postings come from -- 43 of 84 in a real workspace, all
# comment permalinks on one monthly thread. Checking those by scraping
# the HTML got 19 of 28 throttled even paced at 2.5s apart.
#
# It also has an official item API that is built for exactly this, is not
# throttled at this volume, and answers a better question: the JSON
# carries `deleted` and `dead` flags that the rendered page simply hides.
# So a dead posting that looks fine in a browser is correctly caught
# here. Using the right endpoint beats being polite to the wrong one.
HN_ITEM = re.compile(r"^https?://news\.ycombinator\.com/item\?id=(\d+)", re.IGNORECASE)
HN_API = "https://hacker-news.firebaseio.com/v0/item/{id}.json"


def verify_hn_item(item_id: str, client: httpx.Client) -> Verification:
    """Check one Hacker News comment through the official item API."""
    try:
        response = client.get(HN_API.format(id=item_id))
    except httpx.HTTPError as exc:
        return Verification("unreachable", type(exc).__name__.replace("Error", " error").lower())

    if response.status_code != 200:
        return Verification(
            "unreachable", f"HTTP {response.status_code} from the Hacker News API", None, response.status_code
        )

    try:
        item = response.json()
    except ValueError:
        return Verification("unreachable", "the Hacker News API returned something unreadable")

    if item is None:
        return Verification("gone", "the Hacker News item no longer exists", None, 200)
    if item.get("deleted"):
        return Verification("gone", "the comment was deleted", None, 200)
    if item.get("dead"):
        return Verification("gone", "the comment was flagged dead", None, 200)

    # The comment is intact; its own text is the only place a "position
    # filled" edit would appear.
    match = CLOSED_PATTERNS.search(_visible_text(item.get("text") or ""))
    if match:
        return Verification("closed", f"the posting says: “{match.group(0).strip()}”", None, 200)

    return Verification("live", "comment still live on the thread", None, 200)


def retry_after_seconds(header: str | None, *, default: float = 5.0, cap: float = 20.0) -> float:
    """How long a 429 asked us to wait.

    Capped, because some servers answer with a `Retry-After` measured in
    hours and a link check is not worth blocking a batch for that long --
    at that point "couldn't check" is the honest answer.
    """
    if not header:
        return default
    try:
        return max(0.0, min(float(header.strip()), cap))
    except (TypeError, ValueError):
        # The HTTP-date form of the header. Not worth parsing for this.
        return default


def verify_url(url: str | None, *, client: httpx.Client | None = None) -> Verification:
    """Check one posting link. Never raises -- an unreachable host is an
    answer, not a failure, and one bad link must not stop a batch.

    A 429 is retried exactly once, after waiting the interval the server
    asked for. That is the entire contract of the status code: the host
    is not refusing, it is asking us to slow down, and a checker that
    ignores it and records "couldn't check" is being rude *and* getting a
    worse answer.
    """
    if not url or not url.strip():
        return Verification("unreachable", "no link on this posting")

    owned = client is None
    client = client or httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT},
    )
    try:
        hn = HN_ITEM.match(url.strip())
        if hn:
            return verify_hn_item(hn.group(1), client)

        for attempt in (1, 2):
            try:
                # GET rather than HEAD: several boards answer HEAD with
                # 405, and the body is needed for the closed check anyway.
                response = client.get(url)
            except httpx.TimeoutException:
                return classify(original_url=url, final_url=None, http_status=None, body=None,
                                error=f"no response within {TIMEOUT_SECONDS:.0f}s")
            except httpx.HTTPError as exc:
                return classify(original_url=url, final_url=None, http_status=None, body=None,
                                error=type(exc).__name__.replace("Error", " error").strip().lower())

            if response.status_code == 429 and attempt == 1:
                time.sleep(retry_after_seconds(response.headers.get("retry-after")))
                continue

            return classify(
                original_url=url,
                final_url=str(response.url),
                http_status=response.status_code,
                body=response.text,
            )
    finally:
        if owned:
            client.close()
