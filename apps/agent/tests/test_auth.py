"""Workspace id validation.

There is no authentication -- a workspace is identified by an unguessable
id in a cookie, and `auth.py` says so plainly. What that makes
load-bearing is the shape check: without it a malformed id reaches
PostgREST and returns a 500-shaped database error about invalid UUID
syntax, which reads to the user like the server is broken rather than
like they sent nonsense.
"""

import unittest

from clockwork.auth import _valid_uuid


class TestValidUuid(unittest.TestCase):
    def test_accepts_a_real_uuid(self):
        self.assertTrue(_valid_uuid("14ac46bb-137e-452b-9625-f114ed6e13c8"))

    def test_accepts_uppercase(self):
        self.assertTrue(_valid_uuid("14AC46BB-137E-452B-9625-F114ED6E13C8"))

    def test_rejects_nonsense(self):
        for value in ("", "not-a-uuid", "12345", "../../etc/passwd", "' OR 1=1 --"):
            with self.subTest(value=value):
                self.assertFalse(_valid_uuid(value))

    def test_rejects_missing_values(self):
        self.assertFalse(_valid_uuid(None))

    def test_rejects_non_strings(self):
        self.assertFalse(_valid_uuid(12345))
        self.assertFalse(_valid_uuid({"id": "x"}))


if __name__ == "__main__":
    unittest.main()
