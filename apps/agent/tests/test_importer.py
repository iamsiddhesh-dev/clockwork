"""Reading a profile out of someone's own material.

Onboarding stopped asking people to type their own case studies and now
reads a GitHub, a site or a pasted CV instead. Two pure pieces of that
are worth pinning down: which account a pasted link actually refers to,
and how one extracted line becomes a portfolio entry.
"""

import unittest

from clockwork.importer import github_username, split_highlight


class TestGithubUsername(unittest.TestCase):
    def test_plain_handle(self):
        self.assertEqual(github_username("torvalds"), "torvalds")
        self.assertEqual(github_username("  torvalds  "), "torvalds")
        self.assertEqual(github_username("@torvalds"), "torvalds")

    def test_profile_urls(self):
        for value in (
            "https://github.com/torvalds",
            "http://github.com/torvalds",
            "https://www.github.com/torvalds",
            "github.com/torvalds/",
        ):
            with self.subTest(value=value):
                self.assertEqual(github_username(value), "torvalds")

    def test_a_repository_link_still_names_the_person(self):
        """Pasting a link to a specific repo is the normal way people
        share their GitHub. Reading the last segment would send the
        importer to fetch a user called "linux"."""
        self.assertEqual(github_username("https://github.com/torvalds/linux"), "torvalds")
        self.assertEqual(github_username("github.com/torvalds/linux/blob/master/README"), "torvalds")

    def test_query_strings_are_ignored(self):
        self.assertEqual(
            github_username("https://github.com/iamsiddhesh-dev?tab=repositories"),
            "iamsiddhesh-dev",
        )

    def test_rejects_things_that_are_not_handles(self):
        for value in ("", None, "not a handle!!", "-leading", "trailing-", "a" * 40):
            with self.subTest(value=value):
                self.assertIsNone(github_username(value))

    def test_accepts_a_hyphenated_handle(self):
        self.assertEqual(github_username("iamsiddhesh-dev"), "iamsiddhesh-dev")


class TestSplitHighlight(unittest.TestCase):
    def test_splits_on_an_em_dash(self):
        out = split_highlight("Stripe migration — cut failed-payment churn by 40%")
        self.assertEqual(out["title"], "Stripe migration")
        self.assertEqual(out["summary"], "cut failed-payment churn by 40%")

    def test_splits_on_a_colon(self):
        out = split_highlight("recoup: ₹3,94,791 incremental on a 5,000-payment batch")
        self.assertEqual(out["title"], "recoup")
        self.assertIn("3,94,791", out["summary"])

    def test_an_unsplit_sentence_keeps_all_of_itself(self):
        """The sentence carrying the number must survive intact even when
        the model ignores the requested format -- that number is the
        entire reason the highlight is worth having."""
        line = "Built a billing system that recovered 18% of written-off revenue in one quarter"
        out = split_highlight(line)
        self.assertEqual(out["summary"], line)
        self.assertIn("18%", out["summary"])
        self.assertTrue(out["title"])

    def test_does_not_split_on_a_hyphenated_word(self):
        out = split_highlight("Rebuilt the fail-over path for a payments cluster")
        self.assertIn("fail-over", out["summary"])

    def test_collapses_whitespace(self):
        out = split_highlight("  Thing   —   did\n  something  ")
        self.assertEqual(out["title"], "Thing")
        self.assertEqual(out["summary"], "did something")

    def test_empty_input_is_survivable(self):
        self.assertEqual(split_highlight("")["summary"], "")
        self.assertEqual(split_highlight(None)["summary"], "")


if __name__ == "__main__":
    unittest.main()
