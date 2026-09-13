"""FastAPI app -- API + agent host.

Routes:
  POST  /runs                      -> run_agent(), returns run_id
  GET   /runs                      -> list recent runs (Run Trace panel)
  POST  /accounts                  -> create a workspace (onboarding step 1)
  POST  /accounts/signin           -> find the workspace behind an email
  GET   /accounts/me               -> which workspace this is, and its email
  DELETE /accounts/me              -> delete the workspace and everything in it
  GET   /runs/{id}/events?account= -> SSE stream of agent_event rows
  GET   /threads                   -> list threads (Threads view)
  GET   /threads/{id}              -> thread + messages + its deal
  GET   /search?q=                 -> one ranked list across every entity
  GET   /summary                   -> chrome poll: badge, spend, next wake
  GET   /overview                  -> everything the dashboard renders
  GET   /deals                     -> list deals (pipeline table)
  POST  /deals/{id}/quote          -> price the deal, queue a send_quote
  GET   /quotes                    -> list quotes (Money screen)
  POST  /quotes/{id}/accepted      -> human records the client said yes
  POST  /quotes/{id}/declined      -> human records the client said no
  POST  /quotes/{id}/invoice       -> raise an invoice for an accepted quote
  GET   /invoices                  -> list invoices
  POST  /invoices/{id}/paid        -> human records payment received
  POST  /invoices/{id}/chase       -> draft the next payment reminder
  GET   /approvals?status=pending  -> list approvals (the signature screen)
  PATCH /approvals/{id}            -> edit a pending approval's payload
                                       (the "e" in a/r/e)
  POST  /approvals/{id}/approve    -> approve + execute
  POST  /approvals/{id}/reject     -> reject, no side effect
  GET   /intake/{id}               -> public: who this intake link reaches
  POST  /intake/{id}               -> public, no auth -- creates thread +
                                       message, fires a run
  GET   /clock                     -> current virtual time
  POST  /clock/advance             -> demo control: fast-forward + drain
                                       any tasks that become due
  POST  /clock/reset               -> demo control: back to real time
  POST  /tasks/tick                -> scheduler: drain due tasks (Bearer
                                       CRON_SECRET; for serverless hosts)
  GET   /health

Gmail OAuth (inbound polling / send) is not wired here yet -- see
executor.py's TODO. It needs a Google Cloud console app set up by hand
before any code can use it.

Lists are paginated: `?limit=&offset=`, with the unfiltered total in
an `X-Total-Count` response header rather than wrapped around the body,
so the shape a caller parses does not change with the feature.

Identity: every route above except /accounts, /accounts/signin, /intake,
/tasks/tick (which takes the scheduler secret instead) and /health
requires an `X-Clockwork-Account: <uuid>` header naming an existing
workspace (see auth.py, which is explicit that this identifies rather
than authenticates). Every route that touches one specific resource (a
thread, an approval, a run) also checks that resource's own user_id
matches the caller, so knowing one id never leaks another workspace. The
SSE route is the one exception to the header rule: browser EventSource
can't send custom headers, so it takes `?account=` as a query param
instead, resolved the same way.

Background: when this runs as a long-lived server (uvicorn, locally), an
APScheduler job polls `scheduler.tick_all_due()` every 30s so tasks fire
in real time too, not only right after `/clock/advance` (see `lifespan`
below) -- the "Worker loop (APScheduler)" from PLAN.md's architecture
diagram. On Vercel there is no long-lived process for that timer to live
in, so the same drain is exposed as `POST /tasks/tick` and called from
outside on a schedule instead.
"""

import asyncio
import json
import logging
import os
from contextlib import asynccontextmanager
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, Header, HTTPException, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import clock
from .agent import Trigger, run_agent
from .auth import (
    account_from_query,
    claim_email,
    create_account,
    cron_authorized,
    delete_account,
    get_account,
    get_current_user_id,
    resolve_account,
    sign_in,
)
from .config import parse_origins, settings
from .context import run_context
from .runs import manual_run
from .db import get_client
from .executor import execute_approval
from .importer import import_profile
from .overview import overview as build_overview, summary as build_summary
from .scheduler import tick, tick_all_due
from .search import search as run_search
from .sources import ensure_sources, sync_sources
from .sources.checking import verify_opportunities
from .tools.money import chase_payment_for, draft_invoice_for, draft_quote_for
from .tools.pitching import draft_pitch_for
from .tools.sourcing import ProfileMissingError, score_unscored

logger = logging.getLogger("clockwork.scheduler")


def _poll_tick() -> None:
    try:
        fired = tick_all_due()
        if fired:
            logger.info("background tick fired %d task(s)", len(fired))
    except Exception:
        # A bad poll must never kill the background job itself -- log and
        # let the next tick (30s away) try again.
        logger.exception("background tick_all_due() failed")


#: Set by Vercel on every build and invocation.
ON_SERVERLESS = bool(os.environ.get("VERCEL"))


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Not on serverless. An instance there is frozen between requests, so a
    # 30-second timer would fire only in whatever gaps an instance happens
    # to stay warm, from however many instances exist at once -- neither
    # reliable nor predictable. POST /tasks/tick replaces it there.
    if ON_SERVERLESS:
        yield
        return

    background_scheduler = BackgroundScheduler()
    background_scheduler.add_job(_poll_tick, "interval", seconds=30, id="tick_all_due")
    background_scheduler.start()
    try:
        yield
    finally:
        background_scheduler.shutdown(wait=False)


app = FastAPI(title="Clockwork Agent API", lifespan=lifespan)

