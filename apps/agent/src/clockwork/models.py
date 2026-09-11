"""Model router.

One agent, three jobs, three different models -- because they are not the
same kind of work. Tool-choice reasoning has to hold a long transcript and
pick correctly; client-facing prose has to sound like a person; scoring
and extraction are cheap classification that runs dozens of times per
sync. Pricing them all at the orchestrator's rate would make the daily
spend cap meaningless.

Every call site goes through `Role`, never a model id: `ledger.invoke_model`
and `get_model` are the only two places a provider is named. That is what
makes the daily cap, the degrade path and the cost ledger possible at all
-- they all key off the role, not off whatever model happens to serve it.
"""

from enum import Enum

from strands.models.litellm import LiteLLMModel

from .config import settings


class Role(str, Enum):
    ORCHESTRATOR = "orchestrator"  # internal tool-choice reasoning
    WRITER = "writer"  # client-facing prose (pitches, quotes, replies, chases)
    EXTRACTOR = "extractor"  # classification / extraction / scoring


# Groq, via LiteLLM (`groq/<model>`). Free-tier limits are per-model, not
# per-org (30 RPM / 8,000 TPM / 1,000 RPD each -- confirmed against Groq's
# docs, Aug 18). ORCHESTRATOR alone measured ~7.5k tokens in a single real
# run -- putting WRITER on the same model would share that same 8k TPM
# pool and risk tipping it over on one run. Splitting them onto separate
# models gives each its own budget, which is why the writer and extractor
# sit on the 20b even where the 120b would answer slightly better.
MODEL_IDS = {
    Role.ORCHESTRATOR: "groq/openai/gpt-oss-120b",
    Role.WRITER: "groq/openai/gpt-oss-20b",
    Role.EXTRACTOR: "groq/openai/gpt-oss-20b",
}

# USD per million tokens: (input, output)
PRICING = {
    Role.ORCHESTRATOR: (0.15, 0.60),  # gpt-oss-120b
    Role.WRITER: (0.075, 0.30),  # gpt-oss-20b, own rate-limit pool
    Role.EXTRACTOR: (0.075, 0.30),  # gpt-oss-20b
}


def current_model_id(role: Role) -> str:
    """The model id actually in use for this role right now -- what callers
    record onto `token_ledger.model_id`, so the ledger stays correct if a
    role is ever re-pointed at a different model."""
    return MODEL_IDS[role]


def pricing_per_million(role: Role) -> tuple[float, float]:
    """Return (input, output) USD-per-million-tokens for a role."""
    return PRICING[role]


def get_model(role: Role, *, temperature: float = 0.3) -> LiteLLMModel:
    """Build a model for the given role. Callers should prefer going
    through `ledger.invoke_model` rather than using this directly, so the
    daily spend cap and the degrade path are always honoured."""
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY is not set in .env")
    return LiteLLMModel(
        model_id=MODEL_IDS[role],
        params={"temperature": temperature},
    )
