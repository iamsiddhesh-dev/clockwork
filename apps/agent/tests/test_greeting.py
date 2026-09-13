"""Who a client-facing message is addressed to.

A pitch opened "Hi NOPE," -- a Hacker News username greeted as a name. The
cost of getting this wrong is lopsided: "Hi there," to a real person reads
as neutral, a wrong name reads as a machine nobody supervised. So the
tests lean hard on the rejecting direction.
"""

import unittest

from clockwork.greeting import (
    NEUTRAL_GREETING,
    apply_greeting,
    greeting_instruction,
    greeting_line,
    greeting_name,
    thread_greeting_source,
)


class TestThreadGreetingSource(unittest.TestCase):
    def test_a_pitched_deal_is_never_greeted_by_its_stored_contact(self):
        """Its contact is a board's author field. "Acme Labs" passes every
        shape check a real name does, so provenance has to decide."""
        thread = {"channel": "outbound_pitch", "contact_name": "Acme Labs"}
        self.assertIsNone(thread_greeting_source(thread))
        self.assertEqual(greeting_line(thread_greeting_source(thread)), NEUTRAL_GREETING)

    def test_a_name_from_the_intake_form_is_passed_on_to_be_judged(self):
        thread = {"channel": "email", "contact_name": "Maya Okonkwo"}
        self.assertEqual(greeting_line(thread_greeting_source(thread)), "Hi Maya,")

    def test_a_lowercase_name_typed_into_the_intake_form_still_counts(self):
        thread = {"channel": "intake_form", "contact_name": "priya sharma"}
        self.assertEqual(greeting_line(thread_greeting_source(thread)), "Hi Priya,")

    def test_an_all_caps_intake_name_is_still_not_trusted(self):
        thread = {"channel": "intake_form", "contact_name": "NOPE"}
        self.assertEqual(greeting_line(thread_greeting_source(thread)), NEUTRAL_GREETING)

    def test_no_thread_is_no_name(self):
        self.assertIsNone(thread_greeting_source(None))


class TestGreetingName(unittest.TestCase):
    def test_accepts_real_names_and_greets_by_first_name(self):
        for raw, expected in (
            ("Maya", "Maya"),
            ("Maya Okonkwo", "Maya"),
            ("  siddhesh kasat  ".title(), "Siddhesh"),
            ("Mary-Jane Watson", "Mary-Jane"),
            ("Liam O'Neil", "Liam"),
            ("José Álvarez", "José"),
            ("Zoë", "Zoë"),
        ):
            with self.subTest(raw=raw):
                self.assertEqual(greeting_name(raw), expected)

    def test_rejects_usernames(self):
        """How job-board posters are actually identified."""
        for raw in ("NOPE", "tptacek", "whoishiring", "throwaway_2026", "dev42", "@maya"):
            with self.subTest(raw=raw):
                self.assertIsNone(greeting_name(raw))

    def test_rejects_companies_and_job_titles(self):
        """A pitched deal's contact falls back to the posting title."""
        for raw in (
            "Squoosh.AI",
            "Squoosh.AI | Full-Stack Engineer (full-time, REMOTE)",
            "Acme Corp: Senior Backend Engineer",
            "https://example.com",
            "hiring@acme.com",
        ):
            with self.subTest(raw=raw):
                self.assertIsNone(greeting_name(raw))

    def test_rejects_role_words_that_look_like_names(self):
        for raw in ("Hiring Team", "Recruiter", "Unknown", "Admin", "Talent Team"):
            with self.subTest(raw=raw):
                self.assertIsNone(greeting_name(raw))

    def test_rejects_long_or_empty_values(self):
        for raw in (None, "", "   ", "One Two Three Four Five", "A" * 50):
            with self.subTest(raw=raw):
                self.assertIsNone(greeting_name(raw))

    def test_greeting_line(self):
        self.assertEqual(greeting_line("Maya Okonkwo"), "Hi Maya,")
        self.assertEqual(greeting_line("NOPE"), NEUTRAL_GREETING)
        self.assertEqual(greeting_line(None), "Hi there,")

    def test_instruction_names_the_exact_line(self):
        self.assertIn("'Hi Maya,'", greeting_instruction("Maya"))
        self.assertIn("'Hi there,'", greeting_instruction("NOPE"))


class TestApplyGreeting(unittest.TestCase):
    def test_replaces_a_username_greeting_on_the_same_line(self):
        """The real case: greeting and first sentence on one line."""
        body = "Hi NOPE, I saw your Social Comms contract for 10-20 hrs/week."
        self.assertEqual(
            apply_greeting(body, "NOPE"),
            "Hi there, I saw your Social Comms contract for 10-20 hrs/week.",
        )

    def test_replaces_a_company_greeting_on_its_own_line(self):
        body = "Hello Squoosh.AI team,\n\nI saw the Full-Stack role."
        self.assertEqual(apply_greeting(body, "Squoosh.AI"), "Hi there,\n\nI saw the Full-Stack role.")

    def test_uses_the_real_name_when_there_is_one(self):
        self.assertEqual(apply_greeting("Hi there,\n\nThanks!", "Maya Okonkwo"), "Hi Maya,\n\nThanks!")
        self.assertEqual(apply_greeting("Dear Ms. Okonkwo:\nThanks", "Maya Okonkwo"), "Hi Maya,\nThanks")

    def test_fixes_a_bracketed_placeholder(self):
        self.assertEqual(apply_greeting("Hi [Client],\nYour invoice", None), "Hi there,\nYour invoice")

    def test_leaves_a_draft_with_no_greeting_alone(self):
        for body in ("Invoice INV-003 is now 5 days overdue.", "Thanks for the brief —", ""):
            with self.subTest(body=body):
                self.assertEqual(apply_greeting(body, "Maya"), body)

    def test_drops_a_job_title_tacked_on_after_the_greeting(self):
        body = "Hi there, AI Engineer, Agent Builder. I built workflow-to-agent-converter."
        self.assertEqual(apply_greeting(body, None), "Hi there, I built workflow-to-agent-converter.")

    def test_keeps_a_real_first_sentence_after_the_greeting(self):
        for body, expected in (
            ("Hi there, thanks for posting. I can help.", "Hi there, thanks for posting. I can help."),
            ("Hello, I'm Siddhesh. I build agents.", "Hi there, I'm Siddhesh. I build agents."),
            ("Hi, Stripe Billing migration is my thing.", "Hi there, Stripe Billing migration is my thing."),
        ):
            with self.subTest(body=body):
                self.assertEqual(apply_greeting(body, None), expected)

    def test_does_not_treat_words_starting_with_hi_as_greetings(self):
        body = "Hiring for this role, you mentioned Postgres."
        self.assertEqual(apply_greeting(body, "Maya"), body)


if __name__ == "__main__":
    unittest.main()
