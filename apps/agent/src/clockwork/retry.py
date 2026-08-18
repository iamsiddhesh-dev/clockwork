"""Retry-with-backoff for transient model-call failures.

Bedrock calls go through botocore, which already retries on throttling.
Groq/LiteLLM does not -- confirmed against Groq's own rate-limits docs
(Aug 18): a 429 comes back with a `retry-after` header and the caller is
expected to implement its own backoff. `call_with_retry` is that backoff,
used by every Agent(...) invocation (`ledger.invoke_model`, `agent.py`'s
orchestrator call) regardless of which provider is active -- a no-op
extra try/except on Bedrock, load-bearing on Groq.
"""

import time
from typing import Callable, TypeVar

from litellm.exceptions import RateLimitError

T = TypeVar("T")

MAX_ATTEMPTS = 3
DEFAULT_BACKOFF_SECONDS = 5.0


def _retry_after_seconds(exc: RateLimitError) -> float:
    response = getattr(exc, "response", None)
    header = response.headers.get("retry-after") if response is not None else None
    if header:
        try:
            return float(header)
        except ValueError:
            pass
    return DEFAULT_BACKOFF_SECONDS


def call_with_retry(fn: Callable[[], T], *, max_attempts: int = MAX_ATTEMPTS) -> T:
    """Call `fn()`, retrying on a rate-limit error using the provider's
    requested backoff (falls back to a fixed delay if none is given).
    Re-raises the last error once attempts are exhausted -- callers
    (run_agent, invoke_model) already turn an uncaught exception into a
    failed agent_run rather than a bare crash."""
    last_exc: RateLimitError | None = None
    for attempt in range(1, max_attempts + 1):
        try:
            return fn()
        except RateLimitError as exc:
            last_exc = exc
            if attempt == max_attempts:
                break
            time.sleep(_retry_after_seconds(exc))
    assert last_exc is not None
    raise last_exc
