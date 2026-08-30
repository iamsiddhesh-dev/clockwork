"""Fit scoring for sourced opportunities.

`score_opportunity` is the plain function (the API scores batches with
it); `score_fit` is the `@tool` wrapper so the orchestrator can also
score one on its own initiative. Same code path either way -- the
approval gate / audit trail story doesn't change based on who called it.

Scoring is *grounded in the real profile*, which is why the Profile
screen isn't optional decoration: with no skills, positioning or
portfolio there is nothing to measure a posting against, and this
returns a hard failure rather than inventing a plausible number.
"""

import time

from strands import tool

from ..context import current_user_id
from ..db import get_client
from ..ledger import invoke_model
from ..models import Role
from ..schemas import FitScore

# Postings run long (a full job description). The signal for "does this
# suit me" -- role, stack, contract-vs-salaried -- is near the top, and
# the extractor is on an 8k TPM budget (see models.py's note on the Groq
# rate-limit split). Measured: at 1500 chars a batch of 8 lost 2 to rate
# limiting; trimming buys roughly a third more scores per minute at no
# observed cost to score quality.
MAX_BODY_CHARS = 900

# Groq's free tier allows ~8k tokens/min on the extractor model and each
# score costs roughly 600-800. Firing a batch flat out reliably tripped
# the limit partway through; pacing trades a slower batch for one that
# actually finishes.
SECONDS_BETWEEN_SCORES = 5.0


class ProfileMissingError(RuntimeError):
    pass


def _load_profile(user_id: str) -> dict:
    res = (
        get_client().table("profile").select("*").eq("user_id", user_id).maybe_single().execute()
    )
    if not res or not res.data:
        raise ProfileMissingError(
            "No profile yet. Fit scoring compares a posting against your skills, "
            "positioning and portfolio -- fill in your profile first."
        )
    return res.data


def score_opportunity(opportunity_id: str, *, profile: dict | None = None) -> dict:
    """Score one opportunity against the freelancer's profile and persist
    the result. Returns the stored row's scoring fields."""
    user_id = current_user_id()
    client = get_client()
    profile = profile or _load_profile(user_id)

    opp_res = (
        client.table("opportunity")
        .select("*")
        .eq("id", opportunity_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not opp_res or not opp_res.data:
        raise ValueError(f"opportunity {opportunity_id} not found")
    opp = opp_res.data

    result = invoke_model(
        Role.EXTRACTOR,
        (
            "FREELANCER PROFILE\n"
            f"Name: {profile.get('name')}\n"
            f"Skills: {', '.join(profile.get('skills') or []) or 'none listed'}\n"
            f"Positioning: {profile.get('positioning') or 'none given'}\n"
            f"Rates: {profile.get('rates') or {}}\n"
            f"Portfolio: {profile.get('portfolio') or []}\n\n"
            "OPPORTUNITY\n"
            f"Title: {opp.get('title')}\n"
            f"Posted by: {opp.get('author')}\n"
            f"Body:\n{(opp.get('body') or '')[:MAX_BODY_CHARS]}\n\n"
            "Score how well this opportunity fits this specific freelancer."
        ),
        structured_output_model=FitScore,
        system_prompt=(
            "You score freelance opportunities for fit against one freelancer's real "
            "profile. Be sceptical and specific. A posting for a full-time salaried "
            "role, or one needing a stack they don't list, scores low no matter how "
            "attractive it sounds. Only cite evidence that actually appears in their "
            "profile -- never invent experience they haven't claimed."
        ),
    )
    fit: FitScore = result.structured_output

    score = max(0, min(100, int(fit.score)))
    client.table("opportunity").update(
        {
            "fit_score": score,
            "fit_rationale": fit.rationale,
            "fit_evidence": {"evidence": fit.evidence, "concerns": fit.concerns},
            "status": "scored",
            "updated_at": "now()",
        }
    ).eq("id", opportunity_id).eq("user_id", user_id).execute()

    return {
        "opportunity_id": opportunity_id,
        "fit_score": score,
        "rationale": fit.rationale,
        "evidence": fit.evidence,
        "concerns": fit.concerns,
    }


def score_unscored(limit: int = 10) -> dict:
    """Score up to `limit` not-yet-scored opportunities.

    Batched deliberately rather than scoring everything at once: each
    score is a model call, and a full sync yields ~40 candidates, which
    would sit well past the extractor's per-minute token budget. Scoring
    the newest slice keeps the screen responsive and is resumable --
    press the button again for the next batch.
    """
    user_id = current_user_id()
    profile = _load_profile(user_id)

    pending = (
        get_client()
        .table("opportunity")
        .select("id")
        .eq("user_id", user_id)
        .is_("fit_score", "null")
        .neq("status", "dismissed")
        .order("posted_at", desc=True, nullsfirst=False)
        .limit(limit)
        .execute()
    )

    rows = pending.data or []
    scored, failed = [], []
    for i, row in enumerate(rows):
        if i:
            time.sleep(SECONDS_BETWEEN_SCORES)
        try:
            scored.append(score_opportunity(row["id"], profile=profile))
        except Exception as exc:
            # Usually a rate limit or a transient malformed tool call --
            # record and keep going so a partial batch still lands rather
            # than losing the whole run.
            failed.append({"opportunity_id": row["id"], "error": str(exc)[:200]})

    return {"scored": len(scored), "failed": len(failed), "results": scored, "errors": failed}


@tool
def score_fit(opportunity_id: str) -> dict:
    """Score how well a sourced opportunity fits the freelancer, using
    their real profile (skills, positioning, rates, portfolio). Writes the
    score, a rationale, and the supporting evidence onto the opportunity.

    Args:
        opportunity_id: The opportunity to score.
    """
    try:
        return {"status": "success", "content": [{"json": score_opportunity(opportunity_id)}]}
    except (ProfileMissingError, ValueError) as exc:
        return {"status": "error", "content": [{"text": str(exc)}]}
