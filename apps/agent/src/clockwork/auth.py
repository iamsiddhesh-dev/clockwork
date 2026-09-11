"""Who a request belongs to.

There is no sign-in. A workspace is created by filling in the onboarding
form, and from then on it is identified by its account id, sent as the
`X-Clockwork-Account` header (or `?account=` for the SSE stream, since
browser `EventSource` cannot set headers).

**This is identification, not authentication.** Anyone holding an account
id can read and write that workspace: there is no password, no expiry and
no revocation. The id is a v4 UUID, so it is not guessable, and that is
the entire protection. It is a deliberate trade -- the previous
magic-link flow meant a stranger had to find an email and click a token
before seeing anything, which is the wrong first thirty seconds for a
product whose whole argument is "it is already working" -- but it is a
real trade, and `006_accounts.sql` and the README both say so plainly
rather than letting the UUID imply more than it delivers.

Two routes stay open with no account at all: `POST /intake/{account_id}`
(the point of a lead-capture form is that strangers can post to it) and
`/health`.
"""

from uuid import UUID

from fastapi import Header, HTTPException, Query

from .db import get_client


def create_account() -> str:
    """Start a new workspace. Returns its id."""
    result = get_client().table("account").insert({}).execute()
    return result.data[0]["id"]


def _valid_uuid(value: str) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, AttributeError, TypeError):
        return False


def resolve_account(account_id: str) -> str:
    """Check an account id names a real workspace and return it.

    The shape check runs first and on its own: without it, a malformed id
    reaches PostgREST and comes back as a 500-shaped database error about
    invalid UUID syntax, which reads like the server is broken rather
    than like the caller sent nonsense.
    """
    if not account_id or not _valid_uuid(account_id):
        raise HTTPException(401, "Missing or malformed account id")

    res = (
        get_client()
        .table("account")
        .select("id")
        .eq("id", account_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        # A cookie pointing at a workspace that no longer exists. 401 so
        # the frontend clears it and sends the visitor back to onboarding
        # rather than showing empty screens forever.
        raise HTTPException(401, "Unknown workspace")

    get_client().table("account").update({"last_seen_at": "now()"}).eq(
        "id", account_id
    ).execute()
    return str(res.data["id"])


def get_current_user_id(
    x_clockwork_account: str | None = Header(default=None),
) -> str:
    """FastAPI dependency for ordinary routes.

    Named `get_current_user_id` and returning what every table still
    calls `user_id`, because renaming that column across fourteen tables
    days before a deadline buys nothing a comment cannot.
    """
    return resolve_account(x_clockwork_account or "")


def account_from_query(account: str = Query(default="")) -> str:
    """The SSE run-trace stream's version: `?account=` instead of a
    header, because browser EventSource cannot send custom headers."""
    return resolve_account(account)
