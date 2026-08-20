"""FastAPI auth dependency -- verifies a Supabase-issued JWT and returns
the authenticated user's id.

Every protected route derives `user_id` from this, never from a
client-supplied query param or body field -- every route accepted a raw
`user_id` directly before this (see api.py's git history), which meant
anyone who knew or guessed a user_id could read or act as that user. Two
routes are a deliberate exception and stay public: `POST /intake/{user_id}`
(the whole point is an unauthenticated lead-capture form) and `/health`.
"""

from fastapi import Header, HTTPException

from .db import get_client


def verify_token(token: str) -> str:
    """Verify a raw access token against Supabase and return the
    authenticated user's id. `get_user` calls Supabase's auth server to
    validate the token -- no local JWT-secret verification to keep in
    sync, at the cost of one network round trip per request (fine at
    this scale; revisit if it ever isn't)."""
    try:
        response = get_client().auth.get_user(token)
    except Exception as exc:
        raise HTTPException(401, f"Invalid or expired session: {exc}") from exc

    if not response or not response.user:
        raise HTTPException(401, "Invalid or expired session")

    return response.user.id


def get_current_user_id(authorization: str | None = Header(default=None)) -> str:
    """FastAPI dependency for ordinary routes: verify the
    `Authorization: Bearer <access_token>` header. Browser `EventSource`
    (used for the SSE run-trace stream) can't send custom headers at all,
    so that one route verifies a `?token=` query param via `verify_token`
    directly instead of this dependency."""
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(401, "Missing or malformed Authorization header")
    token = authorization.split(" ", 1)[1].strip()
    return verify_token(token)
