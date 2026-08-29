"""RemoteOK's public JSON feed.

**Attribution is a licence condition of this feed, not a nicety** -- the
backlink must appear wherever these results are displayed (see the
Opportunities screen, which links every RemoteOK opportunity back to its
posting).

Unlike Remotive there is no structured job-type field: verified live on
Aug 30, 2026 that across 100 jobs, *zero* carried a contract/freelance/
part-time tag. So relevance here has to come from keyword-matching the
role and description, which is noisier by nature -- score_fit does the
real filtering downstream.

The first element of the response is RemoteOK's legal/attribution notice
rather than a job, so it is skipped by checking for an `id`.
"""

from datetime import datetime, timezone
from typing import Any

import httpx

from .base import RawOpportunity, looks_freelance, strip_html

API = "https://remoteok.com/api"
TIMEOUT = 30.0
# RemoteOK blocks requests without a UA.
HEADERS = {"User-Agent": "Clockwork/1.0 (freelance opportunity sourcing)"}


class RemoteOkAdapter:
    kind = "remoteok"
    name = "RemoteOK"

    def fetch(self, config: dict[str, Any]) -> list[RawOpportunity]:
        limit = int(config.get("limit", 40))

        with httpx.Client(timeout=TIMEOUT, follow_redirects=True, headers=HEADERS) as client:
            res = client.get(API)
            res.raise_for_status()
            payload = res.json()

        out: list[RawOpportunity] = []
        for job in payload:
            if not isinstance(job, dict) or not job.get("id"):
                continue  # attribution/legal notice entry

            position = job.get("position") or job.get("title") or ""
            description = strip_html(job.get("description") or "")
            tags = " ".join(job.get("tags") or [])

            if not looks_freelance(position, description, tags):
                continue

            posted_at = None
            if job.get("date"):
                try:
                    posted_at = datetime.fromisoformat(
                        str(job["date"]).replace("Z", "+00:00")
                    ).astimezone(timezone.utc)
                except ValueError:
                    pass

            company = job.get("company") or "Unknown company"
            out.append(
                RawOpportunity(
                    external_id=f"remoteok:{job['id']}",
                    title=f"{position or 'Untitled'} — {company}",
                    body=description,
                    url=job.get("url") or job.get("apply_url"),
                    author=company,
                    posted_at=posted_at,
                    raw=job,
                )
            )
            if len(out) >= limit:
                break

        return out
