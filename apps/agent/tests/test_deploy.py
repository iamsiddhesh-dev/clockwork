"""The two small pieces that decide whether a deployment works at all.

`parse_origins` turns ALLOWED_ORIGINS into what the CORS middleware matches
against; one stray slash and the live site is blocked by the browser with
an error that looks like the API is down. `cron_authorized` guards the
endpoint that runs the agent across every workspace; the direction that
matters most is that it can never fall open.
"""

import unittest

from clockwork.auth import cron_authorized
from clockwork.config import parse_origins


class TestParseOrigins(unittest.TestCase):
    def test_splits_and_trims(self):
        self.assertEqual(
            parse_origins(" https://clockwork.vercel.app , http://localhost:3000 "),
            ["https://clockwork.vercel.app", "http://localhost:3000"],
        )

    def test_strips_a_pasted_trailing_slash(self):
        """Browsers send the Origin header with no trailing slash, so
        "https://clockwork.vercel.app/" would match nothing."""
        self.assertEqual(parse_origins("https://clockwork.vercel.app/"), ["https://clockwork.vercel.app"])

    def test_ignores_empty_entries(self):
        self.assertEqual(parse_origins("https://a.app,,  ,"), ["https://a.app"])

    def test_nothing_configured_allows_nothing(self):
        self.assertEqual(parse_origins(""), [])
        self.assertEqual(parse_origins(None), [])


class TestCronAuthorized(unittest.TestCase):
    SECRET = "s3cret-value-that-is-long-enough"

    def test_accepts_the_right_bearer_token(self):
        self.assertTrue(cron_authorized(f"Bearer {self.SECRET}", self.SECRET))

    def test_scheme_is_case_insensitive(self):
        self.assertTrue(cron_authorized(f"bearer {self.SECRET}", self.SECRET))

    def test_rejects_a_wrong_or_missing_token(self):
        for header in (None, "", "Bearer", "Bearer ", "Bearer wrong", self.SECRET, f"Basic {self.SECRET}"):
            with self.subTest(header=header):
                self.assertFalse(cron_authorized(header, self.SECRET))

    def test_never_falls_open_without_a_configured_secret(self):
        """A deployment that forgot CRON_SECRET must refuse everything --
        including a caller who sends an empty bearer to match it."""
        for secret in (None, ""):
            with self.subTest(secret=secret):
                self.assertFalse(cron_authorized("Bearer ", secret))
                self.assertFalse(cron_authorized("Bearer anything", secret))


if __name__ == "__main__":
    unittest.main()
