"""FastAPI app -- API + agent host.

Routes (Phase 1 Day 4-5 scope):
  POST  /runs                      -> run_agent(), returns run_id
  GET   /runs/{id}/events          -> SSE stream of agent_event rows
  GET   /threads?user_id=...       -> list threads (Threads view)
  GET   /threads/{id}              -> thread + messages + its deal
  GET   /deals?user_id=...         -> list deals (pipeline table)
  GET   /approvals?status=pending  -> list approvals (the signature screen)
  PATCH /approvals/{id}            -> edit a pending approval's payload
                                       (the "e" in a/r/e)
  POST  /approvals/{id}/approve    -> approve + execute
  POST  /approvals/{id}/reject     -> reject, no side effect
  POST  /intake/{slug}             -> public, no auth -- creates thread +
                                       message, fires a run
  GET   /health

Gmail OAuth (inbound polling / send) is not wired here yet -- see
executor.py's TODO. It needs a Google Cloud console app set up by hand
before any code can use it.

No auth on this API yet -- the Next.js frontend (apps/web) calls it
directly with a user_id it's been given out of band (env var, no login
flow). Fine for local/demo use; real auth is a later Phase 1/4 item.
"""

import asyncio
import json
from typing import Any

from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

from .agent import Trigger, run_agent
from .db import get_client
from .executor import execute_approval

app = FastAPI(title="Clockwork Agent API")

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
    user_id: str
    trigger_type: str = "manual"
    trigger_ref: str | None = None
    prompt: str


@app.post("/runs")
def create_run(req: RunRequest) -> dict:
    run = run_agent(
        Trigger(
            user_id=req.user_id,
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


@app.get("/runs/{run_id}/events")
async def stream_run_events(run_id: str):
    """SSE stream of agent_event rows for a run, polling Postgres (no
    Supabase Realtime dependency for Phase 1 -- swap for a Realtime
    subscription later if polling latency becomes visible)."""

    async def event_stream():
        seen_ids: set[str] = set()
        client = get_client()
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

            run_res = (
                client.table("agent_run")
                .select("status")
                .eq("id", run_id)
                .maybe_single()
                .execute()
            )
            if run_res and run_res.data and run_res.data["status"] != "running":
                if idle_polls >= 1:
                    break

            await asyncio.sleep(1)

    return StreamingResponse(event_stream(), media_type="text/event-stream")


# ── threads ─────────────────────────────────────────────────────────────


@app.get("/threads")
def list_threads(user_id: str) -> list[dict]:
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
def get_thread_detail(thread_id: str) -> dict:
    client = get_client()

    thread_res = client.table("thread").select("*").eq("id", thread_id).maybe_single().execute()
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


# ── deals ───────────────────────────────────────────────────────────────


@app.get("/deals")
def list_deals(user_id: str) -> list[dict]:
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
def list_approvals(status: str = "pending", user_id: str | None = None) -> list[dict]:
    query = get_client().table("approval").select("*").eq("status", status)
    if user_id:
        query = query.eq("user_id", user_id)
    res = query.order("created_at").execute()
    return res.data or []


class EditApprovalRequest(BaseModel):
    payload: dict[str, Any]


@app.patch("/approvals/{approval_id}")
def edit_approval(approval_id: str, req: EditApprovalRequest) -> dict:
    """Edit a pending approval's payload before deciding on it -- the "e"
    in the Approval Inbox's a/r/e. Only pending approvals can be edited;
    merges into the existing payload rather than replacing it wholesale,
    so callers can patch just e.g. {"body": "..."}."""
    client = get_client()
    res = client.table("approval").select("status,payload").eq("id", approval_id).maybe_single().execute()
    if not res or not res.data:
        raise HTTPException(404, "approval not found")
    if res.data["status"] != "pending":
        raise HTTPException(409, f"approval is {res.data['status']}, not pending")

    merged_payload = {**res.data["payload"], **req.payload}
    updated = (
        client.table("approval")
        .update({"payload": merged_payload})
        .eq("id", approval_id)
        .execute()
    )
    return updated.data[0]


@app.post("/approvals/{approval_id}/approve")
def approve(approval_id: str) -> dict:
    client = get_client()
    res = client.table("approval").select("status").eq("id", approval_id).maybe_single().execute()
    if not res or not res.data:
        raise HTTPException(404, "approval not found")
    if res.data["status"] != "pending":
        raise HTTPException(409, f"approval is {res.data['status']}, not pending")

    client.table("approval").update(
        {"status": "approved", "decided_at": "now()"}
    ).eq("id", approval_id).execute()

    try:
        result = execute_approval(approval_id)
    except Exception as exc:
        raise HTTPException(500, str(exc)) from exc

    return {"status": "executed", "result": result}


@app.post("/approvals/{approval_id}/reject")
def reject(approval_id: str) -> dict:
    client = get_client()
    res = client.table("approval").select("status").eq("id", approval_id).maybe_single().execute()
    if not res or not res.data:
        raise HTTPException(404, "approval not found")
    if res.data["status"] != "pending":
        raise HTTPException(409, f"approval is {res.data['status']}, not pending")

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
