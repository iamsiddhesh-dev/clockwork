"""Source-feed parsing: what counts as freelance work, and cleaning HTML.

Two filters that quietly decide what a freelancer ever sees. A false
negative here means good work never reaches them; a false positive means
they read a full-time salaried role wearing a contract label.
"""

import unittest

from clockwork.sources.base import looks_freelance, strip_html


class TestLooksFreelance(unittest.TestCase):
    def test_matches_the_words_that_actually_appear(self):
        for text in (
            "Contract role, 3 months",
            "Looking for a freelancer to rebuild our checkout",
            "Part-time consultant wanted",
            "part time contractor",
            "Consulting engagement, remote",
        ):
            with self.subTest(text=text):
                self.assertTrue(looks_freelance(text))

    def test_ignores_full_time_postings(self):
        for text in (
            "Full-time Senior Engineer, salaried, equity",
            "Permanent position with benefits",
            "We are hiring an employee to join our team",
        ):
            with self.subTest(text=text):
                self.assertFalse(looks_freelance(text))

    def test_matches_on_word_boundaries_only(self):
        """"Contracting" a muscle, or a "subcontractor" clause in
        boilerplate, is not a freelance signal."""
        self.assertFalse(looks_freelance("subcontractors are not permitted"))
        self.assertFalse(looks_freelance("the contracted muscle"))

    def test_searches_every_field_it_is_given(self):
        self.assertTrue(looks_freelance("Senior Engineer", None, "This is a contract position"))
        self.assertFalse(looks_freelance("Senior Engineer", None, "Full-time, salaried"))

    def test_nothing_to_search_is_not_a_match(self):
        self.assertFalse(looks_freelance())
        self.assertFalse(looks_freelance(None, None))
        self.assertFalse(looks_freelance(""))


class TestStripHtml(unittest.TestCase):
    def test_removes_tags(self):
        self.assertEqual(strip_html("<b>Hello</b> world").split(), ["Hello", "world"])

    def test_paragraph_and_break_tags_become_newlines(self):
        """Feeds put the whole posting in one blob; without this the
        model reads a wall of run-together sentences."""
        out = strip_html("<p>First line</p><p>Second line</p>")
        self.assertIn("\n", out)

    def test_decodes_the_entities_hacker_news_actually_emits(self):
        out = strip_html("Rails &amp; Postgres &#x2F; 20&#x27;s &quot;stack&quot; &gt; all")
        self.assertIn("Rails & Postgres", out)
        self.assertIn("/", out)
        self.assertIn("20's", out)
        self.assertIn('"stack"', out)
        self.assertNotIn("&amp;", out)
        self.assertNotIn("&#x27;", out)

    def test_leaves_plain_text_readable(self):
        self.assertIn("no markup here", strip_html("no markup here"))


if __name__ == "__main__":
    unittest.main()
