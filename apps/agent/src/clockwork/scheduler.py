"""tick() -- the scheduler's worker loop.

Drains due tasks and fires `run_agent(trigger="schedule")` for each --
there is no separate code path for a scheduled run versus an inbound
message, per `run_agent()`'s own single-entry-point contract. The
orchestrator gets a prompt describing *why* the task exists and decides
what (if anything) to do using its normal tools; a scheduled run that
decides to nudge a client still goes through `draft_reply` and the
approval gate like any other run.

Two callers:
  - `tick(user_id)` -- called right after `/clock/advance`, so the demo
    control shows results for that workspace immediately.
  - `tick_all_due()` -- called on a background poll (see api.py's
    lifespan) so real-time firing works without anyone touching the
    virtual clock at all.
"""

from datetime import datetime

from .agent import Trigger, run_agent
from .clock import now as clock_now
from .db import get_client
# Shared with the retry helper on purpose: both need to see through
# Strands' EventLoopException wrapper, and two copies of that logic is
# exactly how one of them silently rots.
from .retry import root_rate_limit_error

# How many times a task gets requeued after a rate-limit failure before
# giving up for good. Deliberately not unbounded -- if it's still hitting
# 429s after this many tries, something structural is wrong (not just a
# transient TPM blip), and it should surface as `failed` rather than
# retry forever.
MAX_TASK_ATTEMPTS = 5


