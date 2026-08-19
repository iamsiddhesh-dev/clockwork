"""Tools batch A -- the six tools needed for the Phase 1 checkpoint loop:
a message arrives -> deal created, scored, reply drafted -> appears in the
Approval Inbox. All hit real Postgres (via Supabase); no mocked data.
"""

from strands import tool

from ..context import current_run_id, current_user_id
from ..db import get_client
from ..ledger import invoke_model
from ..models import Role
from ..schemas import ExtractedRequirements, LeadScore
from .approvals import create_approval
from .scheduling import write_task


@tool
def recall(query: str) -> dict:
    """Recall context relevant to the current work: the freelancer's
    profile (skills, rates, positioning, portfolio) plus their past won
    and lost deals. Use this before drafting anything client-facing, so
    the agent grounds itself in the freelancer's real practice rather
    than generic advice.

    Args:
        query: What you're trying to find context for, e.g. "React
            contract work" or "past clients in fintech".
    """
    user_id = current_user_id()
    client = get_client()

    profile_res = (
        client.table("profile").select("*").eq("user_id", user_id).maybe_single().execute()
    )
    deals_res = (
        client.table("deal")
        .select("id, intent, stage, estimated_value")
        .eq("user_id", user_id)
        .in_("stage", ["won", "lost"])
        .execute()
    )

    return {
        "status": "success",
        "content": [
            {
                "json": {
                    "profile": profile_res.data if profile_res else None,
                    "past_deals": deals_res.data or [],
                    "query": query,
                }
            }
        ],
    }


