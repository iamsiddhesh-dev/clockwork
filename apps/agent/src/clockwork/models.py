"""Model router.

Bedrock is the real target -- routing is a deliberate design constraint,
not just cost optimization: Anthropic began embedding an invisible
statistical watermark in Claude outputs (Aug 2026, EU AI Act Article 50
compliance). Any text a client reads must never touch Claude -- only
internal reasoning does. See PLAN.md's model routing table for the full
rationale.

`settings.model_provider` is a dev-time-only escape hatch: Bedrock is
under an account-level hold (confirmed Aug 18 -- every model, including
Nova, returns `ValidationException: Operation not allowed` from both the
API and the console Playground, so it isn't fixable from this side; it's
AWS's manual review queue). Until that clears, "groq" swaps every role to
a Groq-hosted model behind the exact same `Role` interface and the exact
same call sites (`ledger.invoke_model`, `get_model`) -- swapping back is
changing `MODEL_PROVIDER` in `.env`, nothing else.
"""

from datetime import date, datetime, timezone
from enum import Enum

from strands.models import BedrockModel
from strands.models.litellm import LiteLLMModel

from .config import settings


class Role(str, Enum):
    ORCHESTRATOR = "orchestrator"  # internal tool-choice reasoning ONLY -- never client-visible
    WRITER = "writer"  # client-facing prose (pitches, quotes, replies, chases)
    EXTRACTOR = "extractor"  # classification / extraction / scoring


# The date Claude Sonnet 5's Bedrock price stepped up mid-build.
_SONNET_STEP_UP = date(2026, 9, 1)

BEDROCK_MODEL_IDS = {
    Role.ORCHESTRATOR: "global.anthropic.claude-sonnet-5",
    Role.WRITER: "amazon.nova-pro-v1:0",
    Role.EXTRACTOR: "amazon.nova-lite-v1:0",
}

# Groq, via LiteLLM (`groq/<model>`). Free-tier limits are per-model, not
# per-org (30 RPM / 8,000 TPM / 1,000 RPD each -- confirmed against Groq's
# docs, Aug 18). ORCHESTRATOR alone measured ~7.5k tokens in a single real
# run -- putting WRITER on the same model would share that same 8k TPM
# pool and risk tipping it over on one run. Splitting them onto separate
# models gives each its own budget. Dev stand-in only -- never the writer
# role's final home, see module docstring; watermark-avoidance is a
# Bedrock/Nova property, not something Groq needs to satisfy.
GROQ_MODEL_IDS = {
    Role.ORCHESTRATOR: "groq/openai/gpt-oss-120b",
    Role.WRITER: "groq/openai/gpt-oss-20b",
    Role.EXTRACTOR: "groq/openai/gpt-oss-20b",
}

# USD per million tokens: (input, output)
_BEDROCK_STATIC_PRICING = {
    Role.EXTRACTOR: (0.06, 0.24),
    Role.WRITER: (0.80, 3.20),
}
_GROQ_PRICING = {
    Role.ORCHESTRATOR: (0.15, 0.60),  # gpt-oss-120b
    Role.WRITER: (0.075, 0.30),  # gpt-oss-20b, own rate-limit pool from ORCHESTRATOR
    Role.EXTRACTOR: (0.075, 0.30),  # gpt-oss-20b
}


def _bedrock_orchestrator_pricing(today: date | None = None) -> tuple[float, float]:
    today = today or datetime.now(timezone.utc).date()
    return (3.00, 15.00) if today >= _SONNET_STEP_UP else (2.00, 10.00)


def current_model_id(role: Role) -> str:
    """The model id actually in use for this role right now, honouring
    `settings.model_provider` -- what callers should record onto
    `token_ledger.model_id` rather than assuming Bedrock's ids."""
    ids = GROQ_MODEL_IDS if settings.model_provider == "groq" else BEDROCK_MODEL_IDS
    return ids[role]


def pricing_per_million(role: Role, today: date | None = None) -> tuple[float, float]:
    """Return (input, output) USD-per-million-tokens for a role, as of `today`."""
    if settings.model_provider == "groq":
        return _GROQ_PRICING[role]
    if role is Role.ORCHESTRATOR:
        return _bedrock_orchestrator_pricing(today)
    return _BEDROCK_STATIC_PRICING[role]


def get_model(role: Role, *, temperature: float = 0.3) -> BedrockModel | LiteLLMModel:
    """Build a model for the given role, honouring `settings.model_provider`.
    Callers should prefer going through `ledger.invoke_model` rather than
    using this directly, so the daily spend cap and degrade-to-Nova path
    are always honoured."""
    if settings.model_provider == "groq":
        if not settings.groq_api_key:
            raise RuntimeError(
                "MODEL_PROVIDER=groq but GROQ_API_KEY is not set in .env"
            )
        return LiteLLMModel(
            model_id=GROQ_MODEL_IDS[role],
            params={"temperature": temperature},
        )

    return BedrockModel(
        model_id=BEDROCK_MODEL_IDS[role],
        region_name=settings.aws_region,
        temperature=temperature,
    )
