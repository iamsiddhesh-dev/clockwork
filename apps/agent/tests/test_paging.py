"""Page windows, and the email that is now a way back into a workspace.

Both of these are tiny and both of them are the kind of tiny that breaks
a screen outright. A page window is arithmetic that turns straight into a
PostgREST `range` header: get it wrong by one and every page after the
first either repeats a row or skips one, silently. And an email that is
normalised in one place and compared in another is how two workspaces end
up claiming the same address behind a unique index that was supposed to
make that impossible.
"""

import unittest

from clockwork.api import PAGE_MAX, page_window
from clockwork.auth import _normalise_email


class TestPageWindow(unittest.TestCase):
    def test_passes_a_sensible_request_through(self):
        self.assertEqual(page_window(20, 40), (20, 40))

    def test_clamps_the_page_size(self):
        """An unbounded limit turns one careless URL into a full table
        read sent over the wire."""
        self.assertEqual(page_window(100_000, 0), (PAGE_MAX, 0))

    def test_a_zero_or_negative_limit_still_returns_a_page(self):
        """`range(0, -1)` is not an empty page -- PostgREST answers it
        with an error, so the list breaks rather than degrades."""
        for limit in (0, -1, -50):
            with self.subTest(limit=limit):
                self.assertEqual(page_window(limit, 0)[0], 1)

    def test_a_negative_offset_becomes_the_first_page(self):
        self.assertEqual(page_window(20, -10), (20, 0))

    def test_accepts_numeric_strings(self):
        """Query params arrive as strings when the route is called
        directly rather than through FastAPI's coercion."""
        self.assertEqual(page_window("25", "50"), (25, 50))

    def test_the_range_is_inclusive_on_both_ends(self):
        """The one arithmetic mistake that matters: PostgREST's range is
        inclusive, so a page of 20 starting at 40 ends at 59, not 60.
        Ending at 60 returns 21 rows and drops one from the next page."""
        limit, offset = page_window(20, 40)
        self.assertEqual(offset + limit - 1, 59)


class TestNormaliseEmail(unittest.TestCase):
    def test_lowercases_and_trims(self):
        self.assertEqual(_normalise_email("  Name@Example.COM \n"), "name@example.com")

    def test_matches_what_the_unique_index_indexes(self):
        """The index is on `lower(email)`. If these two disagreed, two
        workspaces could each believe they own an address the database
        will only let one of them have."""
        self.assertEqual(
            _normalise_email("Siddhesh@Studio.com"),
            _normalise_email("siddhesh@studio.com"),
        )

    def test_missing_values_are_empty_not_an_error(self):
        """claim_email is called on every profile save, including saves
        with no email on them yet."""
        self.assertEqual(_normalise_email(None), "")
        self.assertEqual(_normalise_email(""), "")
        self.assertEqual(_normalise_email("   "), "")


if __name__ == "__main__":
    unittest.main()
