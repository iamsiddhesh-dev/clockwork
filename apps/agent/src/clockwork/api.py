"""FastAPI app -- API + agent host.

Routes:
  POST  /runs                      -> run_agent(), returns run_id
  GET   /runs                      -> list recent runs (Run Trace panel)
  GET   /runs/{id}/events?token=.. -> SSE stream of agent_event rows
  GET   /threads                   -> list threads (Threads view)
  GET   /threads/{id}              -> thread + messages + its deal
  GET   /deals                     -> list deals (pipeline table)
  GET   /approvals?status=pending  -> list approvals (the signature screen)
  PATCH /approvals/{id}            -> edit a pending approval's payload
                                       (the "e" in a/r/e)
  POST  /approvals/{id}/approve    -> approve + execute
  POST  /approvals/{id}/reject     -> reject, no side effect
  POST  /intake/{slug}             -> public, no auth -- creates thread +
                                       message, fires a run
  GET   /clock                     -> current virtual time
  POST  /clock/advance             -> demo control: fast-forward + drain
                                       any tasks that become due
  POST  /clock/reset               -> demo control: back to real time
  GET   /health

Gmail OAuth (inbound polling / send) is not wired here yet -- see
executor.py's TODO. It needs a Google Cloud console app set up by hand
before any code can use it.

Auth: every route above except /intake and /health requires
`Authorization: Bearer <supabase access token>` (see auth.py) and derives
`user_id` from the verified token -- never from a client-supplied param.
Every route that touches one specific resource (a thread, an approval, a
run) also checks that resource's own user_id matches the caller, not just
that *some* valid token was presented. The SSE route is the one
exception to the header rule: browser EventSource can't send custom
headers, so it takes `?token=` as a query param instead, verified the
same way.

Background: an APScheduler job polls `scheduler.tick_all_due()` every 30s
so tasks fire in real time too, not only right after `/clock/advance`
(see `lifespan` below) -- the "Worker loop (APScheduler)" from PLAN.md's
architecture diagram.
"""

import asyncio
import json
import logging
from contextlib import asynccontextmanager
from typing import Any

from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import Depends, FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from . import clock
from .agent import Trigger, run_agent
from .auth import get_current_user_id, verify_token
from .context import run_context
from .db import get_client
from .executor import execute_approval
from .scheduler import tick, tick_all_due
from .sources import ensure_sources, sync_sources
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


@asynccontextmanager
async def lifespan(_: FastAPI):
    background_scheduler = BackgroundScheduler()
    background_scheduler.add_job(_poll_tick, "interval", seconds=30, id="tick_all_due")
    background_scheduler.start()
    try:
        yield
    finally:
        background_scheduler.shutdown(wait=False)


app = FastAPI(title="Clockwork Agent API", lifespan=lifespan)

