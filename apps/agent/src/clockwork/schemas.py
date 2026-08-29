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
        description="Concrete facts from the freelancer's own profile that justify the score "
        "-- named skills or portfolio case studies, not vague praise.",
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
