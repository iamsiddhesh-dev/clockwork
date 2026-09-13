"""The orchestrator's per-call retry recognises a provider rate limit.

Shaped like the real failure: Strands hands the retry hook LiteLLM's
RateLimitError, often wrapped, never its own ModelThrottledException.
"""

import sys
import types
import unittest

from clockwork.retry import orchestrator_retry_strategy


class FakeRateLimitError(Exception):
    pass


class OrchestratorRetryTest(unittest.TestCase):
    def setUp(self):
        self._saved = sys.modules.get("litellm.exceptions")
        module = types.ModuleType("litellm.exceptions")
        module.RateLimitError = FakeRateLimitError
        sys.modules["litellm.exceptions"] = module

    def tearDown(self):
        if self._saved is None:
            sys.modules.pop("litellm.exceptions", None)
        else:
            sys.modules["litellm.exceptions"] = self._saved

    def test_retries_a_wrapped_rate_limit(self):
        strategy = orchestrator_retry_strategy()
        try:
            try:
                raise FakeRateLimitError("TPM limit 8000")
            except FakeRateLimitError as inner:
                raise RuntimeError("event loop cycle failed") from inner
        except RuntimeError as outer:
            self.assertTrue(strategy.is_retryable(outer))

    def test_does_not_retry_a_real_bug(self):
        self.assertFalse(orchestrator_retry_strategy().is_retryable(KeyError("thread_id")))


if __name__ == "__main__":
    unittest.main()
