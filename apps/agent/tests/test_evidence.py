"""A fit score has to rest on the freelancer's real work.

The failure being prevented: a model citing experience that appears
nowhere in someone's GitHub or portfolio, presented on the card as
evidence. These tests pin down the three rules that stop it -- evidence
must cite something that exists, a strong score needs a real project,
and a score with no valid citation is capped.
"""

import unittest

from clockwork.evidence import (
    SKILLS_ONLY_CAP,
    UNSUPPORTED_CAP,
    capped_score,
    evidence_index,
    evidence_text,
    render_index,
    verify_evidence,
)

PROFILE = {
    "skills": ["Python", "FastAPI", "PostgreSQL"],
    "portfolio": [
        {
            "title": "recoup",
            "summary": "Payment-recovery engine for failed card charges",
            "tags": ["Python"],
            "source": "GitHub",
            "url": "https://github.com/maya/recoup",
        },
        {"title": "Checkout rebuild", "summary": "Cut failed payments by 40%", "source": "Portfolio"},
        {"title": "", "summary": ""},  # empty rows are ignored, not numbered
    ],
}


class TestIndex(unittest.TestCase):
    def test_work_comes_first_and_empty_rows_are_skipped(self):
        refs = [e["ref"] for e in evidence_index(PROFILE)]
        self.assertEqual(refs, ["W1", "W2", "S1", "S2", "S3"])

    def test_rendered_list_names_source_and_link_free_text(self):
        text = render_index(evidence_index(PROFILE))
        self.assertIn("[W1] GitHub · recoup — Payment-recovery engine for failed card charges [Python]", text)
        self.assertIn("[S2] Skill · FastAPI", text)

    def test_an_empty_profile_says_so(self):
        self.assertIn("nothing", render_index(evidence_index({})))


class TestVerifyEvidence(unittest.TestCase):
    def setUp(self):
        self.index = evidence_index(PROFILE)

    def test_keeps_a_real_citation_and_attaches_its_source(self):
        [item] = verify_evidence(["[W1] Built a payment-recovery engine in Python"], self.index)
        self.assertEqual(item["text"], "Built a payment-recovery engine in Python")
        self.assertEqual(item["source"], "GitHub")
        self.assertEqual(item["url"], "https://github.com/maya/recoup")
        self.assertEqual(item["kind"], "work")

    def test_drops_invented_citations_and_uncited_claims(self):
        """The whole point: experience that isn't on file doesn't survive."""
        lines = [
            "[W9] Led a Kubernetes migration for a bank",  # no W9
            "Ten years of Rust experience",                # no citation at all
            "[X1] Something",                              # not an id form we issue
        ]
        self.assertEqual(verify_evidence(lines, self.index), [])

    def test_a_line_citing_a_skill_and_a_project_is_anchored_on_the_project(self):
        [item] = verify_evidence(["[S1][W2] Python checkout work that cut failures 40%"], self.index)
        self.assertEqual(item["kind"], "work")
        self.assertEqual(item["refs"], ["S1", "W2"])

    def test_tolerates_spacing_and_case_in_ids(self):
        self.assertEqual(len(verify_evidence(["[ w1 ] recoup engine"], self.index)), 1)

    def test_duplicates_collapse(self):
        lines = ["[W1] recoup engine", "[W1] recoup engine"]
        self.assertEqual(len(verify_evidence(lines, self.index)), 1)


class TestCappedScore(unittest.TestCase):
    def test_a_project_backed_score_stands(self):
        verified = [{"kind": "work"}]
        self.assertEqual(capped_score(88, verified), (88, None))

    def test_skills_alone_cannot_make_a_strong_match(self):
        score, concern = capped_score(85, [{"kind": "skill"}])
        self.assertEqual(score, SKILLS_ONLY_CAP)
        self.assertIn("no project", concern)

    def test_no_valid_evidence_caps_hard(self):
        score, concern = capped_score(92, [])
        self.assertEqual(score, UNSUPPORTED_CAP)
        self.assertTrue(concern)

    def test_low_scores_are_left_alone(self):
        self.assertEqual(capped_score(20, []), (20, None))
        self.assertEqual(capped_score(50, [{"kind": "skill"}]), (50, None))

    def test_out_of_range_scores_are_clamped(self):
        self.assertEqual(capped_score(140, [{"kind": "work"}])[0], 100)
        self.assertEqual(capped_score(-5, [])[0], 0)


class TestEvidenceText(unittest.TestCase):
    def test_reads_both_stored_shapes(self):
        self.assertEqual(evidence_text("Built X"), "Built X")
        self.assertEqual(
            evidence_text({"text": "Built X", "source": "GitHub", "title": "recoup"}),
            "Built X (GitHub: recoup)",
        )


if __name__ == "__main__":
    unittest.main()
