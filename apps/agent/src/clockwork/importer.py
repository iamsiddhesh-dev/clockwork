"""Reading a freelancer's profile out of their own material.

Onboarding used to ask people to type out "past results" and a writing
sample. That is the wrong question in two ways: nobody enjoys writing
their own case studies into a form, and clients do not ask for them
either -- they ask for a portfolio, a GitHub, a CV. So this reads those
instead, and shows back what it found for confirmation.

**What can actually be fetched, stated plainly:**

- **GitHub** -- yes, through the public API. Bio, name, and the most
  recently pushed repositories with their descriptions and languages.
- **A portfolio or personal site** -- yes, a plain HTTP fetch of the
  page text.
- **A CV** -- yes, as pasted text. PDF parsing would need a binary
  dependency and a file pipeline, and pasting works today.
- **LinkedIn** -- no. LinkedIn blocks automated fetching, and pretending
  otherwise would mean shipping a scraper that silently returns nothing.
  The URL is kept because a client may want it; it is not read.

Everything extracted is a *suggestion*. It goes back to the person to
edit or throw away before a single field is saved -- because this is the
material that grounds every pitch, and a hallucinated case study would
be worse than an empty profile.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field

import httpx

from .ledger import invoke_model
from .models import Role
from .schemas import ImportedProfile
from .sources.base import strip_html
from .sources.verify import TIMEOUT_SECONDS, USER_AGENT

logger = logging.getLogger("clockwork.importer")

GITHUB_API = "https://api.github.com"
# GitHub's own rule: alphanumerics and single hyphens, 1-39 characters,
# not starting or ending with a hyphen.
GITHUB_HANDLE = re.compile(r"^[A-Za-z0-9](?:[A-Za-z0-9]|-(?=[A-Za-z0-9])){0,38}$")

# Enough of a page or CV to characterise someone, small enough to stay
# inside the extractor's per-minute token budget.
MAX_SITE_CHARS = 6_000
MAX_RESUME_CHARS = 12_000
MAX_REPOS = 10


@dataclass
class Gathered:
    """Raw material, before a model sees any of it."""

    blocks: list[str] = field(default_factory=list)
    read: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)

    def text(self) -> str:
        return "\n\n".join(self.blocks)


def github_username(value: str | None) -> str | None:
    """Accepts a username, an @handle, or any github.com URL.

    Takes the FIRST path segment after the host, not the last: pasting a
    link to a specific repository is the normal way people share their
    GitHub, and reading `.../siddhesh/some-repo` as the user "some-repo"
    would send the importer off to fetch a profile that doesn't exist.
    """
    if not value:
        return None

    cleaned = value.strip().lstrip("@").strip()
    cleaned = re.sub(r"^https?://", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^www\.", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"^github\.com/", "", cleaned, flags=re.IGNORECASE)

    # Drop a query string or fragment before splitting on path.
    cleaned = re.split(r"[?#]", cleaned, maxsplit=1)[0]
    first = cleaned.strip("/").split("/")[0].strip()

    return first if GITHUB_HANDLE.match(first) else None


def fetch_github(username: str, client: httpx.Client) -> str | None:
    """Bio plus the most recently pushed repositories.

    Sorted by last push rather than stars: what someone has been working
    on this year says more about what they can be hired for than what
    got popular five years ago.
    """
    try:
        profile = client.get(f"{GITHUB_API}/users/{username}")
        if profile.status_code != 200:
            return None
        user = profile.json()

        repos_response = client.get(
            f"{GITHUB_API}/users/{username}/repos",
            params={"sort": "pushed", "per_page": MAX_REPOS, "type": "owner"},
        )
        repos = repos_response.json() if repos_response.status_code == 200 else []
    except (httpx.HTTPError, ValueError):
        return None

    lines = [f"GITHUB: {user.get('name') or username} (@{username})"]
    if user.get("bio"):
        lines.append(f"Bio: {user['bio']}")
    if user.get("company"):
        lines.append(f"Company: {user['company']}")

    for repo in repos if isinstance(repos, list) else []:
        if repo.get("fork"):
            # A fork is not evidence of what someone built.
            continue
        parts = [f"- {repo.get('name')}"]
        if repo.get("description"):
            parts.append(repo["description"])
        if repo.get("language"):
            parts.append(f"[{repo['language']}]")
        if repo.get("stargazers_count"):
            parts.append(f"({repo['stargazers_count']} stars)")
        lines.append(" ".join(parts))

    return "\n".join(lines)


def fetch_site(url: str, client: httpx.Client) -> str | None:
    if not url.startswith(("http://", "https://")):
        url = f"https://{url}"
    try:
        response = client.get(url)
        if response.status_code != 200:
            return None
    except httpx.HTTPError:
        return None

    text = " ".join(strip_html(response.text).split())
    return f"WEBSITE ({url}):\n{text[:MAX_SITE_CHARS]}" if text.strip() else None


def gather(
    *,
    github: str | None = None,
    website: str | None = None,
    linkedin: str | None = None,
    resume_text: str | None = None,
) -> Gathered:
    """Collect whatever can be read, and be explicit about what cannot."""
    out = Gathered()

    with httpx.Client(
        timeout=TIMEOUT_SECONDS,
        follow_redirects=True,
        headers={"User-Agent": USER_AGENT, "Accept": "application/vnd.github+json, text/html"},
    ) as client:
        username = github_username(github)
        if github and not username:
            out.skipped.append("that GitHub handle didn't look like one")
        elif username:
            block = fetch_github(username, client)
            if block:
                out.blocks.append(block)
                out.read.append(f"GitHub @{username}")
            else:
                out.skipped.append(f"GitHub @{username} could not be read")

        if website:
            block = fetch_site(website, client)
            if block:
                out.blocks.append(block)
                out.read.append("your website")
            else:
                out.skipped.append("that website didn't respond")

    if resume_text and resume_text.strip():
        out.blocks.append(f"CV / RESUME:\n{resume_text.strip()[:MAX_RESUME_CHARS]}")
        out.read.append("your CV")

    if linkedin and linkedin.strip():
        # Said out loud rather than failing silently. LinkedIn blocks
        # automated fetching; shipping a scraper that quietly returns
        # nothing would be worse than admitting the limit.
        out.skipped.append("LinkedIn blocks automated reading — the link is saved, not read")

    return out


# The separators a model reaches for when asked for "name — description".
_HIGHLIGHT_SPLIT = re.compile(r"\s+[—–-]\s+|:\s+")


def split_highlight(line: str) -> dict:
    """Turn one extracted line into a portfolio entry.

    The model is asked for "Short name - what it achieved" and usually
    obliges, but a schema is a request, not a guarantee. When there is no
    separator the whole sentence becomes the summary and the title is cut
    from its opening words -- which reads fine and, crucially, never
    drops the sentence containing the number.
    """
    text = " ".join((line or "").split())
    if not text:
        return {"title": "", "summary": "", "tags": []}

    parts = _HIGHLIGHT_SPLIT.split(text, maxsplit=1)
    if len(parts) == 2 and 3 <= len(parts[0]) <= 70 and parts[1].strip():
        return {"title": parts[0].strip(), "summary": parts[1].strip(), "tags": []}

    words = text.split()
    title = " ".join(words[:6])
    if len(words) > 6:
        title += "…"
    return {"title": title, "summary": text, "tags": []}


def import_profile(
    *,
    github: str | None = None,
    website: str | None = None,
    linkedin: str | None = None,
    resume_text: str | None = None,
) -> dict:
    """Read what is readable and extract a profile suggestion from it."""
    gathered = gather(
        github=github, website=website, linkedin=linkedin, resume_text=resume_text
    )

    if not gathered.blocks:
        return {
            "found": False,
            "read": gathered.read,
            "skipped": gathered.skipped,
            "profile": None,
        }

    result = invoke_model(
        Role.EXTRACTOR,
        (
            "Below is a freelancer's own material — some combination of their GitHub, "
            "their website and their CV. Pull out how they would describe themselves "
            "professionally.\n\n"
            f"{gathered.text()}"
        ),
        structured_output_model=ImportedProfile,
        system_prompt=(
            "You extract a freelancer's professional profile from material they wrote "
            "themselves. Rules, in order of importance:\n"
            "1. Never invent anything. If the material does not show a number, do not "
            "produce one. An empty highlights list is a correct answer.\n"
            "2. Keep real numbers exactly as written — a percentage, a user count, a "
            "time saved. That number is the whole value of a highlight.\n"
            "3. Skills means concrete technologies and disciplines. Not 'communication', "
            "not 'problem solving'.\n"
            "4. Plain language. No marketing voice, no 'passionate about'."
        ),
    )
    extracted: ImportedProfile = result.structured_output

    return {
        "found": True,
        "read": gathered.read,
        "skipped": gathered.skipped,
        "profile": {
            "title": extracted.title,
            "headline": extracted.headline,
            "skills": extracted.skills[:12],
            "highlights": [split_highlight(h) for h in extracted.highlights[:3]],
        },
    }
