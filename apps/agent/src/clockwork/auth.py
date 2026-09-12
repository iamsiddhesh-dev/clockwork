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

**Signing in by email is weaker still, and deliberately so.** A cookie
is easy to lose -- a different browser, a cleared cache, a phone -- and
losing it used to mean the workspace was unreachable forever even though
every row was still sitting in the database. `sign_in` trades some of the
UUID's unguessability back for a door the owner can actually find again:
give the email you onboarded with and you get the workspace. There is no
password and no verification, so anyone who knows that address can do the
same. Nothing here should be read as a security boundary; the sign-in
screen says as much on the screen itself.

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


def _normalise_email(email: str | None) -> str:
    """Lowercased and trimmed. The unique index is on `lower(email)`, so
    comparing anything else here would let two workspaces disagree with
    the database about whether they collide."""
    return (email or "").strip().lower()


def get_account(account_id: str) -> dict:
    """The workspace row itself -- what the Settings screen shows."""
    res = (
        get_client()
        .table("account")
        .select("id, email, created_at, last_seen_at")
        .eq("id", account_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(404, "No such workspace")
    return res.data


def sign_in(email: str) -> str:
    """Find the workspace behind an email address.

    Deliberately returns the same 404 for "no such workspace" as for a
    malformed address: there is nothing secret behind this door, so
    there is nothing gained by distinguishing them, and a message that
    confirms which addresses exist is a habit worth not starting.
    """
    value = _normalise_email(email)
    if not value or "@" not in value:
        raise HTTPException(404, "No workspace for that email")

    # `ilike` with no wildcards is an exact, case-insensitive match, and
    # it is what the unique index on lower(email) is built to serve.
    res = (
        get_client()
        .table("account")
        .select("id")
        .ilike("email", value)
        .limit(1)
        .execute()
    )
    rows = res.data or []
    if not rows:
        raise HTTPException(404, "No workspace for that email")
    return str(rows[0]["id"])


def claim_email(account_id: str, email: str | None) -> None:
    """Attach the onboarding email to the workspace, so it can be signed
    back into later.

    Called on every profile save rather than only the first, because
    someone correcting a typo in their email would otherwise be left
    signing in with the wrong one forever.

    A 409 when another workspace already holds the address is the whole
    point: silently moving it would hand one person's leads, quotes and
    invoices to whoever typed their address second.
    """
    value = _normalise_email(email)
    if not value:
        return

    existing = (
        get_client()
        .table("account")
        .select("id")
        .ilike("email", value)
        .limit(1)
        .execute()
    )
    for row in existing.data or []:
        if str(row["id"]) != str(account_id):
            raise HTTPException(
                409,
                "That email already has a workspace. Sign in with it instead "
                "of starting a second one.",
            )

    get_client().table("account").update({"email": value}).eq("id", account_id).execute()


def delete_account(account_id: str) -> None:
    """Really delete it.

    Every user_id foreign key is ON DELETE CASCADE (see 006_accounts.sql),
    so this one statement takes the profile, threads, messages, deals,
    runs, events, approvals, tasks, ledger, settings, sources,
    opportunities, quotes and invoices with it. Nothing is soft-deleted --
    "delete my account" meaning "we stopped showing it to you" is a lie,
    and a demo that lies about deletion is worse than one that has no
    delete button at all.
    """
    get_client().table("account").delete().eq("id", account_id).execute()


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
