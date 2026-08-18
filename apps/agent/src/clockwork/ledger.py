"""Token/cost accounting + the daily spend cap.

Every model call an agent run makes should go through `record_usage` (or,
for the orchestrator, through `resolve_role` first so a breached cap
degrades the role to Nova *before* the call is made). Verified against
strands-agents 1.52.0: `AgentResult.metrics.accumulated_usage` is a
`Usage` TypedDict with `inputTokens` / `outputTokens` / `totalTokens`.
"""

from datetime import datetime, timezone

from pydantic import BaseModel
from strands import Agent
from strands.agent.agent_result import AgentResult

from .context import current_run_id, current_user_id
from .db import get_client
from .models import Role, get_model, pricing_per_million


def _cost_usd(role: Role, input_tokens: int, output_tokens: int) -> float:
    price_in, price_out = pricing_per_million(role)
    return (input_tokens / 1_000_000) * price_in + (output_tokens / 1_000_000) * price_out


def _daily_spend_cap(user_id: str) -> float:
    res = (
        get_client()
        .table("app_setting")
        .select("daily_spend_cap_usd")
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not res or not res.data:
        return 5.0
    return float(res.data["daily_spend_cap_usd"])


def spent_today_usd(user_id: str) -> float:
    start_of_day = datetime.now(timezone.utc).replace(
        hour=0, minute=0, second=0, microsecond=0
    )
    res = (
        get_client()
        .table("token_ledger")
        .select("cost_usd")
        .eq("user_id", user_id)
        .gte("created_at", start_of_day.isoformat())
        .execute()
    )
    rows = res.data or []
    return sum(float(r["cost_usd"]) for r in rows)


def resolve_role(user_id: str, role: Role, run_id: str | None = None) -> Role:
    """Return the role to actually use for this call: `role` unless the
    daily spend cap has been breached, in which case the orchestrator
    silently degrades to Nova Pro (writer). Writes a `decision` agent_event
    when it degrades, so the video can show the guard firing."""
    if role is not Role.ORCHESTRATOR:
        return role

    cap = _daily_spend_cap(user_id)
    spent = spent_today_usd(user_id)
    if spent < cap:
        return role

    if run_id:
        from .audit import log_event

        log_event(
            run_id=run_id,
            user_id=user_id,
            kind="decision",
            rationale=(
                f"Daily spend cap (${cap:.2f}) reached (${spent:.2f} spent today) -- "
                "degrading orchestrator reasoning from Claude Sonnet 5 to Amazon Nova Pro."
            ),
        )
    return Role.WRITER


def record_usage(
    *, user_id: str, run_id: str | None, role: Role, result: AgentResult
) -> float:
    """Record one model call's token usage + cost from a Strands AgentResult.
    Returns the cost in USD so callers can accumulate it onto agent_run."""
    usage = result.metrics.accumulated_usage
    input_tokens = int(usage.get("inputTokens", 0))
    output_tokens = int(usage.get("outputTokens", 0))
    cost = _cost_usd(role, input_tokens, output_tokens)

    from .models import current_model_id

    get_client().table("token_ledger").insert(
        {
            "user_id": user_id,
            "run_id": run_id,
            "role": role.value,
            "model_id": current_model_id(role),
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost,
        }
    ).execute()

    return cost


def invoke_model(
    role: Role,
    prompt: str,
    *,
    structured_output_model: type[BaseModel] | None = None,
    system_prompt: str | None = None,
) -> AgentResult:
    """Run one model call under the given role, honouring the daily spend
    cap (orchestrator only) and recording usage to the ledger. This is the
    only path tools should use to call a model -- never build a
    `BedrockModel` / `Agent` directly inside a tool."""
    user_id = current_user_id()
    run_id = current_run_id()

    resolved_role = resolve_role(user_id, role, run_id=run_id)
    model = get_model(resolved_role)
    # callback_handler=None: this is a server-side call, not an interactive
    # CLI session -- streaming tokens to stdout by default both pollutes
    # server logs and crashes on non-UTF8 consoles (confirmed on Windows
    # cp1252 during Groq smoke-testing, Aug 18).
    agent = Agent(model=model, system_prompt=system_prompt, callback_handler=None)

    result = agent(prompt, structured_output_model=structured_output_model)
    record_usage(user_id=user_id, run_id=run_id, role=resolved_role, result=result)
    return result
