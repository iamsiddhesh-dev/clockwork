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

from litellm.exceptions import RateLimitError

from .agent import Trigger, run_agent
from .clock import now as clock_now
from .db import get_client

# How many times a task gets requeued after a rate-limit failure before
# giving up for good. Deliberately not unbounded -- if it's still hitting
# 429s after this many tries, something structural is wrong (not just a
# transient TPM blip), and it should surface as `failed` rather than
# retry forever.
MAX_TASK_ATTEMPTS = 5


def _root_rate_limit_error(exc: BaseException) -> RateLimitError | None:
    """Find a RateLimitError anywhere in `exc`'s cause chain, if there is
    one. run_agent() doesn't raise litellm's RateLimitError directly --
    Strands wraps it in EventLoopException (.original_exception, not a
    subclass -- confirmed by reading strands.types.exceptions, a plain
    `except RateLimitError` here would silently never match). Also checks
    the standard `__cause__`/`__context__` chain in case another wrapper
    is introduced somewhere along the way."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        if isinstance(current, RateLimitError):
            return current
        original = getattr(current, "original_exception", None)
        if isinstance(original, BaseException):
            current = original
            continue
        current = current.__cause__ or current.__context__
    return None


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
        rate_limit_exc = _root_rate_limit_error(exc)
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


def tick_all_due() -> list[dict]:
    """Run every due task, for whichever user it belongs to. Due-ness is
    checked per task against that task's own user's clock -- offsets are
    per-user (app_setting.clock_offset_seconds), not a single global
    `now`, so this can't be a single WHERE due_at <= now() query."""
    return [_run_task(t) for t in _pending_tasks() if _is_due(t) and _claim(t["id"])]
