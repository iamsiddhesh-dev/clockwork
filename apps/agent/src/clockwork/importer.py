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
#: Repositories listed from the API, before forks are dropped and the rest ranked.
MAX_REPOS = 30
#: Repositories kept as work items a score can cite.
MAX_REPO_ITEMS = 6
#: READMEs read for results -- each is one more unauthenticated API call,
#: and GitHub allows sixty an hour per address.
MAX_READMES = 3
MAX_README_CHARS = 1_200
#: Results extracted from the material by the model.
MAX_HIGHLIGHTS = 4


@dataclass
class Gathered:
    """Raw material, before a model sees any of it."""

    blocks: list[str] = field(default_factory=list)
    read: list[str] = field(default_factory=list)
    skipped: list[str] = field(default_factory=list)
    #: Work items taken straight from an API, not written by a model --
    #: the repositories themselves, each with a link anyone can follow.
    items: list[dict] = field(default_factory=list)
    github_url: str | None = None
    site_url: str | None = None

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


def rank_repos(repos: list[dict]) -> list[dict]:
    """The repositories worth citing, best first.

    Forks are dropped -- a fork is someone else's work. The rest are ranked
    by what makes a repository useful evidence: a description saying what
    it is, then stars as a rough signal someone else found it worth
    something, with the API's own most-recently-pushed order as the
    tiebreak.
    """
    own = [r for r in repos if isinstance(r, dict) and not r.get("fork") and r.get("name")]
    ranked = sorted(
        enumerate(own),
        key=lambda pair: (
            0 if (pair[1].get("description") or "").strip() else 1,
            -(pair[1].get("stargazers_count") or 0),
            pair[0],
        ),
    )
    return [repo for _, repo in ranked]


def repo_item(repo: dict) -> dict:
    """One repository as a work item, entirely from the API's own fields."""
    language = repo.get("language")
    topics = [t for t in (repo.get("topics") or []) if t][:4]
    summary = (repo.get("description") or "").strip() or (
        f"{language} project" if language else "Repository"
    )
    if repo.get("stargazers_count"):
        summary += f" · {repo['stargazers_count']} stars"
    return {
        "title": repo["name"],
        "summary": summary,
        "tags": ([language] if language else []) + topics,
        "source": "GitHub",
        "url": repo.get("html_url"),
    }


_MD_NOISE = [
    (re.compile(r"```.*?```", re.S), " "),          # code blocks
    (re.compile(r"!\[[^\]]*\]\([^)]*\)"), " "),     # images and badges
    (re.compile(r"\[([^\]]+)\]\([^)]*\)"), r"\1"),  # links keep their text
    (re.compile(r"<[^>]+>"), " "),                   # inline html
    (re.compile(r"^[#>*\-\s]+", re.M), ""),          # heading, quote and bullet marks
]


def readme_excerpt(markdown: str | None, limit: int = MAX_README_CHARS) -> str:
    """The prose of a README, without badges, images or code.

    A README's first screen is where people say what a project does and
    what it achieved; a wall of shields.io badges and install commands is
    tokens spent on nothing the scorer can use.
    """
    text = markdown or ""
    for pattern, replacement in _MD_NOISE:
        text = pattern.sub(replacement, text)
    return " ".join(text.split())[:limit]