# Which browser origins may call this API. Read from ALLOWED_ORIGINS so the
# same code serves the local dev server and the deployed frontend; see
# config.py for the defaults.
app.add_middleware(
    CORSMiddleware,
    allow_origins=parse_origins(settings.allowed_origins),
    allow_origin_regex=settings.allowed_origin_regex or None,
    allow_methods=["*"],
    allow_headers=["*"],
    # Without this the browser hands the frontend a response whose
    # X-Total-Count it is not allowed to read -- pagination would then
    # silently believe every list is one page long.
    expose_headers=["X-Total-Count"],
)


# ── pagination ──────────────────────────────────────────────────────────
#
# One page size cap for every list. The total goes in a header rather
# than changing `list[dict]` into `{"items": [...], "total": n}`: the body
# stays exactly what it always was, so nothing that already reads these
# routes breaks, and a caller that does not care about paging can keep
# ignoring it.

PAGE_MAX = 200


def page_window(limit: int, offset: int) -> tuple[int, int]:
    """Clamp what the query string asked for.

    A negative offset makes PostgREST's range nonsensical rather than
    empty, and an unbounded limit turns one careless URL into a full table
    scan sent over the wire.
    """
    return max(1, min(int(limit), PAGE_MAX)), max(0, int(offset))


def paginate(query, response: Response, limit: int, offset: int) -> list[dict]:
    """Run a counted query for one page and publish the full total.

    The query must have been built with `select(..., count="exact")` --
    without it PostgREST returns no count and the total would quietly
    become "however many rows this page happens to hold", which is the
    exact bug that makes a pager stop one page early.
    """
    limit, offset = page_window(limit, offset)
    res = query.range(offset, offset + limit - 1).execute()
    rows = res.data or []
    total = res.count if getattr(res, "count", None) is not None else offset + len(rows)
    response.headers["X-Total-Count"] = str(total)
    return rows


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


# ── workspace ───────────────────────────────────────────────────────────


@app.post("/accounts")
def post_account() -> dict:
    """Start a workspace. Open by design -- this is the front door, and
    the caller has nothing to identify themselves with yet. It creates an
    empty row and nothing else; a workspace with no profile is inert, so
    the worst an abusive caller achieves is empty rows."""
    return {"account_id": create_account()}


class SignInBody(BaseModel):
    email: str


@app.post("/accounts/signin")
def post_signin(body: SignInBody) -> dict:
    """The way back in after a cookie is gone.

    Open, like /accounts, and for the same reason: the caller has nothing
    to identify themselves with -- that is what they are here to fix. See
    auth.py on exactly how little this proves about who is asking.
    """
    return {"account_id": sign_in(body.email)}


@app.get("/accounts/me")
def get_me(user_id: str = Depends(get_current_user_id)) -> dict:
    """Which workspace this is. The Settings screen shows the email back
    so someone can see what they would sign in with, rather than having
    to remember which address they typed."""
    return get_account(user_id)


@app.delete("/accounts/me")
def delete_me(user_id: str = Depends(get_current_user_id)) -> dict:
    """Delete the workspace and everything in it. Cascades -- see
    auth.delete_account. There is no undo and none is implied."""
    delete_account(user_id)
    return {"deleted": True}


# ── runs ────────────────────────────────────────────────────────────────


class RunRequest(BaseModel):
    trigger_type: str = "manual"
    trigger_ref: str | None = None
    prompt: str


@app.post("/runs")
def create_run(req: RunRequest, user_id: str = Depends(get_current_user_id)) -> dict:
    run = run_agent(
        Trigger(
            user_id=user_id,
            trigger_type=req.trigger_type,  # type: ignore[arg-type]
            trigger_ref=req.trigger_ref,
            prompt=req.prompt,
        )
    )
    return {
        "id": run.id,
        "status": run.status,
        "outcome": run.outcome,
        "total_cost_usd": run.total_cost_usd,
    }


