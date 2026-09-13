"""`draft_pitch` -- turning a sourced opportunity into outbound contact.

This closes `Source → Pitch` in the spine. Everything before it (fetch,
score) is read-only research; this is the first thing that would put
words in front of a stranger under the freelancer's name, so it goes
through the same approval gate as every other client-facing action.
Nothing here sends.

The whole point is that the pitch is *grounded*: it quotes the specific
portfolio case study that earned the fit score, in the freelancer's own
voice, answering what the posting actually asked for. A generic "I'd
love to help with your project" is worse than useless -- it's the thing
every recipient already deletes.
"""

from strands import tool

from ..context import current_user_id
from ..db import get_client
from ..greeting import apply_greeting, greeting_instruction
from ..ledger import invoke_model
from ..models import Role
from ..sources.checking import is_dead
from .approvals import create_approval
from .scheduling import write_task

# Same reasoning as the fit scorer's cap: the ask is near the top of a
# posting, and the writer model shares a per-minute token budget.
MAX_BODY_CHARS = 1200


def _load_profile(user_id: str) -> dict | None:
    res = (
        get_client().table("profile").select("*").eq("user_id", user_id).maybe_single().execute()
    )
    return res.data if res else None


def draft_pitch_for(opportunity_id: str) -> dict:
    """Draft an outbound pitch for one opportunity and queue it for
    approval. Returns the approval id and the drafted text."""
    user_id = current_user_id()
    client = get_client()

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

    # The guard that makes link verification worth having. Writing to a
    # role that was filled three weeks ago wastes the freelancer's time
    # and is visibly sloppy to the one person they were trying to
    # impress -- so it is refused here rather than left to whoever reads
    # the approval card to notice.
    if is_dead(opp.get("link_status")):
        raise ValueError(
            f"this posting is {opp['link_status']} — {opp.get('link_note') or 'the link no longer resolves'}. "
            "Pitching a role that has already closed is worse than not pitching at all."
        )

    profile = _load_profile(user_id)
    if not profile:
        raise ValueError(
            "No profile yet -- a pitch has to be written in your voice and cite your "
            "own work, so there is nothing to ground it in."
        )

    evidence = (opp.get("fit_evidence") or {}).get("evidence") or []
    voice_samples = profile.get("voice_samples") or []

    result = invoke_model(
        Role.WRITER,
        (
            "FREELANCER\n"
            f"Name: {profile.get('name')}\n"
            f"Title: {profile.get('title') or 'not stated'}\n"
            f"Skills: {', '.join(profile.get('skills') or []) or 'none listed'}\n"
            f"Overview: {profile.get('positioning') or 'none given'}\n"
            f"Available: {profile.get('availability_hours') or 'unstated'} hours a week\n"
            f"Portfolio: {profile.get('portfolio') or []}\n"
            f"Rates: {profile.get('rates') or {}}\n\n"
            "HOW THEY WRITE (match this tone, do not copy the content):\n"
            + ("\n---\n".join(voice_samples[:2]) if voice_samples else "(no samples given)")
            + "\n\nTHE OPPORTUNITY\n"
            f"Title: {opp.get('title')}\n"
            # Labelled for what it is. A board's "author" is a username or
            # a company, and handed over as "Posted by" it got greeted as
            # a person: "Hi NOPE,".
            f"Posted by (a username or company, not a name to greet): {opp.get('author')}\n"
            f"Body:\n{(opp.get('body') or '')[:MAX_BODY_CHARS]}\n\n"
            "WHY THIS WAS FLAGGED AS A MATCH\n"
            + ("\n".join(f"- {e}" for e in evidence) if evidence else "- (not scored yet)")
            + "\n\nWrite the outbound message."
        ),
        system_prompt=(
            "You write short cold outreach for a freelancer replying to a job or "
            "contract posting. Rules: open by naming the specific thing they asked "
            "for, cite ONE concrete result from the freelancer's own portfolio "
            "(with its number if there is one), and close with a single low-friction "
            "question. Under 150 words. No 'I hope this finds you well', no listing "
            "every skill they have, no inventing experience that isn't in the "
            "profile. If the portfolio has nothing genuinely relevant, say plainly "
            "what they would bring instead of stretching.\n\n"
            # Never by name. No board supplies a person's name: Hacker News
            # gives a username, Remotive and RemoteOK give a company, and
            # "Acme Labs" is shaped exactly like a person.
            f"{greeting_instruction(None)}"
        ),
    )
    body = apply_greeting(str(result), None)

    approval_id = create_approval(
        action_type="send_pitch",
        risk="medium",
        payload={
            "opportunity_id": opportunity_id,
            "body": body,
            "opportunity_title": opp.get("title"),
            "opportunity_url": opp.get("url"),
        },
        rationale=(
            f"Fit score {opp.get('fit_score')}/100. {opp.get('fit_rationale') or ''}".strip()
        ),
        # An opportunity's citation is the posting itself -- there is no
        # thread to point at yet, which is exactly what makes this
        # outbound rather than a reply.
        citations=[opp.get("url") or opportunity_id],
        state_diff={
            "opportunity_id": opportunity_id,
            "status": "scored -> pitched",
            "outbound_pitch": True,
        },
    )

    client.table("opportunity").update({"status": "pitched", "updated_at": "now()"}).eq(
        "id", opportunity_id
    ).eq("user_id", user_id).execute()

    # Same reasoning as draft_reply's automatic follow-up: this run fires
    # once, and a pitch nobody answers is the most common way freelance
    # outreach dies. Guaranteed in code, not left to model judgement.
    write_task(
        kind="follow_up",
        subject_type="opportunity",
        subject_id=opportunity_id,
        due_in_days=4,
        reason=(
            "An outbound pitch was drafted for this opportunity; check whether it was "
            "approved and whether anyone replied before nudging again."
        ),
    )

    return {"approval_id": approval_id, "opportunity_id": opportunity_id, "body": body}


@tool
def draft_pitch(opportunity_id: str) -> dict:
    """Draft outbound outreach for a sourced opportunity, in the
    freelancer's voice and citing their real portfolio, and queue it for
    approval. Does NOT send anything.

    Args:
        opportunity_id: The sourced opportunity to pitch for.
    """
    try:
        return {"status": "success", "content": [{"json": draft_pitch_for(opportunity_id)}]}
    except ValueError as exc:
        return {"status": "error", "content": [{"text": str(exc)}]}