# Dev-only CORS: the Next.js dev server runs on a different origin than
# this API. Tighten this to the deployed frontend's real origin before
# shipping past local/demo use.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health")
def health() -> dict:
    return {"status": "ok"}


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
def list_runs(limit: int = 30, user_id: str = Depends(get_current_user_id)) -> list[dict]:
    res = (
        get_client()
        .table("agent_run")
        .select("*")
        .eq("user_id", user_id)
        .order("started_at", desc=True)
        .limit(limit)
        .execute()
    )
    return res.data or []


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
async def stream_run_events(run_id: str, token: str):
    """SSE stream of agent_event rows for a run, polling Postgres (no
    Supabase Realtime dependency for Phase 1 -- swap for a Realtime
    subscription later if polling latency becomes visible). Takes
    `?token=` rather than an Authorization header -- see module
    docstring; browser EventSource cannot set custom headers."""
    user_id = verify_token(token)
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
def list_threads(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    res = (
        get_client()
        .table("thread")
        .select("*")
        .eq("user_id", user_id)
        .order("last_message_at", desc=True, nullsfirst=False)
        .execute()
    )
    return res.data or []


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
    skills: list[str] = []
    rates: dict[str, Any] = {}
    positioning: str | None = None
    voice_samples: list[str] = []
    portfolio: list[dict[str, Any]] = []
    payment_terms: str | None = None


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

    return res.data[0]


# ── opportunities (outbound sourcing) ───────────────────────────────────


@app.get("/opportunities")
def list_opportunities(
    status: str | None = None,
    limit: int = 100,
    user_id: str = Depends(get_current_user_id),
) -> list[dict]:
    """Best fit first. Unscored rows sort last rather than being hidden --
    "not scored yet" is a real state the screen needs to show."""
    query = get_client().table("opportunity").select("*").eq("user_id", user_id)
    if status:
        query = query.eq("status", status)
    res = (
        query.order("fit_score", desc=True, nullsfirst=False)
        .order("posted_at", desc=True, nullsfirst=False)
        .limit(limit)
        .execute()
    )
    return res.data or []


@app.get("/sources")
def list_sources(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    return ensure_sources(user_id)


@app.post("/opportunities/sync")
def sync_opportunities(user_id: str = Depends(get_current_user_id)) -> dict:
    """Pull every enabled feed and cache the results. Per-source result is
    returned so a feed that errored is visible rather than silently
    looking like 'no new leads'."""
    with run_context(user_id=user_id, run_id=None):
        return sync_sources(user_id)


class ScoreRequest(BaseModel):
    limit: int = 10


@app.post("/opportunities/score")
def score_opportunities(
    req: ScoreRequest, user_id: str = Depends(get_current_user_id)
) -> dict:
    """Score a batch of unscored opportunities against the caller's
    profile. Batched on purpose -- see score_unscored's docstring."""
    with run_context(user_id=user_id, run_id=None):
        try:
            return score_unscored(limit=req.limit)
        except ProfileMissingError as exc:
            raise HTTPException(400, str(exc)) from exc


@app.post("/opportunities/{opportunity_id}/pitch")
def pitch_opportunity(
    opportunity_id: str, user_id: str = Depends(get_current_user_id)
) -> dict:
    """Draft outbound outreach for one opportunity. Queues an approval --
    nothing is sent here."""
    with run_context(user_id=user_id, run_id=None):
        try:
            return draft_pitch_for(opportunity_id)
        except ValueError as exc:
            raise HTTPException(400, str(exc)) from exc


class KickoffRequest(BaseModel):
    score_limit: int = 6
    pitch_top: int = 1


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
    with run_context(user_id=user_id, run_id=None):
        sync = sync_sources(user_id)

        try:
            scoring = score_unscored(limit=req.score_limit)
        except ProfileMissingError as exc:
            raise HTTPException(400, str(exc)) from exc

        # Pitch only genuinely good matches. Drafting outreach for a
        # 20/100 lead would be the exact generic spam this is supposed to
        # replace, and it costs a model call to produce something the
        # human should reject anyway.
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

        pitched, pitch_errors = [], []
        for row in best:
            try:
                pitched.append(draft_pitch_for(row["id"]))
            except Exception as exc:
                pitch_errors.append({"opportunity_id": row["id"], "error": str(exc)[:200]})

    return {
        "sourced": sync,
        "scored": {"scored": scoring["scored"], "failed": scoring["failed"]},
        "pitched": [
            {"opportunity_id": p["opportunity_id"], "approval_id": p["approval_id"]}
            for p in pitched
        ],
        "pitch_errors": pitch_errors,
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


# ── deals ───────────────────────────────────────────────────────────────


@app.get("/deals")
def list_deals(user_id: str = Depends(get_current_user_id)) -> list[dict]:
    res = (
        get_client()
        .table("deal")
        .select("*")
        .eq("user_id", user_id)
        .order("updated_at", desc=True)
        .execute()
    )
    return res.data or []


# ── approvals ───────────────────────────────────────────────────────────


@app.get("/approvals")
def list_approvals(status: str = "pending", user_id: str = Depends(get_current_user_id)) -> list[dict]:
    res = (
        get_client()
        .table("approval")
        .select("*")
        .eq("status", status)
        .eq("user_id", user_id)
        .order("created_at")
        .execute()
    )
    return res.data or []


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
    _owned_pending_approval(client, approval_id, user_id)

    client.table("approval").update(
        {"status": "approved", "decided_at": "now()"}
    ).eq("id", approval_id).execute()

    try:
        result = execute_approval(approval_id)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc

    return {"status": "executed", "result": result}


@app.post("/approvals/{approval_id}/reject")
def reject(approval_id: str, user_id: str = Depends(get_current_user_id)) -> dict:
    client = get_client()
    _owned_pending_approval(client, approval_id, user_id)

    client.table("approval").update(
        {"status": "rejected", "decided_at": "now()"}
    ).eq("id", approval_id).execute()
    return {"status": "rejected"}


# ── intake ──────────────────────────────────────────────────────────────


class IntakeRequest(BaseModel):
    contact_name: str | None = None
    contact_email: str | None = None
    message: str


@app.post("/intake/{user_id}")
def intake(user_id: str, req: IntakeRequest) -> dict:
    """Public, unauthenticated. `user_id` stands in for a per-freelancer
    slug for now -- swap for a real short slug -> user_id lookup once the
    profile table grows one."""
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

    return {"thread_id": thread_id, "deal_id": deal_id, "run_id": run.id, "run_status": run.status}


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
