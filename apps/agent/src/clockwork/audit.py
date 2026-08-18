"""Hooks into the audit trail -- every tool call an agent makes is written
to `agent_event`. This one class powers the Run Trace view, the per-run
cost number, and most of Technical Implementation. Not optional plumbing.

Verified strands-agents 1.52.0 hook API:
    from strands.hooks import (
        HookProvider, HookRegistry,
        BeforeToolCallEvent, AfterToolCallEvent,
        BeforeInvocationEvent, AfterInvocationEvent,
    )
Attach with `Agent(hooks=[AuditTrail(run_id, user_id)])`.
"""

import time

from strands.hooks import (
    AfterInvocationEvent,
    AfterToolCallEvent,
    BeforeToolCallEvent,
    HookProvider,
    HookRegistry,
)

from .db import get_client


def log_event(
    *,
    run_id: str,
    user_id: str,
    kind: str,
    seq: int = 0,
    tool_name: str | None = None,
    payload: dict | None = None,
    rationale: str | None = None,
    latency_ms: int | None = None,
    input_tokens: int | None = None,
    output_tokens: int | None = None,
    cost_usd: float | None = None,
) -> None:
    get_client().table("agent_event").insert(
        {
            "run_id": run_id,
            "user_id": user_id,
            "seq": seq,
            "kind": kind,
            "tool_name": tool_name,
            "payload": payload or {},
            "rationale": rationale,
            "latency_ms": latency_ms,
            "input_tokens": input_tokens,
            "output_tokens": output_tokens,
            "cost_usd": cost_usd,
        }
    ).execute()


class AuditTrail(HookProvider):
    """Writes every tool call this agent makes to `agent_event`, in order."""

    def __init__(self, run_id: str, user_id: str):
        self.run_id = run_id
        self.user_id = user_id
        self.seq = 0
        self._tool_started_at: dict[str, float] = {}

    def register_hooks(self, registry: HookRegistry) -> None:
        registry.add_callback(BeforeToolCallEvent, self.on_tool_start)
        registry.add_callback(AfterToolCallEvent, self.on_tool_end)
        registry.add_callback(AfterInvocationEvent, self.on_done)

    def _next_seq(self) -> int:
        self.seq += 1
        return self.seq

    def on_tool_start(self, event: BeforeToolCallEvent) -> None:
        tool_use = event.tool_use
        tool_use_id = tool_use.get("toolUseId", "")
        self._tool_started_at[tool_use_id] = time.time()

        log_event(
            run_id=self.run_id,
            user_id=self.user_id,
            seq=self._next_seq(),
            kind="tool_call",
            tool_name=tool_use.get("name"),
            payload={"input": tool_use.get("input", {})},
        )

    def on_tool_end(self, event: AfterToolCallEvent) -> None:
        tool_use = event.tool_use
        tool_use_id = tool_use.get("toolUseId", "")
        started_at = self._tool_started_at.pop(tool_use_id, None)
        latency_ms = int((time.time() - started_at) * 1000) if started_at else None

        log_event(
            run_id=self.run_id,
            user_id=self.user_id,
            seq=self._next_seq(),
            kind="tool_result",
            tool_name=tool_use.get("name"),
            payload={"result": getattr(event, "result", None)},
            latency_ms=latency_ms,
        )

    def on_done(self, event: AfterInvocationEvent) -> None:
        log_event(
            run_id=self.run_id,
            user_id=self.user_id,
            seq=self._next_seq(),
            kind="decision",
            rationale="Agent invocation completed.",
        )
