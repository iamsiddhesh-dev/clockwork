"""Which scheduled-task failures are worth trying again."""

import unittest

from clockwork.scheduler import _transient_error


class APIError(Exception):
    pass


class TransientErrorTest(unittest.TestCase):
    def test_supabase_gateway_timeout_is_retried(self):
        exc = APIError("{'message': 'JSON could not be generated', 'code': 504, 'details': 'Gateway Timeout'}")
        self.assertIs(_transient_error(exc), exc)

    def test_a_real_bug_is_not(self):
        self.assertIsNone(_transient_error(ValueError("invoice abc not found")))


if __name__ == "__main__":
    unittest.main()
