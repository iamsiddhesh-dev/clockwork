"""What a fit score is allowed to rest on, and checking that it does.

A fit score used to be the model's word. It was handed the profile as a
blob of text and asked for "evidence", and nothing checked the evidence
existed -- so a score could cite experience that appeared nowhere in the
freelancer's work, and nobody reading the card could tell.

Now the scorer gets a numbered list of things it may cite:

    [W1] GitHub · recoup — payment-recovery engine [Python] · 12 stars
    [W2] Portfolio · Checkout rebuild — cut failed payments by 40%
    [S1] Skill · FastAPI

and every piece of evidence it returns must name one of those ids. This
module decides, in code, which citations are real, turns them into
evidence a person can click through to, and caps a score that has no
real work behind it:

- **A strong match (60+) needs a project** -- a [W] entry, something the
  freelancer actually built or shipped, read from their GitHub or
  portfolio. Listed skills alone are a claim, not proof.
- **No valid citation at all caps the score at 40**, whatever the model
  thought of the posting.
"""

from __future__ import annotations

import re

#: The highest score a lead can get without any project behind it.
SKILLS_ONLY_CAP = 59
#: The highest score a lead can get when nothing it cited was real.
UNSUPPORTED_CAP = 40

#: How many work items and skills the scorer sees, and how much of each.
#: Enough to judge fit; small enough that a batch of scores fits the
#: extractor's per-minute token budget -- the first version sent every
#: project in full and eight of ten onboarding scores hit the rate limit.
MAX_WORK_ITEMS = 8
MAX_SKILLS = 12
MAX_SUMMARY_CHARS = 120
MAX_TAGS = 3

_REF = re.compile(r"\[\s*([WS])\s*(\d{1,3})\s*\]", re.IGNORECASE)


def evidence_index(profile: dict) -> list[dict]:
    """Everything a score may cite, each with a stable id.

    Work items come first -- repositories, portfolio projects, results --
    because they are the proof. Skills follow as supporting detail.
    """
    entries: list[dict] = []

    work = [p for p in (profile.get("portfolio") or []) if (p.get("summary") or p.get("title"))]
    for number, item in enumerate(work[:MAX_WORK_ITEMS], start=1):
        entries.append(
            {
                "ref": f"W{number}",
                "kind": "work",
                "source": item.get("source") or "Portfolio",
                "title": (item.get("title") or "").strip(),
                "summary": (item.get("summary") or "").strip(),
                "tags": [t for t in (item.get("tags") or []) if t],
                "url": item.get("url"),
            }
        )

    skills = [s for s in (profile.get("skills") or []) if s and str(s).strip()]
    for number, skill in enumerate(skills[:MAX_SKILLS], start=1):
        entries.append(
            {
                "ref": f"S{number}",
                "kind": "skill",
                "source": "Skill",
                "title": str(skill).strip(),
                "summary": "",
                "tags": [],
                "url": None,
            }
        )
    return entries


def render_index(entries: list[dict]) -> str:
    """The numbered list, as the scorer reads it."""
    if not entries:
        return "(nothing — no skills, repositories or portfolio projects on file)"
    lines = []
    for entry in entries:
        if entry["kind"] == "skill":
            lines.append(f"[{entry['ref']}] Skill · {entry['title']}")
            continue
        text = entry["title"]
        summary = entry["summary"]
        if len(summary) > MAX_SUMMARY_CHARS:
            summary = summary[:MAX_SUMMARY_CHARS].rsplit(" ", 1)[0] + "…"
        if summary and summary != entry["title"]:
            text = f"{text} — {summary}" if text else summary
        if entry["tags"]:
            text += f" [{', '.join(entry['tags'][:MAX_TAGS])}]"
        lines.append(f"[{entry['ref']}] {entry['source']} · {text}")
    return "\n".join(lines)


def verify_evidence(lines: list[str], entries: list[dict]) -> list[dict]:
    """Keep only evidence that cites an entry that actually exists.

    Each surviving line becomes a structured item carrying where it came
    from, so the card can show "GitHub · recoup" with a link instead of an
    unattributed sentence. A line citing only ids that don't exist, or no
    id at all, is dropped -- that is the invented experience this exists
    to catch.
    """
    by_ref = {entry["ref"].upper(): entry for entry in entries}
    verified: list[dict] = []
    seen: set[str] = set()

    for raw in lines or []:
        line = " ".join(str(raw or "").split())
        refs = [f"{kind.upper()}{int(number)}" for kind, number in _REF.findall(line)]
        cited = [by_ref[ref] for ref in refs if ref in by_ref]
        if not cited:
            continue

        text = _REF.sub("", line).strip(" -—–:·")
        if not text:
            continue
        # Prefer a project over a skill as the item's source when a line
        # cites both: the project is what someone can go and look at.
        anchor = next((c for c in cited if c["kind"] == "work"), cited[0])
        key = text.lower()
        if key in seen:
            continue
        seen.add(key)
        verified.append(
            {
                "text": text,
                "refs": sorted({c["ref"] for c in cited}),
                "kind": anchor["kind"],
                "source": anchor["source"],
                "title": anchor["title"],
                "url": anchor["url"],
            }
        )
    return verified


def capped_score(score: int, verified: list[dict]) -> tuple[int, str | None]:
    """Apply the proof rules. Returns the final score and, when it was
    capped, the concern that explains why -- shown on the card, so a low
    score is never a mystery."""
    score = max(0, min(100, int(score)))
    if not verified:
        if score > UNSUPPORTED_CAP:
            return UNSUPPORTED_CAP, "Nothing in your GitHub, portfolio or skills clearly matches this"
        return score, None
    if not any(item["kind"] == "work" for item in verified) and score > SKILLS_ONLY_CAP:
        return SKILLS_ONLY_CAP, "Matches your listed skills, but no project in your GitHub or portfolio shows it yet"
    return score, None


def evidence_text(item: str | dict) -> str:
    """One evidence item as a sentence, whichever shape it was stored in.

    Rows scored before evidence became structured still hold plain strings;
    the pitch writer and the card read both."""
    if isinstance(item, dict):
        where = f"{item.get('source')}: {item.get('title')}" if item.get("title") else item.get("source")
        return f"{item.get('text')} ({where})" if where else str(item.get("text"))
    return str(item)


# "(W1, W2, W5)", "[S3]", "W4" -- the index ids are for the scorer and for
# verify_evidence, not for the person reading the rationale, who has the
# linked evidence lines right underneath it.
_PROSE_REFS = re.compile(
    r"\s*[\(\[]\s*[WS]\d{1,3}(?:\s*[,/&]\s*(?:and\s+)?[WS]\d{1,3})*\s*[\)\]]"
    r"|\b[WS]\d{1,3}\b(?:\s*,\s*[WS]\d{1,3})*",
)


def strip_refs(text: str | None) -> str | None:
    """Remove evidence-index ids from free text such as a fit rationale."""
    if not text:
        return text
    cleaned = _PROSE_REFS.sub("", text)
    cleaned = re.sub(r"[ \t]{2,}", " ", cleaned)
    return re.sub(r"\s+([.,;:])", r"\1", cleaned).strip()
