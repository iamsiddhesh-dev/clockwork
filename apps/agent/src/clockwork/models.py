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
from typing import TYPE_CHECKING

from .config import settings

if TYPE_CHECKING:  # pragma: no cover - for type checkers only
    from strands.models.litellm import LiteLLMModel


class Role(str, Enum):
    ORCHESTRATOR = "orchestrator"  # internal tool-choice reasoning
    WRITER = "writer"  # client-facing prose (pitches, quotes, replies, chases)
    EXTRACTOR = "extractor"  # classification / extraction / scoring
    # Reading a freelancer's GitHub and portfolio, once, at setup. Not the
    # extractor, on purpose: that read is the largest single call in the
    # product (~4.7k tokens) and it happens seconds before onboarding scores
    # a batch of leads. On the same model it spent the scorer's per-minute
    # budget, and eight of ten scores failed on rate limits. On the 120b it
    # draws on its own budget -- and a one-off read of someone's work is
    # the call that most deserves the better model anyway.
    READER = "reader"


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
    Role.READER: "groq/openai/gpt-oss-120b",
}

# USD per million tokens: (input, output)
PRICING = {
    Role.ORCHESTRATOR: (0.15, 0.60),  # gpt-oss-120b
    Role.WRITER: (0.075, 0.30),  # gpt-oss-20b, own rate-limit pool
    Role.EXTRACTOR: (0.075, 0.30),  # gpt-oss-20b
    Role.READER: (0.15, 0.60),  # gpt-oss-120b
}

# How much hidden reasoning each role spends before answering. gpt-oss
# reasons before it replies, and Groq counts those tokens against the same
# per-minute budget as the answer. Measured on a fit score: ~1,100 output
# tokens at the default against ~250 at "low", with the same verdict --
# scoring is classification against a list, not open-ended thinking. The
# writer keeps the default, because a pitch is read by a person.
REASONING_EFFORT = {
    Role.EXTRACTOR: "low",
}


def current_model_id(role: Role) -> str:
    """The model id actually in use for this role right now -- what callers
    record onto `token_ledger.model_id`, so the ledger stays correct if a
    role is ever re-pointed at a different model."""
    return MODEL_IDS[role]


def pricing_per_million(role: Role) -> tuple[float, float]:
    """Return (input, output) USD-per-million-tokens for a role."""
    return PRICING[role]


def get_model(role: Role, *, temperature: float = 0.3) -> "LiteLLMModel":
    """Build a model for the given role. Callers should prefer going
    through `ledger.invoke_model` rather than using this directly, so the
    daily spend cap and the degrade path are always honoured."""
    if not settings.groq_api_key:
        raise RuntimeError("GROQ_API_KEY is not set in .env")
    # Imported here, not at the top of the module. LiteLLM takes about
    # twelve seconds to import, and importing it at module level meant
    # every cold start of the API paid that before answering anything --
    # including the dashboard, which never calls a model. On Vercel that
    # was long enough for the first visitor after a quiet spell to get
    # "Can't reach the agent". Now only a request that genuinely calls a
    # model pays it, once per instance.
    from strands.models.litellm import LiteLLMModel

    params: dict = {"temperature": temperature}
    if role in REASONING_EFFORT:
        params["reasoning_effort"] = REASONING_EFFORT[role]
    return LiteLLMModel(model_id=MODEL_IDS[role], params=params)