@tool
def get_thread(thread_id: str) -> dict:
    """Fetch a conversation thread's full message history, oldest first.

    Args:
        thread_id: The thread's id.
    """
    user_id = current_user_id()
    client = get_client()

    thread_res = (
        client.table("thread")
        .select("*")
        .eq("id", thread_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    messages_res = (
        client.table("message")
        .select("*")
        .eq("thread_id", thread_id)
        .eq("user_id", user_id)
        .order("sent_at")
        .execute()
    )

    return {
        "status": "success",
        "content": [
            {
                "json": {
                    "thread": thread_res.data if thread_res else None,
                    "messages": messages_res.data or [],
                }
            }
        ],
    }


@tool
def log_message(thread_id: str, direction: str, body: str) -> dict:
    """Append a message to a thread and bump its last_message_at.

    Args:
        thread_id: The thread to append to.
        direction: Either "inbound" (from the client) or "outbound" (to
            the client).
        body: The message text.
    """
    if direction not in ("inbound", "outbound"):
        return {
            "status": "error",
            "content": [{"text": "direction must be 'inbound' or 'outbound'"}],
        }

    user_id = current_user_id()
    client = get_client()

    inserted = (
        client.table("message")
        .insert({"thread_id": thread_id, "user_id": user_id, "direction": direction, "body": body})
        .execute()
    )
    client.table("thread").update({"last_message_at": "now()"}).eq("id", thread_id).eq(
        "user_id", user_id
    ).execute()

    return {"status": "success", "content": [{"json": inserted.data[0]}]}


@tool
def extract_requirements(thread_id: str) -> dict:
    """Extract structured requirements (intent, deliverables, deadline,
    budget hint) from a thread's messages. Cheap classification -- runs
    on Amazon Nova Lite, never client-visible.

    Args:
        thread_id: The thread to extract requirements from.
    """
    thread = get_thread(thread_id)
    messages = thread["content"][0]["json"]["messages"]
    transcript = "\n".join(f"[{m['direction']}] {m['body']}" for m in messages)

    result = invoke_model(
        Role.EXTRACTOR,
        f"Extract the client's requirements from this conversation:\n\n{transcript}",
        structured_output_model=ExtractedRequirements,
        system_prompt="You extract structured requirements from freelance client conversations.",
    )
    extracted: ExtractedRequirements = result.structured_output

    return {"status": "success", "content": [{"json": extracted.model_dump()}]}


@tool
def qualify_lead(deal_id: str) -> dict:
    """Score a deal hot/warm/cold with a one-sentence rationale citing the
    actual conversation, and write the score onto the deal. Cheap
    classification -- runs on Amazon Nova Lite, never client-visible.

    Args:
        deal_id: The deal to qualify.
    """
    user_id = current_user_id()
    client = get_client()

    deal_res = (
        client.table("deal").select("*").eq("id", deal_id).eq("user_id", user_id).maybe_single().execute()
    )
    if not deal_res or not deal_res.data:
        return {"status": "error", "content": [{"text": f"deal {deal_id} not found"}]}
    deal = deal_res.data

    thread = get_thread(deal["thread_id"])
    messages = thread["content"][0]["json"]["messages"]
    transcript = "\n".join(f"[{m['direction']}] {m['body']}" for m in messages)

    result = invoke_model(
        Role.EXTRACTOR,
        f"Score this inbound lead for a freelancer:\n\n{transcript}",
        structured_output_model=LeadScore,
        system_prompt="You score inbound freelance leads as hot, warm, or cold.",
    )
    score: LeadScore = result.structured_output

    client.table("deal").update(
        {
            "score": score.score,
            "score_rationale": score.rationale,
            "estimated_value": score.estimated_value,
            "stage": "qualified" if deal["stage"] == "new" else deal["stage"],
        }
    ).eq("id", deal_id).eq("user_id", user_id).execute()

    return {"status": "success", "content": [{"json": score.model_dump()}]}


@tool
def draft_reply(thread_id: str) -> dict:
    """Draft a reply to the client, grounded in the freelancer's profile
    and voice, and queue it for approval. Client-facing prose -- runs on
    Amazon Nova Pro, kept off Claude entirely (no Anthropic watermark
    exposure on outbound content). Does NOT send anything itself.

    Also schedules a follow-up check-in a few days out, in case the
    client goes quiet -- guaranteed, not left to the orchestrator's
    judgement, since a run only fires once and there's nothing else that
    would remember to look again later.

    Args:
        thread_id: The conversation to reply within.
    """
    thread = get_thread(thread_id)
    messages = thread["content"][0]["json"]["messages"]
    transcript = "\n".join(f"[{m['direction']}] {m['body']}" for m in messages)

    context = recall(f"drafting a reply for thread {thread_id}")
    profile = context["content"][0]["json"]["profile"] or {}

    result = invoke_model(
        Role.WRITER,
        (
            f"Freelancer profile: {profile}\n\n"
            f"Conversation so far:\n{transcript}\n\n"
            "Draft the freelancer's next reply. Match their voice, be specific, "
            "and only ask for what's genuinely missing before quoting."
        ),
        system_prompt=(
            "You write freelance client replies in the freelancer's own voice, "
            "grounded in their real profile and portfolio. Never invent facts "
            "about the freelancer that aren't in the profile."
        ),
    )
    body = str(result)

    citations = [m["id"] for m in messages]
    approval_id = create_approval(
        action_type="send_email",
        risk="medium",
        payload={"thread_id": thread_id, "body": body},
        rationale=f"Drafted reply to move thread {thread_id} forward, grounded in profile + conversation history.",
        citations=citations,
        state_diff={"thread_id": thread_id, "new_outbound_message": True},
    )

    task_id = write_task(
        kind="follow_up",
        subject_type="thread",
        subject_id=thread_id,
        due_in_days=3,
        reason=(
            "A reply was drafted for this thread; check whether the client "
            "responded before nudging -- if the reply was never approved or "
            "sent, or the client already replied, no action is needed."
        ),
    )

    return {
        "status": "success",
        "content": [
            {"json": {"approval_id": approval_id, "queued": True, "body": body, "follow_up_task_id": task_id}}
        ],
    }
