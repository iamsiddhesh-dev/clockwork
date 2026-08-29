"""The SourceAdapter contract.

One adapter per public feed. Each one's whole job is to turn somebody
else's JSON into `RawOpportunity` -- nothing in the rest of Clockwork
should ever know what shape Remotive or HN happen to return this year.
Adding a feed is a new file plus one registry line.

Adapters filter only for *obvious* irrelevance (a full-time-only salaried
role is not freelance work). They deliberately do NOT try to judge
whether a lead suits this particular freelancer -- that's `score_fit`'s
job, done against the real profile with a model, and it needs candidates
to rank rather than a pre-narrowed list.
"""

import re
from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Protocol

# Signals that a posting might be open to contract/freelance work.
# Used where a feed gives no structured job-type field (HN comments,
# RemoteOK) -- verified live that RemoteOK's `tags` carry no contract
# marker at all, so keyword matching is the only signal available there.
FREELANCE_PATTERN = re.compile(
    r"\b(contract|contractor|freelance|freelancer|part[-\s]?time|consultant|consulting)\b",
    re.IGNORECASE,
)


def looks_freelance(*texts: str | None) -> bool:
    return any(FREELANCE_PATTERN.search(t) for t in texts if t)


@dataclass
class RawOpportunity:
    """One sourced lead, normalized. `raw` keeps the feed's own payload
    verbatim so re-scoring never needs a refetch and a demo never depends
    on a third party being up."""

    external_id: str
    title: str
    body: str
    url: str | None = None
    author: str | None = None
    posted_at: datetime | None = None
    raw: dict[str, Any] = field(default_factory=dict)


class SourceAdapter(Protocol):
    kind: str
    name: str

    def fetch(self, config: dict[str, Any]) -> list[RawOpportunity]:
        """Pull the current batch. Raises on transport failure -- the
        caller records it on `source.last_error` and moves to the next
        adapter rather than failing the whole sync."""
        ...


def strip_html(text: str) -> str:
    """Feeds return HTML of wildly varying quality. The model reads this,
    so tags and entities are noise that costs tokens and confuses it."""
    text = re.sub(r"<br\s*/?>|</p>", "\n", text, flags=re.IGNORECASE)
    text = re.sub(r"<[^>]+>", " ", text)
    replacements = {
        "&#x2F;": "/", "&#x27;": "'", "&quot;": '"', "&amp;": "&",
        "&lt;": "<", "&gt;": ">", "&nbsp;": " ", "&#62;": ">", "&#38;": "&",
    }
    for entity, char in replacements.items():
        text = text.replace(entity, char)
    return re.sub(r"[ \t]+", " ", text).strip()
