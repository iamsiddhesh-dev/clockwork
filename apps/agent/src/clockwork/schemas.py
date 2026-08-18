"""Pydantic structured-output models. Every extraction/scoring step in
Clockwork uses one of these via `structured_output_model=` -- no string
parsing, no hallucinated fields, anywhere in the codebase."""

from typing import Literal

from pydantic import BaseModel, Field


class LeadScore(BaseModel):
    """How well this inbound message matches the freelancer's practice."""

    score: Literal["hot", "warm", "cold"]
    rationale: str = Field(description="One sentence, citing specifics from the message")
    estimated_value: float | None = Field(
        default=None, description="Rough deal value in USD, if inferable"
    )
    missing_info: list[str] = Field(
        default_factory=list, description="What must be asked before quoting"
    )


class ExtractedRequirements(BaseModel):
    """What the client actually wants, pulled from the thread."""

    intent: str
    deliverables: list[str] = Field(default_factory=list)
    deadline: str | None = None
    budget_hint: str | None = None
