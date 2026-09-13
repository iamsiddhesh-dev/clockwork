"""Retry-with-backoff for transient model-call failures.

LiteLLM does not retry throttling for us -- confirmed against Groq's own
rate-limits docs (Aug 18): a 429 comes back with a `retry-after` header
and the caller is expected to implement its own backoff. `call_with_retry`
is that backoff, used by every Agent(...) invocation
(`ledger.invoke_model`, `agent.py`'s orchestrator call).

**Why the exception-chain walk matters.** Strands does not let the
provider's exception through untouched: `agent(...)` raises
`EventLoopException`, which merely *holds* the original as
`.original_exception` and is not a subclass of it. The first version of
this module caught `RateLimitError` directly and therefore never fired
against a real call -- it passed its own unit test only because that
test raised `RateLimitError` synthetically, which is not the shape
Strands produces. Match on the whole cause chain, never the top-level
type.
"""

import sys
import time
from typing import TYPE_CHECKING, Callable, TypeVar

if TYPE_CHECKING:  # pragma: no cover - for type checkers only
    from litellm.exceptions import RateLimitError

T = TypeVar("T")


def _rate_limit_error_class():
    """LiteLLM's RateLimitError, without importing LiteLLM to get it.

    Importing LiteLLM costs about twelve seconds, and this module sits on
    the API's import path through the scheduler -- so a top-level import
    here made every cold start slow even for requests that never touch a
    model. The check below is also exact rather than a shortcut: if
    LiteLLM has never been imported in this process, no exception in any
    chain can possibly be one of its errors.
    """
    module = sys.modules.get("litellm.exceptions")
    return getattr(module, "RateLimitError", None) if module else None

MAX_ATTEMPTS = 3
DEFAULT_BACKOFF_SECONDS = 5.0

# Groq answers with this when the model emits a tool call that doesn't
# match the requested schema. It is a per-generation fluke -- the same
# prompt usually succeeds on the next attempt -- and it surfaces from
# inside the SDK's own parsing, so it never reaches result validation.
TOOL_USE_FAILED = "tool_use_failed"
TOOL_USE_BACKOFF_SECONDS = 2.0


def _chain(exc: BaseException):
    """Yield `exc` and everything it wraps: Strands' own
    `.original_exception` plus the standard `__cause__`/`__context__`."""
    seen: set[int] = set()
    current: BaseException | None = exc
    while current is not None and id(current) not in seen:
        seen.add(id(current))
        yield current
        nested = getattr(current, "original_exception", None)
        if isinstance(nested, BaseException):
            current = nested
            continue
        current = current.__cause__ or current.__context__


def root_rate_limit_error(exc: BaseException) -> "RateLimitError | None":
    """The RateLimitError anywhere in `exc`'s chain, if there is one."""
    rate_limit_error = _rate_limit_error_class()
    if rate_limit_error is None:
        return None
    for item in _chain(exc):
        if isinstance(item, rate_limit_error):
            return item
    return None


def is_tool_use_failure(exc: BaseException) -> bool:
    return any(TOOL_USE_FAILED in str(item) for item in _chain(exc))


def _retry_after_seconds(exc: "RateLimitError") -> float:
    response = getattr(exc, "response", None)
    header = response.headers.get("retry-after") if response is not None else None
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    return DEFAULT_BACKOFF_SECONDS


def call_with_retry(fn: Callable[[], T], *, max_attempts: int = MAX_ATTEMPTS) -> T:
    """Call `fn()`, retrying transient model failures -- a rate limit
    (honouring the provider's own `retry-after`) or a malformed tool call.
    Anything else re-raises immediately: a real bug should fail fast, not
    be attempted three times. Callers (run_agent, invoke_model) already
    turn an uncaught exception into a failed agent_run, never a crash."""
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except Exception as exc:
            rate_limited = root_rate_limit_error(exc)
            if rate_limited is not None:
                backoff = _retry_after_seconds(rate_limited)
            elif is_tool_use_failure(exc):
                backoff = TOOL_USE_BACKOFF_SECONDS
            else:
                raise  # not transient -- surface it now

            if attempt == max_attempts:
                raise
            time.sleep(backoff)

    raise AssertionError("unreachable")  # pragma: no cover


# The orchestrator's rate-limit retry. Its prompt grows with every tool it
# calls, so a single run can spend Groq's free 8k tokens a minute on its
# own three or four calls in, and a 429 there used to fail the whole run
# -- a pasted client reply went unanswered. Retrying the *whole* run is
# unsafe (tools already ran), but retrying the one model call that was
# refused is not: nothing has happened for it yet. Strands already does
# exactly that through its retry hook; it just only recognises its own
# throttle exception, and LiteLLM's 429 arrives as something else.
ORCHESTRATOR_RETRY_ATTEMPTS = 5
ORCHESTRATOR_RETRY_DELAY_SECONDS = 5  # then 10, 20, 40


def orchestrator_retry_strategy():
    """A Strands `ModelRetryStrategy` that also retries LiteLLM rate limits."""
    from strands.agent import ModelRetryStrategy

    class _RateLimitAware(ModelRetryStrategy):
        def is_retryable(self, exception: Exception) -> bool:
            return (
                super().is_retryable(exception)
                or root_rate_limit_error(exception) is not None
                or is_tool_use_failure(exception)
            )

    return _RateLimitAware(
        max_attempts=ORCHESTRATOR_RETRY_ATTEMPTS,
        initial_delay=ORCHESTRATOR_RETRY_DELAY_SECONDS,
        max_delay=60,
    )
