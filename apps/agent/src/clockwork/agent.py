"""run_agent() -- the agent loop. A client message, a pasted reply and a
scheduled check-in all come through here. Work with no decision to make --
a button press, a due payment check -- calls the same tool code directly
and is recorded by runs.manual_run instead.

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
from .retry import orchestrator_retry_strategy
from .tools import ALL_TOOLS

TriggerType = Literal["message", "schedule", "manual"]

SYSTEM_PROMPT = (
    "You are Clockwork, an autonomous agent that runs the business side of "
    "freelancing: sourcing, pitching, qualifying, quoting, invoicing, and "
    "chasing payment. Use your tools to read real state before acting. Any "
    "outbound client-facing action must go through draft_reply (or another "
    "approval-gated tool) -- never fabricate a sent message. Be concrete "
    "and cite what you actually read.\n\n"
    "You only run once per trigger -- you do not stay awake waiting. If a "
    "thread might need a human nudge later (e.g. you just drafted a reply "
    "and the client hasn't answered yet, or an invoice isn't due but will "
    "be), use schedule_task to put a check-in on your own future to-do "
    "list instead of trying to remember. A scheduled run will re-read the "
    "real state when it fires and decide fresh whether anything's still "
    "needed -- don't schedule a task for something already resolved.\n\n"
    "On money: quote -> invoice -> chase runs in that order and skips no "
    "step. draft_quote prices a deal; draft_invoice only works once a "
    "human has recorded that the client accepted the quote, and you "
    "cannot record that yourself -- an enthusiastic email is not "
    "acceptance, and invoicing someone who never agreed is the worst "
    "thing you could do on their behalf. chase_payment already knows "
    "every reason not to chase (paid, void, not yet due) and will say so; "
    "trust its answer instead of second-guessing it.\n\n"
    "Your final answer is shown to the freelancer. Write one or two plain "
    "sentences about what you did and why. Never include ids, JSON, code or "
    "tool names in it."
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
                # Retries the one refused model call on a rate limit -- see
                # retry.orchestrator_retry_strategy for why that is safe
                # when retrying the whole run below is not.
                retry_strategy=orchestrator_retry_strategy(),
                # Server-side call, not an interactive CLI session -- see
                # ledger.invoke_model's identical note.
                callback_handler=None,
            )
            # Deliberately NOT wrapped in call_with_retry: this single call
            # may run several tools internally (qualify_lead, draft_reply,
            # ...) before returning. A 429 that surfaces after some of
            # those already ran their side effects would, on blind retry,
            # re-run the whole prompt and could duplicate e.g. an approval
            # row. Retrying is only safe at the granularity of one tool's
            # own model call (see ledger.invoke_model), where nothing has
            # happened yet by the time the model call itself fails -- which
            # is what the retry_strategy above does for the orchestrator's
            # own calls. A 429 that outlasts it fails the run cleanly,
            # safer than a retry that might double-send.
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