@app.get("/runs")
def list_runs(
    response: Response,
    limit: int = 30,
    offset: int = 0,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    query = (
        get_client()
        .table("agent_run")
        .select("*", count="exact")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
    )
    return paginate(query, response, limit, offset)


@app.get("/runs/{run_id}")
def get_run(run_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    res = (
        get_client()
        .table("agent_run")
        .select("*")
        .eq("id", run_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(404, "run not found")
    return res.data


@app.get("/runs/{run_id}/events")
async def stream_run_events(run_id: str, user_id: str = Depends(account_from_query)):
    """SSE stream of agent_event rows for a run, polling Postgres (no
    Supabase Realtime dependency for Phase 1 -- swap for a Realtime
    subscription later if polling latency becomes visible). Takes
    `?account=` rather than a header -- see module docstring; browser
    EventSource cannot set custom headers."""
    client = get_client()

    run_res = client.table("agent_run").select("user_id").eq("id", run_id).maybe_single().execute()
    if not run_res or not run_res.data or run_res.data["user_id"] != user_id:
        raise HTTPException(404, "run not found")

    async def event_stream():
        seen_ids: set[str] = set()
        # Stop once the run itself reaches a terminal status and no new
        # events have shown up for a couple of polls.
        idle_polls = 0
        while idle_polls < 5:
            res = (
                client.table("agent_event")
                .select("*")
                .eq("run_id", run_id)
                .order("seq")
                .execute()
            )
            rows = res.data or []
            new_rows = [r for r in rows if r["id"] not in seen_ids]
            if new_rows:
                idle_polls = 0
                for row in new_rows:
                    seen_ids.add(row["id"])
                    yield f"data: {json.dumps(row, default=str)}\n\n"
            else:
                idle_polls += 1

            run_status_res = (
                client.table("agent_run")
                .select("status")
                .eq("id", run_id)
                .maybe_single()
                .execute()
            )
            if run_status_res and run_status_res.data and run_status_res.data["status"] != "running":
                if idle_polls >= 1:
                    break

            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── threads ─────────────────────────────────────────────────────────────


@app.get("/threads")
def list_threads(
    response: Response,
    limit: int = 25,
    offset: int = 0,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    query = (
        get_client()
        .table("thread")
        .select("*", count="exact")
        .eq("user_id", user_id)
        .order("last_message_at", desc=True, nullsfirst=False)
    )
    return paginate(query, response, limit, offset)


@app.get("/threads/{thread_id}")
def get_thread_detail(thread_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    client = get_client()

    thread_res = (
        client.table("thread")
        .select("*")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not thread_res or not thread_res.data:
        raise HTTPException(404, "thread not found")

    messages_res = (
        client.table("message").select("*").eq("thread_id", thread_id).order("sent_at").execute()
    )
    deal_res = (
        client.table("deal").select("*").eq("thread_id", thread_id).maybe_single().execute()
    )

    return {
        "thread": thread_res.data,
        "messages": messages_res.data or [],
        "deal": deal_res.data if deal_res else None,
    }


# ── profile ─────────────────────────────────────────────────────────────
#
# Load-bearing, not settings-page filler: `recall` grounds every drafted
# reply in this, and score_fit ranks sourced opportunities against it. An
# empty profile means the agent has no voice to imitate and nothing to
# measure a lead against.


class ProfileBody(BaseModel):
    name: str
    title: str | None = None
    email: str | None = None
    skills: list[str] = []
    years_experience: int | None = None
    min_project_budget: float | None = None
    availability_hours: int | None = None
    rates: dict[str, Any] = {}
    positioning: str | None = None
    voice_samples: list[str] = []
    portfolio: list[dict[str, Any]] = []
    payment_terms: str | None = None
    timezone: str | None = None
    links: dict[str, Any] = {}


class ImportRequest(BaseModel):
    github: str | None = None
    website: str | None = None
    linkedin: str | None = None
    resume_text: str | None = None


@app.post("/profile/import")
def post_profile_import(
    req: ImportRequest, user_id: str = Depends(get_current_user_id)
) -> dict:
    """Read a GitHub account, a portfolio site and a pasted CV into a
    profile suggestion. Saves nothing -- the caller shows the result back
    for confirmation first. See importer.py for what is and is not
    actually fetchable."""
    with manual_run(user_id, label="Read GitHub and portfolio") as run:
        result = import_profile(
            github=req.github,
            website=req.website,
            linkedin=req.linkedin,
            resume_text=req.resume_text,
        )
        found = len((result.get("profile") or {}).get("highlights") or [])
        read = ", ".join(result.get("read") or []) or "nothing readable"
        run.outcome = f"Read {read} · {found} past result{'' if found == 1 else 's'} found"
        run.step(run.outcome, tool="import_profile", payload={"skipped": result.get("skipped")})
        return result


@app.get("/profile")
def get_profile(user_id: str = Depends(get_current_user_id)) -> dict | None:
    res = (
        get_client().table("profile").select("*").eq("user_id", user_id).maybe_single().execute()
    )
    return res.data if res else None


@app.put("/profile")
def put_profile(body: ProfileBody, user_id: str = Depends(get_current_user_id)) -> dict:
    """Create or update the caller's profile. Upsert rather than separate
    POST/PUT -- there is exactly one profile per user, and the caller
    shouldn't have to know whether it exists yet."""
    client = get_client()
    payload = body.model_dump()

    existing = (
        client.table("profile").select("id").eq("user_id", user_id).maybe_single().execute()
    )
    if existing and existing.data:
        res = (
            client.table("profile")
            .update({**payload, "updated_at": "now()"})
            .eq("user_id", user_id)
            .execute()
        )
    else:
        res = client.table("profile").insert({**payload, "user_id": user_id}).execute()

    # The address onboarding just collected becomes the way back into
    # this workspace if the cookie is ever lost. Done on every save, not
    # only the first: correcting a typo here has to correct what you sign
    # in with, or the correction is worse than the typo. Raises 409 if
    # another workspace already holds it -- see auth.claim_email.
    claim_email(user_id, payload.get("email"))

    return res.data[0]


# ── opportunities (outbound sourcing) ───────────────────────────────────

#: Marks a stats filter as "this column is set" rather than "this column
#: equals something". A module-level sentinel rather than None, because
#: None is a perfectly ordinary value to filter a column against.
NOT_NULL = object()


@app.get("/opportunities")
def list_opportunities(
    response: Response,
    status: str | None = None,
    limit: int = 20,
    offset: int = 0,
    include_dismissed: bool = False,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """Best fit first. Unscored rows sort last rather than being hidden --
    "not scored yet" is a real state the screen needs to show.

    Dismissed rows are excluded here rather than filtered out by the
    caller. Filtering after paging is how a page of twenty arrives
    holding fourteen, and how a total of eighty-four describes a list
    nobody can page to the end of.

    The sort has `id` on the end for a reason: two postings with the same
    fit score and no posted_at are otherwise in whatever order Postgres
    felt like, which is free to differ between the query for page one and
    the query for page two -- so a row can appear twice and another never
    appear at all.
    """
    # The deal's thread rides along, so a posting that became a real
    # conversation can link straight to it instead of showing a dead
    # "Draft a pitch" button.
    query = (
        get_client()
        .table("opportunity")
        .select("*, deal:deal_id(thread_id, stage)", count="exact")
        .eq("user_id", user_id)
    )
    if status:
        query = query.eq("status", status)
    elif not include_dismissed:
        query = query.neq("status", "dismissed")
    query = (
        query.order("fit_score", desc=True, nullsfirst=False)
        .order("posted_at", desc=True, nullsfirst=False)
        .order("id")
    )
    return paginate(query, response, limit, offset)


@app.get("/opportunities/stats")
def opportunity_stats(user_id: str = Depends(get_current_user_id)) -> dict:
    """Totals for the whole workspace, not for whichever page is on
    screen.

    The header on the Opportunities screen reads "84 sourced, 61 scored".
    Once the list is paged, counting the rows in hand would turn that
    into "20 sourced, 14 scored" -- a number that shrinks as you paginate
    is worse than no number. These are counted in the database, over
    everything, with `head=True` so no rows come back at all.
    """
    client = get_client()

    def count(**filters) -> int:
        query = (
            client.table("opportunity")
            .select("id", count="exact", head=True)
            .eq("user_id", user_id)
            .neq("status", "dismissed")
        )
        for column, value in filters.items():
            query = query.not_.is_(column, "null") if value is NOT_NULL else query.eq(column, value)
        return query.execute().count or 0

    by_source: dict[str, int] = {}
    for source in ensure_sources(user_id):
        by_source[source["id"]] = count(source_id=source["id"])

    return {
        "total": count(),
        "scored": count(fit_score=NOT_NULL),
        "by_source": by_source,
    }


@app.get("/sources")
def list_sources(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    return ensure_sources(user_id)


@app.post("/opportunities/sync")
def sync_opportunities(user_id: str = Depends(get_current_user_id)) -> dict:
    """Pull every enabled feed and cache the results. Per-source result is
    returned so a feed that errored is visible rather than silently
    looking like 'no new leads'."""
    with manual_run(user_id, label="Find leads") as run:
        result = sync_sources(user_id)
        per_source = " · ".join(
            f"{s['kind']} {s.get('fetched', 0)}" if s.get("ok") else f"{s['kind']} failed"
            for s in result.get("sources", [])
        )
        run.outcome = f"Found {result.get('total', 0)} postings ({per_source})"
        run.step(run.outcome, tool="sync_sources")
        return result


class ScoreRequest(BaseModel):
    limit: int = 10


@app.post("/opportunities/score")
def score_opportunities(
    req: ScoreRequest, user_id: str = Depends(get_current_user_id)
) -> dict:
    """Score a batch of unscored opportunities against the caller's
    profile. Batched on purpose -- see score_unscored's docstring."""
    with manual_run(user_id, label="Score opportunities") as run:
        try:
            result = score_unscored(limit=req.limit)
        except ProfileMissingError as exc:
            raise HTTPException(400, str(exc)) from exc
        run.outcome = _scored_line(result)
        run.step(run.outcome, tool="score_fit")
        return result


class VerifyRequest(BaseModel):
    limit: int = 40
    force: bool = False


@app.post("/opportunities/verify")
def verify_links(req: VerifyRequest, user_id: str = Depends(get_current_user_id)) -> dict:
    """Check that each sourced posting still resolves and is still open.

    Results are stored, not recomputed per page load -- a check is a
    round trip to someone else's server. See sources/verify.py for why
    this is plain HTTP and not a headless browser.
    """
    with manual_run(user_id, label="Check links") as run:
        result = verify_opportunities(user_id, limit=req.limit, force=req.force)
        dead = result.get("gone", 0) + result.get("closed", 0)
        run.outcome = (
            f"Checked {result.get('checked', 0)} links — {result.get('live', 0)} live"
            + (f", {dead} no longer open and set aside" if dead else "")
        )
        run.step(run.outcome, tool="verify_links")
        return result


@app.post("/opportunities/{opportunity_id}/pitch")
def pitch_opportunity(
    opportunity_id: str, user_id: str = Depends(get_current_user_id)
) -> dict:
    """Draft outbound outreach for one opportunity. Queues an approval --
    nothing is sent here."""
    with manual_run(user_id, label="Draft a pitch", trigger_ref=opportunity_id) as run:
        try:
            result = draft_pitch_for(opportunity_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        run.outcome = f"Drafted a pitch for {_opportunity_title(opportunity_id)} — waiting for your approval, nothing sent"
        run.step(run.outcome, tool="draft_pitch", payload={"approval_id": result.get("approval_id")})
        return result


# ── run narration ───────────────────────────────────────────────────────
#
# One line per step, for the Run Trace and the Runs list. Written as what
# happened, not as function names -- the trace is read by the person whose
# work it is, and by judges who have never seen the code.

ACTION_VERBS = {
    "send_email": "Send a reply",
    "send_pitch": "Send a pitch",
    "send_quote": "Send a quote",
    "send_invoice": "Send an invoice",
    "send_payment_chase": "Send a payment reminder",
}


def _scored_line(result: dict) -> str:
    failed = result.get("failed", 0)
    return f"Scored {result.get('scored', 0)} against your profile" + (
        f", {failed} failed (usually a rate limit)" if failed else ""
    )


def _opportunity_title(opportunity_id: str) -> str:
    row = (
        get_client().table("opportunity").select("title").eq("id", opportunity_id).maybe_single().execute()
    )
    title = (row.data or {}).get("title") if row else None
    return f"“{title[:80]}”" if title else "this posting"


def _executed_line(action_type: str, result: dict) -> str:
    """What approving actually changed, in plain words."""
    if result.get("skipped"):
        return str(result.get("reason") or "skipped, nothing sent")
    return {
        "send_pitch": "conversation opened, deal created, follow-up in 4 days",
        "send_email": "reply recorded on the thread, follow-up scheduled",
        "send_quote": "quote marked sent, deal moved to quoted, check-in in 5 days",
        "send_invoice": "invoice marked sent, payment check scheduled for after it is due",
        "send_payment_chase": "reminder recorded, next check in 7 days",
    }.get(action_type, "done")


class KickoffRequest(BaseModel):
    score_limit: int = 6
    # No pitch unless asked for. Someone who has just set up wants to look
    # at their leads and choose; a pitch drafted on their behalf for a lead
    # they may not want spends writer tokens on text most people reject.
    pitch_top: int = 0


@app.post("/kickoff")
def kickoff(req: KickoffRequest, user_id: str = Depends(get_current_user_id)) -> dict:
    """Everything a freshly-onboarded user should get without asking:
    pull the feeds, score what came back against their new profile, and
    draft a pitch for the best match.

    Deliberately one call rather than making someone press three buttons
    in order -- the product claim is an agent that does the work, and a
    first run that ends in "here is outreach ready to send" demonstrates
    that in a way a list of jobs behind two buttons does not.

    Each stage degrades independently: sourcing can succeed while scoring
    is rate-limited, and the response says exactly what happened at each
    step rather than collapsing to a single success/failure.
    """
    # Stage failures are recorded here and returned, not raised. This used
    # to promise independent stages while only the pitch step kept it: a
    # failure while checking links or scoring discarded everything
    # already done -- including the postings it had just fetched -- and
    # answered a bare 500, which left a new user on a dead-end error screen
    # with no idea which part broke. The full traceback goes to the log;
    # the response names the exception so the screen can say something.
    errors: dict[str, str] = {}

    def failed(stage: str, exc: Exception) -> None:
        logger.exception("kickoff stage %r failed for %s", stage, user_id)
        errors[stage] = f"{type(exc).__name__}: {exc}"[:300]

    with manual_run(user_id, label="Onboarding: find, check, score and pitch") as run:
        sync = sync_sources(user_id)
        per_source = " · ".join(
            f"{s['kind']} {s.get('fetched', 0)}" if s.get("ok") else f"{s['kind']} failed"
            for s in sync.get("sources", [])
        )
        run.step(f"Sourced {sync.get('total', 0)} postings ({per_source})", tool="sync_sources")

        # Check the links before spending model calls on them. Scoring a
        # posting that was filled last month costs real tokens to produce
        # a number nobody should act on.
        try:
            links = verify_opportunities(user_id, limit=req.score_limit * 3)
        except Exception as exc:
            failed("links", exc)
            links = {"checked": 0, "live": 0, "closed": 0, "gone": 0, "unreachable": 0, "skipped": 0}
        dead = links.get("gone", 0) + links.get("closed", 0)
        run.step(
            f"Checked {links.get('checked', 0)} links — {links.get('live', 0)} live"
            + (f", {dead} no longer open and excluded" if dead else ""),
            tool="verify_links",
        )

        try:
            scoring = score_unscored(limit=req.score_limit)
        except ProfileMissingError as exc:
            raise HTTPException(400, str(exc)) from exc
        except Exception as exc:
            failed("scoring", exc)
            scoring = {"scored": 0, "failed": 0}
        run.step(_scored_line(scoring), tool="score_fit")

        # Pitch only genuinely good matches. Drafting outreach for a
        # 20/100 lead would be the exact generic spam this is supposed to
        # replace, and it costs a model call to produce something the
        # human should reject anyway.
        try:
            best = (
                get_client()
                .table("opportunity")
                .select("id,fit_score")
                .eq("user_id", user_id)
                .eq("status", "scored")
                .gte("fit_score", 60)
                .order("fit_score", desc=True)
                .limit(req.pitch_top)
                .execute()
            ).data or []
        except Exception as exc:
            failed("pitching", exc)
            best = []

        pitched, pitch_errors = [], []
        for row in best:
            try:
                pitched.append(draft_pitch_for(row["id"]))
                run.step(
                    f"Drafted a pitch for {_opportunity_title(row['id'])} (fit {row['fit_score']}) "
                    "— waiting for your approval, nothing sent",
                    tool="draft_pitch",
                )
            except Exception as exc:
                pitch_errors.append({"opportunity_id": row["id"], "error": str(exc)[:200]})
        if not best:
            run.step(
                "No lead scored 60 or more, so no pitch was drafted — writing to a weak match is spam",
                tool="draft_pitch",
            )

        run.outcome = (
            f"Sourced {sync.get('total', 0)}, checked {links.get('checked', 0)}, "
            f"scored {scoring['scored']}, pitched {len(pitched)}"
        )
        run_id = run.id

    return {
        "run_id": run_id,
        "sourced": sync,
        "links": links,
        "scored": {"scored": scoring["scored"], "failed": scoring["failed"]},
        "pitched": [
            {"opportunity_id": p["opportunity_id"], "approval_id": p["approval_id"]}
            for p in pitched
        ],
        "pitch_errors": pitch_errors,
        "errors": errors,
    }


@app.post("/opportunities/{opportunity_id}/dismiss")
def dismiss_opportunity(
    opportunity_id: str, user_id: str = Depends(get_current_user_id)
) -> dict:
    res = (
        get_client()
        .table("opportunity")
        .update({"status": "dismissed", "updated_at": "now()"})
        .eq("id", opportunity_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not res.data:
        raise HTTPException(404, "opportunity not found")
    return res.data[0]


# ── search ──────────────────────────────────────────────────────────────


@app.get("/search")
def get_search(q: str = "", user_id: str = Depends(get_current_user_id)) -> dict:
    """Search postings, conversations, deals, invoices and runs at once.

    One endpoint rather than per-screen filtering, because the header box
    promises to search everything and a promise the UI cannot keep is
    worse than no box at all. See search.py.
    """
    return run_search(user_id, q)


# ── dashboard ───────────────────────────────────────────────────────────


@app.get("/summary")
def get_summary(user_id: str = Depends(get_current_user_id)) -> dict:
    """Polled by the app chrome every 30s for the approvals badge, the
    spend-against-cap line and the next scheduled wake."""
    return build_summary(user_id)


@app.get("/overview")
def get_overview(user_id: str = Depends(get_current_user_id)) -> dict:
    """Every number on the Overview screen, computed from real rows."""
    return build_overview(user_id)


# ── deals ───────────────────────────────────────────────────────────────


@app.get("/deals")
def list_deals(
    response: Response,
    limit: int = 200,
    offset: int = 0,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """Defaults to a wide page on purpose. The Money screen works out
    which deals are still quotable by comparing every deal against every
    live quote, and a half-read list there would offer to quote something
    already quoted. The pipeline screen asks for a real page size."""
    query = (
        get_client()
        .table("deal")
        .select("*", count="exact")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
    )
    return paginate(query, response, limit, offset)


@app.post("/deals/{deal_id}/quote")
def quote_deal(deal_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    """Price one deal. Queues a send_quote approval -- nothing is sent."""
    with manual_run(user_id, label="Draft a quote", trigger_ref=deal_id) as run:
        try:
            result = draft_quote_for(deal_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        run.outcome = (
            f"Priced the deal at {result.get('currency', '')} {result.get('total')} "
            "— quote waiting for your approval"
        )
        run.step(run.outcome, tool="draft_quote", payload={"approval_id": result.get("approval_id")})
        return result


# ── money ───────────────────────────────────────────────────────────────
#
# The four routes that record what the *client* did (accepted, declined,
# paid) are deliberately human-only -- there is no tool for them and the
# agent cannot call them. Inferring "they accepted" from an enthusiastic
# email is exactly the kind of guess that ends with a stranger being
# invoiced for work they never agreed to.


@app.get("/quotes")
def list_quotes(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    res = (
        get_client()
        .table("quote")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


def _owned_quote(client, quote_id: str, user_id: str) -> dict:
    res = (
        client.table("quote")
        .select("*")
        .eq("id", quote_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(404, "quote not found")
    return res.data


def _decide_quote(quote_id: str, user_id: str, status: str) -> dict:
    client = get_client()
    quote = _owned_quote(client, quote_id, user_id)
    if quote["status"] not in ("sent", "expired"):
        raise HTTPException(
            409,
            f"quote is {quote['status']!r} -- only a quote that has actually been sent "
            "can be marked accepted or declined.",
        )
    updated = (
        client.table("quote")
        .update({"status": status, "decided_at": "now()", "updated_at": "now()"})
        .eq("id", quote_id)
        .eq("user_id", user_id)
        .execute()
    )
    # A decided quote needs no further chasing. Cancel rather than delete,
    # so the trace of what was scheduled and why survives.
    client.table("task").update({"status": "cancelled"}).eq("subject_id", quote_id).eq(
        "kind", "quote_chase"
    ).eq("status", "pending").execute()

    if status == "declined":
        client.table("deal").update({"stage": "lost", "updated_at": "now()"}).eq(
            "id", quote["deal_id"]
        ).eq("user_id", user_id).execute()

    return updated.data[0]


@app.post("/quotes/{quote_id}/accepted")
def accept_quote(quote_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    """The human records that the client accepted. This is the only thing
    that unlocks invoicing."""
    return _decide_quote(quote_id, user_id, "accepted")


@app.post("/quotes/{quote_id}/declined")
def decline_quote(quote_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    return _decide_quote(quote_id, user_id, "declined")


@app.post("/quotes/{quote_id}/invoice")
def invoice_quote(quote_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    """Raise an invoice against an accepted quote. Queues a send_invoice
    approval -- nothing is sent."""
    with manual_run(user_id, label="Raise an invoice", trigger_ref=quote_id) as run:
        try:
            result = draft_invoice_for(quote_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        run.outcome = f"Raised invoice {result.get('number')} — waiting for your approval"
        run.step(run.outcome, tool="draft_invoice", payload={"approval_id": result.get("approval_id")})
        return result


@app.get("/invoices")
def list_invoices(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    res = (
        get_client()
        .table("invoice")
        .select("*")
        .eq("user_id", user_id)
        .order("created_at", desc=True)
        .execute()
    )
    return res.data or []


@app.post("/invoices/{invoice_id}/paid")
def mark_invoice_paid(invoice_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    """The human records that the money arrived. Closes the deal as won
    and, critically, cancels the pending chase task -- an agent that keeps
    dunning a client who already paid is worse than one that never
    chased at all."""
    client = get_client()
    res = (
        client.table("invoice")
        .select("*")
        .eq("id", invoice_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(404, "invoice not found")
    invoice = res.data
    if invoice["status"] == "paid":
        return invoice
    if invoice["status"] != "sent":
        raise HTTPException(409, f"invoice is {invoice['status']!r}, not 'sent'")

    updated = (
        client.table("invoice")
        .update({"status": "paid", "paid_at": "now()", "updated_at": "now()"})
        .eq("id", invoice_id)
        .eq("user_id", user_id)
        .execute()
    )
    client.table("task").update({"status": "cancelled"}).eq("subject_id", invoice_id).eq(
        "kind", "invoice_chase"
    ).eq("status", "pending").execute()
    client.table("deal").update({"stage": "won", "updated_at": "now()"}).eq(
        "id", invoice["deal_id"]
    ).eq("user_id", user_id).execute()

    # Cancelling the scheduled task is not enough on its own: a reminder
    # that was already drafted is sitting in the Approval Inbox as a live
    # card, and approving it would send a dunning message for an invoice
    # that has been paid. Found exactly that way -- a test run approved a
    # stale card and logged the message. Reject them here so the card
    # disappears the moment the money is recorded.
    stale = (
        client.table("approval")
        .select("id, payload")
        .eq("user_id", user_id)
        .eq("action_type", "send_payment_chase")
        .eq("status", "pending")
        .execute()
    ).data or []
    for approval in stale:
        if (approval.get("payload") or {}).get("invoice_id") == invoice_id:
            client.table("approval").update(
                {"status": "rejected", "decided_at": "now()"}
            ).eq("id", approval["id"]).execute()

    return updated.data[0]


@app.post("/invoices/{invoice_id}/chase")
def chase_invoice(invoice_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    """Draft the next payment reminder now, rather than waiting for the
    scheduled check. Returns action "none" if there is nothing to chase."""
    with manual_run(user_id, label="Chase a payment", trigger_ref=invoice_id) as run:
        try:
            result = chase_payment_for(invoice_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc
        if result.get("action") == "chase_drafted":
            run.outcome = (
                f"Drafted a payment reminder ({result.get('days_overdue')} days overdue) "
                "— waiting for your approval"
            )
        else:
            run.outcome = f"Nothing to chase: {result.get('reason')}"
        run.step(run.outcome, tool="chase_payment")
        return result


# ── approvals ───────────────────────────────────────────────────────────


#: Every state an approval can end in. `approved` is included because it is
#: the brief moment between the click and the executor finishing -- a card
#: must never vanish from both lists at once.
DECIDED_STATUSES = ["approved", "executed", "rejected", "failed"]


@app.get("/approvals")
def list_approvals(status: str = "pending", user_id: str = Depends(get_current_user_id)) -> list[dict]:
    """`status=decided` returns the history -- everything already approved,
    sent, rejected or failed, newest decision first. Without it, approving
    a card made it disappear with nowhere to see what had happened to it."""
    query = get_client().table("approval").select("*").eq("user_id", user_id)
    if status == "decided":
        query = query.in_("status", DECIDED_STATUSES).order("decided_at", desc=True, nullsfirst=False).limit(30)
    else:
        query = query.eq("status", status).order("created_at")
    return query.execute().data or []


class EditApprovalRequest(BaseModel):
    payload: dict[str, Any]


def _owned_pending_approval(client, approval_id: str, user_id: str) -> dict:
    res = (
        client.table("approval")
        .select("*")
        .eq("id", approval_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(404, "approval not found")
    if res.data["status"] != "pending":
        raise HTTPException(409, f"approval is {res.data['status']}, not pending")
    return res.data


@app.patch("/approvals/{approval_id}")
def edit_approval(
    approval_id: str, req: EditApprovalRequest, user_id: str = Depends(get_current_user_id)
) -> dict:
    """Edit a pending approval's payload before deciding on it -- the "e"
    in the Approval Inbox's a/r/e. Only pending approvals can be edited;
    merges into the existing payload rather than replacing it wholesale,
    so callers can patch just e.g. {"body": "..."}."""
    client = get_client()
    approval = _owned_pending_approval(client, approval_id, user_id)

    merged_payload = {**approval["payload"], **req.payload}
    updated = (
        client.table("approval")
        .update({"payload": merged_payload})
        .eq("id", approval_id)
        .execute()
    )
    return updated.data[0]


@app.post("/approvals/{approval_id}/approve")
def approve(approval_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    client = get_client()
    approval = _owned_pending_approval(client, approval_id, user_id)
    verb = ACTION_VERBS.get(approval["action_type"], approval["action_type"])

    client.table("approval").update(
        {"status": "approved", "decided_at": "now()"}
    ).eq("id", approval_id).execute()

    # A run of its own, so the decision shows up in Runs and on the
    # Overview -- approving used to change the database and leave no trace
    # anywhere a person would look.
    with manual_run(user_id, label=f"You approved: {verb}", trigger_ref=approval_id) as run:
        try:
            result = execute_approval(approval_id)
        except Exception as exc:
            raise HTTPException(500, str(exc)) from exc
        run.outcome = f"You approved: {verb} — {_executed_line(approval['action_type'], result)}"
        run.step(run.outcome, tool=approval["action_type"], payload={"result": result})

    return {"status": "executed", "result": result}


@app.post("/approvals/{approval_id}/reject")
def reject(approval_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    client = get_client()
    approval = _owned_pending_approval(client, approval_id, user_id)
    verb = ACTION_VERBS.get(approval["action_type"], approval["action_type"])

    client.table("approval").update(
        {"status": "rejected", "decided_at": "now()"}
    ).eq("id", approval_id).execute()

    with manual_run(user_id, label=f"You rejected: {verb}", trigger_ref=approval_id) as run:
        run.outcome = f"You rejected: {verb} — nothing was sent"
        run.step(run.outcome, tool=approval["action_type"])
    return {"status": "rejected"}


# ── intake ──────────────────────────────────────────────────────────────


class IntakeRequest(BaseModel):
    contact_name: str | None = None
    contact_email: str | None = None
    message: str


@app.get("/intake/{user_id}")
def intake_details(user_id: str) -> dict:
    """What the public intake form needs to render: who it reaches.

    Public by necessity -- the person filling this in is a stranger with
    no workspace. It returns only what a freelancer would put on their
    own landing page anyway (name, headline, one-line overview) and
    nothing about their pipeline, rates or clients.
    """
    resolve_account(user_id)
    res = (
        get_client()
        .table("profile")
        .select("name, title, positioning")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        raise HTTPException(404, "this intake link has no profile behind it yet")
    return res.data


@app.post("/intake/{user_id}")
def intake(user_id: str, req: IntakeRequest) -> dict:
    """Public, unauthenticated -- the point of a lead-capture form is
    that strangers can post to it.

    The workspace id is checked first so a mistyped link fails as a clean
    404 rather than inserting orphan rows keyed to a workspace that does
    not exist.
    """
    resolve_account(user_id)
    client = get_client()

    thread = (
        client.table("thread")
        .insert(
            {
                "user_id": user_id,
                "contact_name": req.contact_name,
                "contact_email": req.contact_email,
                "channel": "intake_form",
            }
        )
        .execute()
    )
    thread_id = thread.data[0]["id"]

    client.table("message").insert(
        {"thread_id": thread_id, "user_id": user_id, "direction": "inbound", "body": req.message}
    ).execute()

    deal = (
        client.table("deal")
        .insert({"user_id": user_id, "thread_id": thread_id, "stage": "new", "source": "intake_form"})
        .execute()
    )
    deal_id = deal.data[0]["id"]

    # The client's message is saved above, whatever happens next -- so the
    # person who filled in the form is told it arrived even if the agent's
    # own run fails. That run used to raise straight through to a 500, and
    # a stranger sending a real enquiry saw an error for a message the
    # freelancer had in fact received. The failure isn't hidden: run_agent
    # has already recorded the run as failed with its reason, where the
    # freelancer can see it, and the thread is waiting for them.
    try:
        run = run_agent(
            Trigger(
                user_id=user_id,
                trigger_type="message",
                trigger_ref=thread_id,
                prompt=(
                    f"A new inbound message just arrived on thread {thread_id} "
                    f"(deal {deal_id}). Qualify the lead and draft a reply."
                ),
            )
        )
    except Exception:
        logger.exception("intake run failed for thread %s", thread_id)
        return {"thread_id": thread_id, "deal_id": deal_id, "run_id": None, "run_status": "failed"}

    return {"thread_id": thread_id, "deal_id": deal_id, "run_id": run.id, "run_status": run.status}


class InboundMessage(BaseModel):
    body: str


@app.post("/threads/{thread_id}/messages")
def log_inbound(
    thread_id: str, req: InboundMessage, user_id: str = Depends(get_current_user_id)
) -> dict:
    """Record a client's answer on an existing conversation.

    Clockwork doesn't read anyone's inbox: a pitch goes out through the
    board or the address the freelancer applied with, so the answer lands
    there too. This is how it comes back in -- paste it, and the agent
    wakes on it exactly as it does for an intake message: qualify the
    lead, then draft the next reply for approval. Saved first, so a failed
    run never loses what the client wrote.
    """
    body = req.body.strip()
    if not body:
        raise HTTPException(422, "Paste the client's message first")

    client = get_client()
    thread = (
        client.table("thread")
        .select("id")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not thread or not thread.data:
        raise HTTPException(404, "thread not found")

    client.table("message").insert(
        {"thread_id": thread_id, "user_id": user_id, "direction": "inbound", "body": body}
    ).execute()
    client.table("thread").update({"last_message_at": "now()"}).eq("id", thread_id).execute()

    deal = client.table("deal").select("id").eq("thread_id", thread_id).limit(1).execute()
    deal_id = deal.data[0]["id"] if deal.data else None
    deal_note = f" (deal {deal_id})" if deal_id else ""

    try:
        run = run_agent(
            Trigger(
                user_id=user_id,
                trigger_type="message",
                trigger_ref=thread_id,
                prompt=(
                    f"The client just replied on thread {thread_id}{deal_note}. "
                    "Read the whole conversation, qualify the lead, and draft a reply."
                ),
            )
        )
    except Exception:
        logger.exception("reply run failed for thread %s", thread_id)
        return {"thread_id": thread_id, "run_id": None, "run_status": "failed"}

    return {"thread_id": thread_id, "run_id": run.id, "run_status": run.status}


# ── virtual clock ───────────────────────────────────────────────────────
#
# The demo unlock: every time read in the codebase goes through clock.now()
# (see clock.py's own docstring), so pushing a user's offset forward here
# and immediately draining their due tasks makes the follow-up ladder
# fire and become visible in seconds instead of requiring an actual wait.


class ClockAdvanceRequest(BaseModel):
    days: float


@app.get("/clock")
def get_clock(user_id: str = Depends(get_current_user_id)) -> dict:
    return {"now": clock.now(user_id).isoformat()}


@app.post("/clock/advance")
def advance_clock(req: ClockAdvanceRequest, user_id: str = Depends(get_current_user_id)) -> dict:
    new_now = clock.advance(user_id, req.days)
    fired = tick(user_id)
    return {"now": new_now.isoformat(), "fired": fired}


@app.post("/clock/reset")
def reset_clock(user_id: str = Depends(get_current_user_id)) -> dict:
    new_now = clock.reset(user_id)
    return {"now": new_now.isoformat()}


# ── scheduled tick ──────────────────────────────────────────────────────
#
# The serverless replacement for the in-process 30-second poll. Something
# outside calls this on a schedule -- a GitHub Actions workflow, since the
# free Vercel plan only runs cron once a day -- and it drains whatever is
# due across every workspace, exactly as the local timer does.

#: Tasks claimed per call. Each is an agent run of anywhere from a few
#: seconds to about a minute, and a Vercel request is killed at 300s; three
#: leaves real headroom. Anything past the cap stays pending for next time.
TICK_LIMIT = 3


@app.post("/tasks/tick")
def scheduled_tick(authorization: str | None = Header(default=None)) -> dict:
    if not settings.cron_secret:
        # 503 rather than 401: the caller did nothing wrong, the deployment
        # is missing a variable, and saying so saves a debugging session.
        raise HTTPException(503, "CRON_SECRET is not configured on this deployment")
    if not cron_authorized(authorization, settings.cron_secret):
        raise HTTPException(401, "Missing or wrong scheduler secret")

    fired = tick_all_due(limit=TICK_LIMIT)
    return {"fired": len(fired), "limit": TICK_LIMIT, "results": fired}