def fetch_github(username: str, client: httpx.Client) -> tuple[str, list[dict]] | None:
    """Bio, the repositories worth citing, and the READMEs of the best few.

    Returns the text the extractor reads and the repositories as work
    items. The items never pass through a model: they are what GitHub says
    exists, so anything scored against them can be checked by following
    the link.
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

    ranked = rank_repos(repos if isinstance(repos, list) else [])[:MAX_REPO_ITEMS]

    lines = [f"GITHUB: {user.get('name') or username} (@{username})"]
    if user.get("bio"):
        lines.append(f"Bio: {user['bio']}")
    if user.get("company"):
        lines.append(f"Company: {user['company']}")

    for repo in ranked:
        item = repo_item(repo)
        lines.append(f"- {item['title']}: {item['summary']} [{', '.join(item['tags'])}]")

    # READMEs are where results live ("cut processing time by 60%"), and
    # results are what a pitch quotes. Only the best few, and a failure
    # to read one is simply skipped.
    for repo in ranked[:MAX_READMES]:
        try:
            readme = client.get(
                f"{GITHUB_API}/repos/{username}/{repo['name']}/readme",
                headers={"Accept": "application/vnd.github.raw"},
            )
        except httpx.HTTPError:
            continue
        if readme.status_code == 200:
            excerpt = readme_excerpt(readme.text)
            if excerpt:
                lines.append(f"README of {repo['name']}: {excerpt}")

    return "\n".join(lines), [repo_item(repo) for repo in ranked]


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
            fetched = fetch_github(username, client)
            if fetched:
                block, items = fetched
                out.blocks.append(block)
                out.items.extend(items)
                out.github_url = f"https://github.com/{username}"
                out.read.append(f"GitHub @{username}")
            else:
                out.skipped.append(f"GitHub @{username} could not be read")

        if website:
            block = fetch_site(website, client)
            if block:
                out.blocks.append(block)
                out.site_url = website if website.startswith(("http://", "https://")) else f"https://{website}"
                out.read.append("your portfolio")
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


_SOURCE_TAG = re.compile(r"^\s*\[\s*(github|portfolio|website|site|cv|resume)\s*\]\s*", re.IGNORECASE)


def tag_highlight(line: str, *, default_source: str) -> tuple[str, str]:
    """Split "[GitHub] recoup — recovered 18% of failed charges" into its
    source and its text. A line the model didn't tag takes the default --
    the only source read, when there was just one."""
    match = _SOURCE_TAG.match(line or "")
    if not match:
        return default_source, (line or "").strip()
    tag = match.group(1).lower()
    source = "GitHub" if tag == "github" else "Portfolio"
    return source, line[match.end():].strip()


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
        Role.READER,
        (
            "Below is a freelancer's own material — their GitHub (repositories and "
            "READMEs) and/or their portfolio site. Pull out how they would describe "
            "themselves professionally, and the concrete results their work shows.\n\n"
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
            "4. Plain language. No marketing voice, no 'passionate about'.\n"
            "5. Start every highlight with where it came from: '[GitHub]' or '[Portfolio]'. "
            "Prefer whichever source shows more concrete results."
        ),
    )
    extracted: ImportedProfile = result.structured_output

    # Results the model found first, tagged with their source and linked
    # back to it; then the repositories themselves, which need no model at
    # all. Together they are the numbered evidence a fit score must cite.
    default_source = "GitHub" if gathered.github_url and not gathered.site_url else "Portfolio"
    highlights = []
    for line in extracted.highlights[:MAX_HIGHLIGHTS]:
        source, text = tag_highlight(line, default_source=default_source)
        item = split_highlight(text)
        if not item["summary"]:
            continue
        item["source"] = source
        item["url"] = gathered.github_url if source == "GitHub" else gathered.site_url
        highlights.append(item)

    return {
        "found": True,
        "read": gathered.read,
        "skipped": gathered.skipped,
        "profile": {
            "title": extracted.title,
            "headline": extracted.headline,
            "skills": extracted.skills[:12],
            "highlights": merge_work(highlights, gathered.items),
        },
    }


def merge_work(highlights: list[dict], repos: list[dict]) -> list[dict]:
    """One entry per project, not two.

    The model's result for a repository ("sandbox-code-agent — 90% of runs
    succeed") and the repository itself describe the same work. Kept apart,
    every project appeared twice in the evidence a score cites, the result
    linked only to the GitHub profile, and the list cost twice the tokens.
    Merged, the entry keeps the result's wording -- it carries the number --
    and the repository's exact link, language and stars.
    """
    by_name = {repo["title"].strip().lower(): repo for repo in repos}
    merged_names: set[str] = set()
    out: list[dict] = []
    for item in highlights:
        key = (item.get("title") or "").strip().lower()
        repo = by_name.get(key) if item.get("source") == "GitHub" else None
        if repo:
            out.append({**repo, "summary": item["summary"] or repo["summary"]})
            merged_names.add(key)
        else:
            out.append(item)
    out.extend(repo for name, repo in by_name.items() if name not in merged_names)
    return out
