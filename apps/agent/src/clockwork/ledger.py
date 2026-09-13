"""Token/cost accounting + the daily spend cap.

Every model call an agent run makes should go through `record_usage` (or,
for the orchestrator, through `resolve_role` first so a breached cap
degrades the role *before* the call is made). Verified against
strands-agents 1.52.0: `AgentResult.metrics.accumulated_usage` is a
`Usage` TypedDict with `inputTokens` / `outputTokens` / `totalTokens`.
"""

import time
from datetime import datetime, timezone

from pydantic import BaseModel
from strands import Agent
from strands.agent.agent_result import AgentResult

from .context import current_run_id, current_user_id, next_event_seq
from .db import get_client
from .models import Role, get_model, pricing_per_million
from .retry import call_with_retry


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


def total_run_cost_usd(run_id: str) -> float:
    """Sum every token_ledger row for a run -- the orchestrator's own call
    *plus* every tool-invoked sub-call (extractor/writer). The orchestrator
    call alone understates real cost whenever tools call a model, which is
    every non-trivial run; this is what `agent_run.total_cost_usd` and the
    Run Trace view's per-run number must actually use."""
    res = get_client().table("token_ledger").select("cost_usd").eq("run_id", run_id).execute()
    rows = res.data or []
    return sum(float(r["cost_usd"]) for r in rows)


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
    silently degrades to the writer's smaller, cheaper model. Writes a
    `decision` agent_event when it degrades, so the guard firing is
    visible in the Run Trace rather than being a silent quality drop."""
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
                "degrading orchestrator reasoning to the smaller writer model."
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


class StructuredOutputError(RuntimeError):
    """The model didn't return output matching the requested schema."""


def _validated_structured_output(result: AgentResult, model_cls: type[BaseModel]) -> BaseModel:
    """Guarantee `result.structured_output` really is an instance of the
    requested schema.

    Strands does not always hand back a validated instance: an
    intermittent Groq `tool_use_failed` (the model emits a tool call that
    doesn't match the schema) surfaced here as an object whose supposedly
    `int` field held the string 'tool_use_failed', which then blew up far
    away in caller code as a baffling `int()` error. Every caller passing
    `structured_output_model` goes through this, so qualify_lead and
    extract_requirements get the same protection score_fit needed --
    and the failure now names what actually went wrong.
    """
    raw = result.structured_output
    if isinstance(raw, model_cls):
        return raw
    if isinstance(raw, dict):
        try:
            return model_cls.model_validate(raw)
        except Exception as exc:
            raise StructuredOutputError(
                f"model returned a dict that isn't a valid {model_cls.__name__}: {exc}"
            ) from exc
    if raw is None:
        raise StructuredOutputError(
            f"model returned no structured output for {model_cls.__name__} "
            "(usually a transient tool-call failure -- retrying is reasonable)"
        )
    # Last resort: something schema-shaped but unvalidated.
    try:
        return model_cls.model_validate(raw, from_attributes=True)
    except Exception as exc:
        raise StructuredOutputError(
            f"model returned {type(raw).__name__} that isn't a valid "
            f"{model_cls.__name__}: {exc}"
        ) from exc


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
    `get_model` / `Agent` directly inside a tool."""
    user_id = current_user_id()
    run_id = current_run_id()

    resolved_role = resolve_role(user_id, role, run_id=run_id)
    model = get_model(resolved_role)
    # callback_handler=None: this is a server-side call, not an interactive
    # CLI session -- streaming tokens to stdout by default both pollutes
    # server logs and crashes on non-UTF8 consoles (confirmed on Windows
    # cp1252 during Groq smoke-testing, Aug 18).
    agent = Agent(model=model, system_prompt=system_prompt, callback_handler=None)

    started = time.monotonic()
    result = call_with_retry(
        lambda: agent(prompt, structured_output_model=structured_output_model)
    )
    latency_ms = int((time.monotonic() - started) * 1000)
    # Record usage before validating: the tokens were spent whether or not
    # the model gave us something usable, and the ledger should say so.
    cost = record_usage(user_id=user_id, run_id=run_id, role=resolved_role, result=result)

    # Inside a run someone started with a button, put the call in the
    # trace. The orchestrator's hooks cover the runs it drives; nothing
    # covered these, which is why a whole onboarding -- twenty-odd model
    # calls -- used to leave the Run Trace empty.
    seq = next_event_seq()
    if run_id and seq is not None:
        from .audit import log_event
        from .models import current_model_id

        usage = result.metrics.accumulated_usage
        log_event(
            run_id=run_id,
            user_id=user_id,
            seq=seq,
            kind="model_call",
            tool_name=structured_output_model.__name__ if structured_output_model else None,
            rationale=f"{resolved_role.value} model · {current_model_id(resolved_role)}",
            latency_ms=latency_ms,
            input_tokens=int(usage.get("inputTokens", 0)),
            output_tokens=int(usage.get("outputTokens", 0)),
            cost_usd=cost,
        )

    if structured_output_model is not None:
        result.structured_output = _validated_structured_output(
            result, structured_output_model
        )
    return result
