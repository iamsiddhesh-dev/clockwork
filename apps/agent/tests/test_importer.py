"""Reading a profile out of someone's own material.

Onboarding stopped asking people to type their own case studies and now
reads a GitHub, a site or a pasted CV instead. Two pure pieces of that
are worth pinning down: which account a pasted link actually refers to,
and how one extracted line becomes a portfolio entry.
"""

import unittest

from clockwork.importer import (
    github_username,
    merge_work,
    rank_repos,
    readme_excerpt,
    repo_item,
    split_highlight,
    tag_highlight,
)


class TestRepositoriesAsEvidence(unittest.TestCase):
    """Repositories become work items a fit score can cite, taken straight
    from GitHub's own fields so each can be checked by following its link."""

    def test_forks_are_not_someones_work(self):
        repos = [{"name": "linux", "fork": True}, {"name": "recoup"}]
        self.assertEqual([r["name"] for r in rank_repos(repos)], ["recoup"])

    def test_described_repos_rank_first_then_by_stars(self):
        repos = [
            {"name": "dotfiles"},
            {"name": "small", "description": "A thing", "stargazers_count": 1},
            {"name": "popular", "description": "Another", "stargazers_count": 40},
        ]
        self.assertEqual([r["name"] for r in rank_repos(repos)], ["popular", "small", "dotfiles"])

    def test_item_carries_source_link_and_tags(self):
        item = repo_item(
            {
                "name": "recoup",
                "description": "Payment recovery engine",
                "language": "Python",
                "topics": ["stripe", "payments"],
                "stargazers_count": 12,
                "html_url": "https://github.com/maya/recoup",
            }
        )
        self.assertEqual(item["source"], "GitHub")
        self.assertEqual(item["url"], "https://github.com/maya/recoup")
        self.assertEqual(item["tags"], ["Python", "stripe", "payments"])
        self.assertIn("12 stars", item["summary"])

    def test_an_undescribed_repo_still_says_what_it_is(self):
        self.assertEqual(repo_item({"name": "x", "language": "Go"})["summary"], "Go project")


class TestMergeWork(unittest.TestCase):
    def test_a_result_and_its_repository_become_one_entry(self):
        highlights = [{"title": "sandbox-code-agent", "summary": "90% of runs succeed", "source": "GitHub", "url": "https://github.com/maya"}]
        repos = [
            repo_item({"name": "sandbox-code-agent", "description": "Runs code in VMs", "language": "Python", "html_url": "https://github.com/maya/sandbox-code-agent"}),
            repo_item({"name": "dotfiles", "description": "Config", "html_url": "https://github.com/maya/dotfiles"}),
        ]
        merged = merge_work(highlights, repos)
        self.assertEqual(len(merged), 2)
        self.assertEqual(merged[0]["summary"], "90% of runs succeed")          # the result's wording, with its number
        self.assertEqual(merged[0]["url"], "https://github.com/maya/sandbox-code-agent")  # the repository's exact link
        self.assertEqual(merged[0]["tags"], ["Python"])
        self.assertEqual(merged[1]["title"], "dotfiles")

    def test_names_match_regardless_of_case(self):
        merged = merge_work(
            [{"title": "Clockwork", "summary": "Runs the business half", "source": "GitHub"}],
            [repo_item({"name": "clockwork", "html_url": "https://github.com/m/clockwork"})],
        )
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["url"], "https://github.com/m/clockwork")

    def test_portfolio_results_are_never_merged_into_repositories(self):
        merged = merge_work(
            [{"title": "clockwork", "summary": "Case study", "source": "Portfolio"}],
            [repo_item({"name": "clockwork", "html_url": "https://github.com/m/clockwork"})],
        )
        self.assertEqual(len(merged), 2)


class TestReadmeExcerpt(unittest.TestCase):
    def test_keeps_prose_and_drops_badges_images_and_code(self):
        markdown = (
            "# recoup\n"
            "![build](https://ci/badge.svg) [![stars](https://s)](https://t)\n\n"
            "Recovers 18% of failed charges. See [the docs](https://docs).\n"
            "```bash\npip install recoup\n```\n"
        )
        excerpt = readme_excerpt(markdown)
        self.assertIn("Recovers 18% of failed charges", excerpt)
        self.assertIn("the docs", excerpt)
        self.assertNotIn("badge.svg", excerpt)
        self.assertNotIn("pip install", excerpt)

    def test_is_capped(self):
        self.assertEqual(len(readme_excerpt("word " * 2000, limit=100)), 100)


class TestTagHighlight(unittest.TestCase):
    def test_reads_the_source_tag(self):
        self.assertEqual(
            tag_highlight("[GitHub] recoup — recovered 18%", default_source="Portfolio"),
            ("GitHub", "recoup — recovered 18%"),
        )
        self.assertEqual(tag_highlight("[portfolio] Site rebuild", default_source="GitHub")[0], "Portfolio")

    def test_an_untagged_line_takes_the_default(self):
        self.assertEqual(tag_highlight("Rebuilt checkout", default_source="GitHub"), ("GitHub", "Rebuilt checkout"))


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
