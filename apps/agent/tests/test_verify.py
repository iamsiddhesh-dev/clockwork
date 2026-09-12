"""Link verification: deciding whether a posting is still real.

`classify` is deliberately separated from the HTTP call so these cases
can be written out exactly, with no network and no flake. Each one below
is a failure mode seen on a real job board.
"""

import unittest

from clockwork.sources.verify import (
    CLOSED_PATTERNS,
    HN_ITEM,
    classify,
    is_site_root,
    retry_after_seconds,
    verify_hn_item,
)


def check(**kwargs):
    kwargs.setdefault("original_url", "https://board.example/jobs/senior-dev-123")
    kwargs.setdefault("final_url", kwargs["original_url"])
    kwargs.setdefault("http_status", 200)
    kwargs.setdefault("body", "<h1>Senior Developer</h1><p>Apply now.</p>")
    return classify(**kwargs)


class TestSiteRoot(unittest.TestCase):
    def test_bare_domain_is_root(self):
        self.assertTrue(is_site_root("https://board.example"))
        self.assertTrue(is_site_root("https://board.example/"))

    def test_section_index_is_root(self):
        # Landing on /jobs rather than /jobs/123 means the specific
        # listing is gone, even though the server said 200.
        for url in ("https://b.example/jobs", "https://b.example/careers/", "https://b.example/remote-jobs"):
            self.assertTrue(is_site_root(url), url)

    def test_a_real_posting_is_not_root(self):
        self.assertFalse(is_site_root("https://board.example/jobs/senior-dev-123"))
        self.assertFalse(is_site_root("https://news.ycombinator.com/item?id=4111"))


class TestClassify(unittest.TestCase):
    def test_healthy_posting_is_live(self):
        self.assertEqual(check().status, "live")

    def test_404_is_gone(self):
        result = check(http_status=404)
        self.assertEqual(result.status, "gone")
        self.assertIn("404", result.note)

    def test_410_is_gone(self):
        self.assertEqual(check(http_status=410).status, "gone")

    def test_redirect_to_homepage_is_gone(self):
        """The nastiest case: the listing was removed and the server
        cheerfully 200s you to its homepage. Status alone says healthy."""
        result = check(final_url="https://board.example/")
        self.assertEqual(result.status, "gone")
        self.assertIn("homepage", result.note)

    def test_redirect_between_real_postings_is_still_live(self):
        # Boards do rewrite slugs; that is not the same as removal.
        result = check(final_url="https://board.example/jobs/senior-developer")
        self.assertEqual(result.status, "live")

    def test_closed_banner_is_closed(self):
        for phrase in (
            "This position has been filled.",
            "We are no longer accepting applicants.",
            "This job is closed",
            "Applications are closed",
            "This posting has expired",
        ):
            with self.subTest(phrase=phrase):
                result = check(body=f"<main><h1>Role</h1><p>{phrase}</p></main>")
                self.assertEqual(result.status, "closed")
                self.assertTrue(result.note)

    def test_closed_wording_inside_markup_does_not_count(self):
        """`class="closed"` is markup, not prose. Matching it would mark
        healthy postings dead, which silently deletes good leads."""
        body = '<div class="job-closed-banner" data-state="closed"><p>Apply now.</p></div>'
        self.assertEqual(check(body=body).status, "live")

    def test_script_contents_are_ignored(self):
        body = '<script>var s = {"state":"this job is closed"};</script><p>Apply now.</p>'
        self.assertEqual(check(body=body).status, "live")

    def test_403_is_unreachable_not_gone(self):
        """A board blocking the checker says nothing about the role.
        Calling this "gone" would quietly discard real work."""
        result = check(http_status=403, body=None)
        self.assertEqual(result.status, "unreachable")
        self.assertIn("blocked the check", result.note)

    def test_429_is_unreachable(self):
        self.assertEqual(check(http_status=429, body=None).status, "unreachable")

    def test_5xx_is_unreachable(self):
        self.assertEqual(check(http_status=503, body=None).status, "unreachable")

    def test_transport_error_is_unreachable(self):
        result = classify(
            original_url="https://dead.invalid/jobs/1",
            final_url=None,
            http_status=None,
            body=None,
            error="connect error",
        )
        self.assertEqual(result.status, "unreachable")
        self.assertEqual(result.note, "connect error")

    def test_gone_wins_over_a_closed_banner(self):
        """A 404 page that happens to contain "no longer available" is
        gone, not closed -- the stronger, cheaper signal is checked first."""
        result = check(http_status=404, body="<p>This job is no longer available</p>")
        self.assertEqual(result.status, "gone")


