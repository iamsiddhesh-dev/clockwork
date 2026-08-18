"""run_agent() -- the single entry point. Both the HTTP layer (api.py) and
the scheduler's tick() call this. There is no second path.

Opens an `agent_run` row, builds the orchestrator with the audit hook
attached, runs it, closes the row with an outcome + total cost. Any
exception is caught, the run is marked failed with the error recorded,
then re-raised -- so the audit trail always has a terminal status, but
callers still see the failure.
"""

from dataclasses import dataclass
from typing import Literal

from strands import Agent

from .audit import AuditTrail
from .context import run_context
from .db import get_client
from .ledger import record_usage, resolve_role, total_run_cost_usd
from .models import Role, get_model
from .tools import ALL_TOOLS

TriggerType = Literal["message", "schedule", "manual"]

SYSTEM_PROMPT = (
    "You are Clockwork, an autonomous agent that runs the business side of "
    "freelancing: sourcing, pitching, qualifying, quoting, invoicing, and "
    "chasing payment. Use your tools to read real state before acting. Any "
    "outbound client-facing action must go through draft_reply (or another "
    "approval-gated tool) -- never fabricate a sent message. Be concrete "
    "and cite what you actually read."
)


@dataclass
class Trigger:
    user_id: str
    trigger_type: TriggerType
    prompt: str
    trigger_ref: str | None = None


@dataclass
class AgentRun:
    id: str
    status: Literal["completed", "failed"]
    outcome: str | None
    total_cost_usd: float
    error: str | None = None


def run_agent(trigger: Trigger) -> AgentRun:
    client = get_client()

    run_row = (
        client.table("agent_run")
        .insert(
            {
                "user_id": trigger.user_id,
                "trigger_type": trigger.trigger_type,
                "trigger_ref": trigger.trigger_ref,
                "status": "running",
            }
        )
        .execute()
    )
    run_id = run_row.data[0]["id"]

    try:
        with run_context(user_id=trigger.user_id, run_id=run_id):
            role = resolve_role(trigger.user_id, Role.ORCHESTRATOR, run_id=run_id)
            model = get_model(role)
            orchestrator = Agent(
                model=model,
                tools=ALL_TOOLS,
                system_prompt=SYSTEM_PROMPT,
                hooks=[AuditTrail(run_id, trigger.user_id)],
                # Server-side call, not an interactive CLI session -- see
                # ledger.invoke_model's identical note.
                callback_handler=None,
            )
            result = orchestrator(trigger.prompt)
            record_usage(user_id=trigger.user_id, run_id=run_id, role=role, result=result)
            # Sum *all* model calls this run made, not just the orchestrator's
            # own -- tool calls (qualify_lead, draft_reply, ...) invoke their
            # own models and would otherwise be silently dropped from the
            # run's reported cost. See ledger.total_run_cost_usd.
            cost = total_run_cost_usd(run_id)

        outcome = str(result)
        client.table("agent_run").update(
            {
                "status": "completed",
                "completed_at": "now()",
                "outcome": outcome,
                "total_cost_usd": cost,
            }
        ).eq("id", run_id).execute()

        return AgentRun(id=run_id, status="completed", outcome=outcome, total_cost_usd=cost)

    except Exception as exc:
        client.table("agent_run").update(
            {"status": "failed", "completed_at": "now()", "error": str(exc)}
        ).eq("id", run_id).execute()
        raise