def _thread_for_quote(quote_id: str, user_id: str) -> str | None:
    """A quote points at a deal, and the conversation lives on the deal's
    thread. Resolved here rather than carried on the task payload so a
    task written before the deal moved still finds the right thread."""
    client = get_client()
    quote = (
        client.table("quote")
        .select("deal_id")
        .eq("id", quote_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not quote or not quote.data:
        return None
    deal = (
        client.table("deal")
        .select("thread_id")
        .eq("id", quote.data["deal_id"])
        .maybe_single()
        .execute()
    )
    return deal.data["thread_id"] if deal and deal.data else None


def _thread_for_opportunity(opportunity_id: str, user_id: str) -> str | None:
    """The conversation an approved pitch opened. Approving a pitch links
    the opportunity to a deal, and the deal to its thread; a pitch that was
    never approved has neither, because nothing went out."""
    client = get_client()
    opp = (
        client.table("opportunity")
        .select("deal_id")
        .eq("id", opportunity_id)
        .eq("user_id", user_id)
        .maybe_single()
        .execute()
    )
    if not opp or not opp.data or not opp.data.get("deal_id"):
        return None
    deal = (
        client.table("deal")
        .select("thread_id")
        .eq("id", opp.data["deal_id"])
        .maybe_single()
        .execute()
    )
    return deal.data["thread_id"] if deal and deal.data else None


def _pending_tasks() -> list[dict]:
    res = get_client().table("task").select("*").eq("status", "pending").execute()
    return res.data or []


def _is_due(task: dict) -> bool:
    due_at = datetime.fromisoformat(task["due_at"])
    return due_at <= clock_now(task["user_id"])


def _claim(task_id: str) -> bool:
    """Atomically flip a task from pending to running -- only succeeds if
    it was still pending. Two overlapping tick calls (the background poll
    landing at the same moment as a manual /clock/advance, say) would
    otherwise both grab the same due task and run it twice, duplicating
    whatever it does (confirmed in testing: produced two duplicate nudge
    approvals for one follow-up). The conditional `.eq("status",
    "pending")` is the compare in compare-and-swap -- postgrest only
    updates rows matching *both* filters, so at most one caller's update
    actually changes a row."""
    result = (
        get_client()
        .table("task")
        .update({"status": "running"})
        .eq("id", task_id)
        .eq("status", "pending")
        .execute()
    )
    return bool(result.data)


def _run_task(task: dict) -> dict:
    client = get_client()
    task_id = task["id"]
    original_due_at = task["due_at"]
    client.table("task").update({"attempts": task["attempts"] + 1}).eq("id", task_id).execute()

    reason = (task.get("payload") or {}).get("reason", "no reason recorded")

    if task["kind"] == "follow_up" and task["subject_type"] == "opportunity":
        # A pitch's follow-up is written when the pitch is drafted, before
        # anyone knows whether it will be approved -- and the agent has no
        # tool that reads an opportunity, so it used to look, find no
        # thread, and report the pitch unapproved even when it had gone
        # out. Resolved here instead: an approved pitch becomes a thread
        # follow-up; one that never went out has nobody to nudge, which is
        # known without spending a model call to say so.
        thread_id = _thread_for_opportunity(task["subject_id"], task["user_id"])
        if thread_id is None:
            client.table("task").update({"status": "done"}).eq("id", task_id).execute()
            return {
                "task_id": task_id,
                "kind": task["kind"],
                "subject_type": task["subject_type"],
                "subject_id": task["subject_id"],
                "run_id": None,
                "run_status": "skipped",
                "outcome": "The pitch was never approved, so nothing went out and there is nobody to follow up with.",
            }
        task = {**task, "subject_type": "thread", "subject_id": thread_id}

    if task["kind"] == "follow_up" and task["subject_type"] == "thread":
        # Deliberately not "decide whether the client replied" as an open
        # judgement call -- a real run confused "approved and sent" with
        # "still a draft" despite the sent message being right there in
        # get_thread's output (Groq's gpt-oss-120b, Aug 19). Giving an
        # explicit, mechanical rule on message order instead of asking
        # for free-form reasoning about our own approval lifecycle is far
        # more reliable: it only has to compare two directions, not
        # reconstruct what "approved" implies.
        prompt = (
            f"Scheduled follow-up check on thread {task['subject_type']} "
            f"{task['subject_id']}. It was scheduled because: {reason}\n\n"
            f"Call get_thread({task['subject_id']!r}) and look at the "
            "messages list, in order. Apply this rule exactly:\n"
            "- If the LAST message's direction is \"inbound\", the client "
            "already replied -- do nothing, say so, and stop.\n"
            "- If the LAST message's direction is \"outbound\", the client "
            "has gone quiet since that message -- call draft_reply on this "
            "thread to send a brief, polite check-in nudge.\n"
            "Do not reason about approval status or whether anything is "
            "\"still a draft\" -- an outbound message in get_thread's "
            "output means it was already sent. Go by message order only."
        )
    elif task["kind"] == "invoice_chase":
        # No judgement call to make here at all. chase_payment already
        # knows every reason not to send -- paid, void, still a draft, not
        # yet due -- and returns action "none" for each. Asking the model
        # to decide first would only add a way for it to get that wrong,
        # and getting it wrong means dunning a client who already paid.
        prompt = (
            f"Scheduled payment check on invoice {task['subject_id']}. It was "
            f"scheduled because: {reason}\n\n"
            f"Call chase_payment({task['subject_id']!r}) and report exactly what it "
            "returned. If it returns action \"none\", that is the correct outcome -- "
            "the invoice is paid, void, or not yet due. Do not draft anything else, "
            "and do not use any other tool."
        )

    elif task["kind"] == "quote_chase":
        # Same mechanical rule as the thread follow-up, for the same
        # reason: comparing the direction of the last message is something
        # a model does reliably; reasoning about what "quoted" implies
        # about our own approval lifecycle is not.
        thread_id = _thread_for_quote(task["subject_id"], task["user_id"])
        if thread_id is None:
            prompt = (
                f"Scheduled check on quote {task['subject_id']}, but the quote or its "
                "deal no longer exists. Do nothing and say so."
            )
        else:
            prompt = (
                f"Scheduled check on a quote that was sent on thread {thread_id}. It "
                f"was scheduled because: {reason}\n\n"
                f"Call get_thread({thread_id!r}) and look at the messages list, in "
                "order. Apply this rule exactly:\n"
                "- If the LAST message's direction is \"inbound\", the client has "
                "responded to the quote -- do nothing, say so, and stop. A human "
                "records whether they accepted it.\n"
                "- If the LAST message's direction is \"outbound\", the quote has gone "
                f"unanswered -- call draft_reply({thread_id!r}) to check in once, "
                "briefly, without dropping the price or apologising for it.\n"
                "Go by message order only."
            )

    else:
        prompt = (
            f"Scheduled check-in ({task['kind']}) on {task['subject_type']} "
            f"{task['subject_id']}. It was scheduled because: {reason}\n\n"
            "Look at the current state using your tools and decide whether "
            "any action is genuinely needed right now -- if the situation "
            "already resolved itself, do nothing and say so. If it still "
            "needs a nudge, draft one."
        )

    try:
        run = run_agent(
            Trigger(
                user_id=task["user_id"],
                trigger_type="schedule",
                trigger_ref=task_id,
                prompt=prompt,
            )
        )
        # draft_reply schedules its OWN follow-up on the same
        # (kind, subject_type, subject_id) idempotency key -- so a nudge
        # this run drafted re-arms this exact task row with a new due_at
        # (an escalating check-in ladder falls out of that for free: quiet
        # thread -> nudge -> nudge reschedules another check-in -> ...).
        # If that happened, the row is already correctly 'pending' with
        # the new date; blindly stamping 'done' here would clobber that
        # reschedule. Only mark done when nothing moved the due date.
        current = client.table("task").select("due_at").eq("id", task_id).maybe_single().execute()
        if not current or not current.data or current.data["due_at"] == original_due_at:
            client.table("task").update({"status": "done"}).eq("id", task_id).execute()
        return {
            "task_id": task_id,
            "kind": task["kind"],
            "subject_type": task["subject_type"],
            "subject_id": task["subject_id"],
            "run_id": run.id,
            "run_status": run.status,
            "outcome": run.outcome,
        }
    except Exception as exc:
        rate_limit_exc = root_rate_limit_error(exc)
        if rate_limit_exc is not None:
            # Requeue rather than fail outright -- this is the same
            # transient TPM blip that's hit repeatedly in testing, and
            # manually resetting a failed task back to 'pending' recovered
            # cleanly every time. Automating exactly that recovery is safe
            # *here* in a way it wouldn't be for the interactive
            # orchestrator call: a partially completed run could in theory
            # re-run draft_reply on retry and duplicate an approval card,
            # but nothing sends without a human clicking approve regardless
            # -- worst case is a human sees two near-identical drafts and
            # rejects one, not a duplicate send. Capped so a persistently
            # throttled account still surfaces as failed instead of
            # retrying forever.
            current_attempts = task["attempts"] + 1
            if current_attempts < MAX_TASK_ATTEMPTS:
                client.table("task").update({"status": "pending"}).eq("id", task_id).execute()
                return {
                    "task_id": task_id,
                    "kind": task["kind"],
                    "requeued": True,
                    "attempts": current_attempts,
                    "error": str(rate_limit_exc),
                }
            client.table("task").update({"status": "failed"}).eq("id", task_id).execute()
            return {
                "task_id": task_id,
                "kind": task["kind"],
                "error": f"gave up after {current_attempts} attempts: {rate_limit_exc}",
            }

        client.table("task").update({"status": "failed"}).eq("id", task_id).execute()
        return {"task_id": task_id, "kind": task["kind"], "error": str(exc)}


def tick(user_id: str) -> list[dict]:
    """Run every due task belonging to one user."""
    return [
        _run_task(task)
        for task in _pending_tasks()
        if task["user_id"] == user_id and _is_due(task) and _claim(task["id"])
    ]


def tick_all_due(limit: int | None = None) -> list[dict]:
    """Run due tasks, for whichever user they belong to. Due-ness is
    checked per task against that task's own user's clock -- offsets are
    per-user (app_setting.clock_offset_seconds), not a single global
    `now`, so this can't be a single WHERE due_at <= now() query.

    `limit` caps how many tasks one call claims. It exists for serverless
    hosting, where a request is killed at a hard deadline: a task claimed
    and then cut off mid-run stays `running` forever, because nothing ever
    comes back to mark it done or failed. Claiming only as many as fit
    leaves the rest `pending` for the next call, which is exactly where a
    task that has not started belongs.
    """
    fired: list[dict] = []
    for task in _pending_tasks():
        if limit is not None and len(fired) >= limit:
            break
        if _is_due(task) and _claim(task["id"]):
            fired.append(_run_task(task))
    return fired
