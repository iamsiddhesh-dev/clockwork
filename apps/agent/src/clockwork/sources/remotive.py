"""Remotive's official public remote-jobs API. No key required.

The only one of our three feeds with a real structured `job_type` field,
so the contract/freelance filter here is exact rather than keyword-
guessed. Verified live Aug 30, 2026: 19 jobs, job_type distribution
full_time 12 / contract 3 / part_time 2 / freelance 2 -- so this feed is
precise but thin, which is exactly why it isn't the only source.
"""

from datetime import datetime, timezone
from typing import Any

import httpx

from .base import RawOpportunity, strip_html

API = "https://remotive.com/api/remote-jobs"
TIMEOUT = 30.0

# Remotive's own vocabulary, not ours -- confirmed against live data.
FREELANCE_JOB_TYPES = {"contract", "freelance", "part_time"}


class RemotiveAdapter:
    kind = "remotive"
    name = "Remotive"

    def fetch(self, config: dict[str, Any]) -> list[RawOpportunity]:
        limit = int(config.get("limit", 40))
        params: dict[str, Any] = {}
        if category := config.get("category"):
            params["category"] = category

        with httpx.Client(timeout=TIMEOUT, follow_redirects=True) as client:
            res = client.get(API, params=params)
            res.raise_for_status()
            jobs = res.json().get("jobs", [])

        out: list[RawOpportunity] = []
        for job in jobs:
            if (job.get("job_type") or "").lower() not in FREELANCE_JOB_TYPES:
                continue

            posted_at = None
            if job.get("publication_date"):
                try:
                    posted_at = datetime.fromisoformat(job["publication_date"]).replace(
                        tzinfo=timezone.utc
                    )
                except ValueError:
                    pass

            company = job.get("company_name") or "Unknown company"
            out.append(
                RawOpportunity(
                    external_id=f"remotive:{job['id']}",
                    title=f"{job.get('title', 'Untitled')} — {company}",
                    body=strip_html(job.get("description") or ""),
                    url=job.get("url"),
                    author=company,
                    posted_at=posted_at,
                    raw=job,
                )
            )
            if len(out) >= limit:
                break

        return out