class FakeResponse:
    def __init__(self, payload, status_code=200):
        self._payload = payload
        self.status_code = status_code

    def json(self):
        if self._payload is Ellipsis:
            raise ValueError("not json")
        return self._payload


class FakeClient:
    """Just enough of httpx.Client for the Hacker News path."""

    def __init__(self, response):
        self._response = response
        self.calls: list[str] = []

    def get(self, url):
        self.calls.append(url)
        return self._response


class TestHackerNews(unittest.TestCase):
    """Hacker News is checked through its item API rather than by
    scraping. Two reasons, both load-bearing: the web pages rate-limit
    hard (19 of 28 checks came back 429 even paced 2.5s apart), and the
    API exposes `deleted`/`dead` flags the rendered page hides -- so a
    withdrawn posting that still *looks* fine in a browser is caught."""

    def test_recognises_an_item_permalink(self):
        self.assertEqual(
            HN_ITEM.match("https://news.ycombinator.com/item?id=49164584").group(1), "49164584"
        )
        self.assertIsNone(HN_ITEM.match("https://remoteok.com/remote-jobs/123"))
        self.assertIsNone(HN_ITEM.match("https://news.ycombinator.com/newest"))

    def test_a_live_comment(self):
        result = verify_hn_item("1", FakeClient(FakeResponse({"id": 1, "text": "We are hiring"})))
        self.assertEqual(result.status, "live")

    def test_a_deleted_comment_is_gone(self):
        result = verify_hn_item("1", FakeClient(FakeResponse({"id": 1, "deleted": True})))
        self.assertEqual(result.status, "gone")
        self.assertIn("deleted", result.note)

    def test_a_dead_comment_is_gone(self):
        result = verify_hn_item("1", FakeClient(FakeResponse({"id": 1, "dead": True})))
        self.assertEqual(result.status, "gone")

    def test_a_missing_item_is_gone(self):
        # The API answers 200 with a literal `null` for ids that never
        # existed or were purged.
        result = verify_hn_item("1", FakeClient(FakeResponse(None)))
        self.assertEqual(result.status, "gone")

    def test_an_edited_closed_notice_is_closed(self):
        result = verify_hn_item(
            "1", FakeClient(FakeResponse({"id": 1, "text": "EDIT: this position has been filled"}))
        )
        self.assertEqual(result.status, "closed")

    def test_api_trouble_is_unreachable(self):
        self.assertEqual(verify_hn_item("1", FakeClient(FakeResponse({}, 503))).status, "unreachable")
        self.assertEqual(verify_hn_item("1", FakeClient(FakeResponse(Ellipsis))).status, "unreachable")

    def test_it_calls_the_api_not_the_web_page(self):
        client = FakeClient(FakeResponse({"id": 1}))
        verify_hn_item("49164584", client)
        self.assertEqual(len(client.calls), 1)
        self.assertIn("hacker-news.firebaseio.com", client.calls[0])
        self.assertNotIn("news.ycombinator.com", client.calls[0])


class TestRetryAfter(unittest.TestCase):
    def test_uses_the_interval_the_server_asked_for(self):
        self.assertEqual(retry_after_seconds("3"), 3.0)

    def test_falls_back_when_absent_or_unparseable(self):
        self.assertEqual(retry_after_seconds(None), 5.0)
        self.assertEqual(retry_after_seconds("Wed, 21 Oct 2026 07:28:00 GMT"), 5.0)

    def test_caps_absurd_waits(self):
        """A link check is not worth blocking a batch for an hour; at
        that point "couldn't check" is the honest answer."""
        self.assertEqual(retry_after_seconds("86400"), 20.0)

    def test_never_negative(self):
        self.assertEqual(retry_after_seconds("-5"), 0.0)


class TestClosedPatterns(unittest.TestCase):
    def test_does_not_match_ordinary_posting_prose(self):
        """Guarding the false-positive direction explicitly: these are
        sentences a healthy posting really contains."""
        for line in (
            "Applications close on 30 September, so apply early.",
            "We are hiring a senior engineer to close out our billing work.",
            "You will work closely with the founding team.",
            "The role is open to applicants in any timezone.",
        ):
            with self.subTest(line=line):
                self.assertIsNone(CLOSED_PATTERNS.search(line))


if __name__ == "__main__":
    unittest.main()
