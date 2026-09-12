"""The retry helper's exception-chain walk.

This exists because of a bug that shipped and never fired. The first
version caught `RateLimitError` directly, which looks obviously correct
and is wrong: Strands does not let the provider's exception through. It
raises `EventLoopException`, which merely *holds* the original as
`.original_exception` and is not a subclass of it.

The original unit test passed because it raised `RateLimitError`
synthetically -- testing the helper against a shape production never
produces. So every test here wraps the way Strands actually wraps, and
`test_wrapped_is_not_a_subclass` pins down the exact false assumption.
"""

import unittest

from litellm.exceptions import RateLimitError

from clockwork.retry import is_tool_use_failure, root_rate_limit_error


def rate_limit() -> RateLimitError:
    """The provider's real error class, on purpose.

    A stand-in would defeat the test: `root_rate_limit_error` matches by
    `isinstance`, so a fake would prove only that the fake matches
    itself. Using the class production actually raises is the whole
    point of these tests.
    """
    return RateLimitError(
        message="rate limit reached for model gpt-oss-120b",
        llm_provider="groq",
        model="gpt-oss-120b",
    )


class FakeEventLoopException(Exception):
    """How Strands wraps a provider error: holds it, is not it."""

    def __init__(self, original):
        super().__init__(f"Event loop failed: {original}")
        self.original_exception = original


class TestWrapping(unittest.TestCase):
    def test_wrapped_is_not_a_subclass(self):
        """The assumption the original bug rested on, written down so it
        cannot quietly come back."""
        wrapped = FakeEventLoopException(rate_limit())
        self.assertNotIsInstance(wrapped, RateLimitError)

    def test_finds_a_rate_limit_through_the_wrapper(self):
        wrapped = FakeEventLoopException(rate_limit())
        self.assertIsNotNone(root_rate_limit_error(wrapped))

    def test_finds_a_rate_limit_through_a_cause_chain(self):
        try:
            try:
                raise rate_limit()
            except RateLimitError as exc:
                raise RuntimeError("tool failed") from exc
        except RuntimeError as outer:
            self.assertIsNotNone(root_rate_limit_error(outer))

    def test_finds_a_rate_limit_nested_two_deep(self):
        wrapped = FakeEventLoopException(FakeEventLoopException(rate_limit()))
        self.assertIsNotNone(root_rate_limit_error(wrapped))

    def test_ordinary_errors_are_not_rate_limits(self):
        self.assertIsNone(root_rate_limit_error(ValueError("opportunity not found")))
        self.assertIsNone(root_rate_limit_error(FakeEventLoopException(KeyError("body"))))

    def test_a_cycle_does_not_hang(self):
        """Chain walking must terminate even on a self-referential cause,
        or a retry helper becomes an infinite loop in production."""
        a = RuntimeError("a")
        b = RuntimeError("b")
        a.__cause__ = b
        b.__cause__ = a
        self.assertIsNone(root_rate_limit_error(a))


class TestToolUseFailure(unittest.TestCase):
    def test_detects_a_malformed_tool_call(self):
        wrapped = FakeEventLoopException(Exception("An error occurred: tool_use_failed"))
        self.assertTrue(is_tool_use_failure(wrapped))

    def test_plain_errors_are_not_tool_use_failures(self):
        self.assertFalse(is_tool_use_failure(ValueError("deal not found")))


if __name__ == "__main__":
    unittest.main()
