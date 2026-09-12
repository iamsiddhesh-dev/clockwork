"""How the dashboard decides a workflow has done something.

A regression test for a bug that was visible on screen: the Overview
reported "0 of 4 workflows have run" seconds after sourcing 67 live
postings. The lanes counted `agent_event.tool_name`, but work started
from a screen calls the tool functions directly rather than through the
orchestrator, so it writes no tool_call event.

Being confidently wrong about something the user just watched happen is
the worst thing a status board can do, so the fixed behaviour is pinned
here: a lane is measured by what it *produced*.
"""

import unittest

from clockwork.overview import _workflow_lanes


def lanes(**kwargs):
    kwargs.setdefault("events", [])
    kwargs.setdefault("approvals", [])
    kwargs.setdefault("opportunities", [])
    kwargs.setdefault("quotes", [])
    kwargs.setdefault("invoices", [])
    result = _workflow_lanes("user-1", kwargs.pop("events"), kwargs.pop("approvals"), **kwargs)
    return {lane["key"]: lane for lane in result}


class TestWorkflowLanes(unittest.TestCase):
    def test_a_fresh_workspace_has_nothing_running(self):
        for lane in lanes().values():
            self.assertEqual(lane["tone"], "idle")
            self.assertEqual(lane["state"], "not run yet")

    def test_sourcing_counts_without_any_tool_event(self):
        """The actual bug. Sourcing ran, produced 67 rows, and logged no
        tool_call because it was started from a screen."""
        result = lanes(
            opportunities=[{"id": str(i), "fit_score": 80 if i < 10 else None} for i in range(67)]
        )
        sourcing = result["sourcing"]
        self.assertEqual(sourcing["tone"], "done")
        self.assertIn("10 of 67 scored", sourcing["state"])
        self.assertEqual(sourcing["produced"], 67)

    def test_pitching_counts_pitched_and_converted(self):
        result = lanes(
            opportunities=[
                {"id": "1", "status": "pitched", "fit_score": 70},
                {"id": "2", "status": "converted", "fit_score": 90},
                {"id": "3", "status": "scored", "fit_score": 40},
            ]
        )
        self.assertEqual(result["pitch"]["produced"], 2)
        self.assertEqual(result["pitch"]["tone"], "done")

    def test_quoting_counts_quotes_and_issued_invoices(self):
        result = lanes(
            quotes=[{"id": "q1"}, {"id": "q2"}],
            invoices=[
                {"id": "i1", "status": "sent", "chase_count": 0},
                {"id": "i2", "status": "paid", "chase_count": 0},
                {"id": "i3", "status": "draft", "chase_count": 0},
            ],
        )
        quoting = result["quote"]
        # Drafts are not counted: nothing has left the building.
        self.assertIn("2 quotes", quoting["state"])
        self.assertIn("2 invoices", quoting["state"])

    def test_singular_and_plural_read_correctly(self):
        result = lanes(quotes=[{"id": "q1"}], invoices=[{"id": "i1", "status": "sent", "chase_count": 0}])
        self.assertIn("1 quote,", result["quote"]["state"])
        self.assertIn("1 invoice", result["quote"]["state"])

    def test_collections_counts_reminders_actually_sent(self):
        result = lanes(
            invoices=[
                {"id": "i1", "status": "sent", "chase_count": 2},
                {"id": "i2", "status": "paid", "chase_count": 1},
                {"id": "i3", "status": "sent", "chase_count": 0},
            ]
        )
        self.assertEqual(result["collections"]["state"], "3 reminders sent")

    def test_one_reminder_is_singular(self):
        result = lanes(invoices=[{"id": "i1", "status": "sent", "chase_count": 1}])
        self.assertEqual(result["collections"]["state"], "1 reminder sent")

    def test_waiting_on_a_human_outranks_having_produced(self):
        """What the user must act on beats what already happened."""
        result = lanes(
            quotes=[{"id": "q1"}],
            approvals=[{"action_type": "send_quote", "status": "pending"}],
        )
        self.assertEqual(result["quote"]["tone"], "pending")
        self.assertEqual(result["quote"]["state"], "1 awaiting approval")

    def test_decided_approvals_do_not_count_as_waiting(self):
        result = lanes(
            quotes=[{"id": "q1"}],
            approvals=[
                {"action_type": "send_quote", "status": "executed"},
                {"action_type": "send_quote", "status": "rejected"},
            ],
        )
        self.assertEqual(result["quote"]["waiting"], 0)
        self.assertEqual(result["quote"]["tone"], "done")

    def test_cost_and_calls_still_come_from_the_event_log(self):
        """Domain rows say whether a stage ran; the audit trail says what
        it cost. Both, not either."""
        result = lanes(
            opportunities=[{"id": "1", "fit_score": 60}],
            events=[
                {"tool_name": "score_fit", "cost_usd": "0.0012", "created_at": "2026-09-11T10:00:00+00:00"},
                {"tool_name": "score_fit", "cost_usd": "0.0008", "created_at": "2026-09-11T10:01:00+00:00"},
            ],
        )
        sourcing = result["sourcing"]
        self.assertEqual(sourcing["calls"], 2)
        self.assertAlmostEqual(sourcing["cost_usd"], 0.002, places=4)
        self.assertEqual(sourcing["last_at"], "2026-09-11T10:01:00+00:00")


if __name__ == "__main__":
    unittest.main()
