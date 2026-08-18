"""Bedrock model router.

Routing is a deliberate design constraint, not just cost optimization:
Anthropic began embedding an invisible statistical watermark in Claude
outputs (Aug 2026, EU AI Act Article 50 compliance). Any text a client
reads must never touch Claude -- only internal reasoning does. See
PLAN.md's model routing table for the full rationale.
"""

from datetime import date, datetime, timezone
from enum import Enum

from strands.models import BedrockModel

from .config import settings


class Role(str, Enum):
    ORCHESTRATOR = "orchestrator"  # internal tool-choice reasoning ONLY -- never client-visible
    WRITER = "writer"  # client-facing prose (pitches, quotes, replies, chases)
    EXTRACTOR = "extractor"  # classification / extraction / scoring


# The date Claude Sonnet 5's Bedrock price stepped up mid-build.
_SONNET_STEP_UP = date(2026, 9, 1)

MODEL_IDS = {
    Role.ORCHESTRATOR: "global.anthropic.claude-sonnet-5",
    Role.WRITER: "amazon.nova-pro-v1:0",
    Role.EXTRACTOR: "amazon.nova-lite-v1:0",
}

# USD per million tokens: (input, output)
_STATIC_PRICING = {
    Role.EXTRACTOR: (0.06, 0.24),
    Role.WRITER: (0.80, 3.20),
}


def _orchestrator_pricing(today: date | None = None) -> tuple[float, float]:
    today = today or datetime.now(timezone.utc).date()
    return (3.00, 15.00) if today >= _SONNET_STEP_UP else (2.00, 10.00)


def pricing_per_million(role: Role, today: date | None = None) -> tuple[float, float]:
    """Return (input, output) USD-per-million-tokens for a role, as of `today`."""
    if role is Role.ORCHESTRATOR:
        return _orchestrator_pricing(today)
    return _STATIC_PRICING[role]


def get_model(role: Role, *, temperature: float = 0.3) -> BedrockModel:
    """Build a BedrockModel for the given role. Callers should prefer going
    through `ledger.call_with_budget` rather than using this directly, so
    the daily spend cap and degrade-to-Nova path are always honoured."""
    return BedrockModel(
        model_id=MODEL_IDS[role],
        region_name=settings.aws_region,
        temperature=temperature,
    )
