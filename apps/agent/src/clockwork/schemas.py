"""Pydantic structured-output models. Every extraction/scoring step in
Clockwork uses one of these via `structured_output_model=` -- no string
parsing, no hallucinated fields, anywhere in the codebase."""

from typing import Literal

from pydantic import BaseModel, Field


class LeadScore(BaseModel):
    """How well this inbound message matches the freelancer's practice."""

    intent: str = Field(description="One short phrase for what the client wants, e.g. 'Stripe subscription billing migration'")
    score: Literal["hot", "warm", "cold"]
    rationale: str = Field(description="One sentence, citing specifics from the message")
    estimated_value: float | None = Field(
        default=None, description="Rough deal value in USD, if inferable"
    )
    missing_info: list[str] = Field(
        default_factory=list, description="What must be asked before quoting"
    )


class FitScore(BaseModel):
    """How well a sourced opportunity matches this freelancer's practice."""

    score: int = Field(
        description="0-100. How well this matches the freelancer's skills, positioning and rate. "
        "Be harsh: 80+ means they should pitch today, under 30 means don't bother."
    )
    rationale: str = Field(
        description="One or two sentences. Cite specifics from BOTH the posting and the profile."
    )
    evidence: list[str] = Field(
        default_factory=list,
        description="Why they fit, each item starting with the id of the EVIDENCE entry it "
        "rests on, e.g. '[W1] Built a payment-recovery engine, the core of this role'. "
        "Only ids from the list; items without a valid id are discarded.",
    )
    concerns: list[str] = Field(
        default_factory=list,
        description="Reasons this might not suit them: wrong stack, likely full-time, rate mismatch.",
    )


class ExtractedRequirements(BaseModel):
    """What the client actually wants, pulled from the thread."""

    intent: str
    deliverables: list[str] = Field(default_factory=list)
    deadline: str | None = None
    budget_hint: str | None = None


class QuoteLineItem(BaseModel):
    """One priced line of a quote.

    Note there is no `amount` field. The model supplies quantity and unit
    price; the line total, the subtotal and the grand total are all
    computed in Python (see `tools/money.py`). Language models do
    arithmetic plausibly rather than correctly, and a quote that adds up
    wrong is worse than no quote at all -- it is the one document where
    being confidently off by a digit costs the freelancer real money and
    their credibility in the same email.
    """

    description: str = Field(
        description="What this line covers, in the client's terms, e.g. "
        "'Migrate subscription billing to Stripe Billing'"
    )
    quantity: float = Field(default=1, description="How many units. Use 1 for a fixed-price line.")
    unit: Literal["hour", "day", "week", "project"] = Field(
        default="project", description="What one unit is"
    )
    unit_price: float = Field(description="Price of a single unit, in the freelancer's currency")


class QuoteDraft(BaseModel):
    """A priced proposal, grounded in the thread and the profile's rates."""

    line_items: list[QuoteLineItem] = Field(
        description="Two to five lines. Break the work down so the client can see what "
        "they are paying for; do not hide everything behind one 'development' line."
    )
    timeline: str = Field(description="Realistic delivery timing, e.g. '3-4 weeks from kickoff'")
    assumptions: list[str] = Field(
        default_factory=list,
        description="What the price depends on being true -- access, decisions, "
        "third-party accounts. These are what protect the freelancer from scope creep.",
    )
    exclusions: list[str] = Field(
        default_factory=list,
        description="What this price explicitly does NOT cover, so it can be quoted separately later.",
    )
    covering_note: str = Field(
        description="Two or three sentences to the client that will sit above the priced "
        "lines. Reference what they actually asked for. No pleasantries, no restating "
        "the numbers -- the table below already does that."
    )
    rationale: str = Field(
        description="One or two sentences for the freelancer (not the client) on how this "
        "was priced, citing the profile's rates and what the thread actually asked for."
    )


class ImportedProfile(BaseModel):
    """What could be read out of a GitHub account, a portfolio site or a
    pasted CV. Everything here is a suggestion shown back to the person
    for confirmation -- nothing is saved without them seeing it.

    `highlights` is a flat list of strings rather than a list of objects
    on purpose. The extractor runs on the small model, and asked for
    nested objects it returned bare strings where objects were required
    and the whole call failed schema validation. A flat list it gets
    right every time; the title/summary split is done in Python, where it
    is deterministic and testable. Shape the schema to the model you
    actually have.
    """

    title: str | None = Field(
        default=None,
        description="A professional title, e.g. 'Backend developer'. Null if the "
        "material genuinely doesn't say.",
    )
    headline: str | None = Field(
        default=None,
        description="One line, under 160 characters, on what they do and who for. "
        "Plain language, no marketing voice.",
    )
    skills: list[str] = Field(
        default_factory=list,
        description="Concrete technologies and disciplines actually evidenced. "
        "No soft skills, no 'team player'. At most 12.",
    )
    highlights: list[str] = Field(
        default_factory=list,
        description="At most 4 past results, strongest first. Each ONE string in the "
        "form '[GitHub] Short name — what it was and what it achieved' (or [Portfolio]). "
        "Keep any real number exactly as written. Only things the material actually "
        "shows; an empty list is a correct answer.",
    )
