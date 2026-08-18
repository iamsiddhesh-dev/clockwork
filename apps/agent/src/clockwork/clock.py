"""The virtual clock -- the only source of truth for 'now' anywhere in
Clockwork.

Every time read in the entire codebase must go through `now()`. If even one
module calls `datetime.now()` directly, the time-travel demo breaks silently
and it will not be obvious under deadline pressure. CI/lint should grep for
`datetime.now(` outside this file and fail the build.

Offset is stored per-user in `app_setting.clock_offset_seconds` so the demo
control ("Advance 5 days") only affects the demo workspace, never wall-clock
reality for anyone else.
"""

from datetime import datetime, timedelta, timezone

from .db import get_client


def _get_offset_seconds(user_id: str) -> int:
    res = (
        get_client()
        .table("app_setting")
        .select("clock_offset_seconds")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        return 0
    return int(res.data["clock_offset_seconds"])


def now(user_id: str) -> datetime:
    """The current time for this user, including any demo-clock offset."""
    offset = _get_offset_seconds(user_id)
    return datetime.now(timezone.utc) + timedelta(seconds=offset)


def advance(user_id: str, days: float) -> datetime:
    """Demo control: push this user's virtual clock forward by `days` and
    return the new current time. Upserts app_setting if it doesn't exist
    yet (defaults: no cap override)."""
    current_offset = _get_offset_seconds(user_id)
    new_offset = current_offset + int(days * 86400)

    get_client().table("app_setting").upsert(
        {"user_id": user_id, "clock_offset_seconds": new_offset}
    ).execute()

    return now(user_id)


def reset(user_id: str) -> datetime:
    """Demo control: zero the offset back to real time."""
    get_client().table("app_setting").upsert(
        {"user_id": user_id, "clock_offset_seconds": 0}
    ).execute()
    return now(user_id)
