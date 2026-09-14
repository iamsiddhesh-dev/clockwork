"""Ids as the model hands them back.

Models copy ids out of prompts and tool results, and gpt-oss sometimes
writes the dashes in a UUID as typographic look-alikes (non-breaking
hyphen U+2011, en dash U+2013 and friends). The database compares ids
exactly, so a lookup on that string finds nothing, and a live payment check
reported an overdue invoice as "not found" because of it. Every tool that
takes an id from the model passes it through here first.
"""

import re

_DASHES = re.compile("[‐‑‒–—−]")


def clean_id(value: str | None) -> str:
    """Trim, lowercase, and turn look-alike dashes back into plain hyphens."""
    return _DASHES.sub("-", (value or "").strip()).lower()
