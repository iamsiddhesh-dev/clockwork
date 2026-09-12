"""The money tail's arithmetic.

These are the highest-value tests in the suite, for a simple reason: the
model proposes line items but Python computes every total, due date and
invoice number. If that arithmetic is wrong, a client receives a
confident, wrong number over the freelancer's name -- which costs them
money and credibility in the same email.
"""

import unittest

from clockwork.schemas import QuoteDraft, QuoteLineItem
from clockwork.tools.money import (
    DEFAULT_TERMS_DAYS,
    _next_invoice_number_from,
    _price,
    _terms_days,
    render_quote,
)


def draft(*items: tuple[str, float, str, float]) -> QuoteDraft:
    return QuoteDraft(
        line_items=[
            QuoteLineItem(description=d, quantity=q, unit=u, unit_price=p) for d, q, u, p in items
        ],
        timeline="3 weeks",
        assumptions=[],
        exclusions=[],
        covering_note="note",
        rationale="why",
    )


class TestPricing(unittest.TestCase):
    def test_totals_are_the_sum_of_the_lines(self):
        items, subtotal, total = _price(
            draft(
                ("Discovery", 10, "hour", 95),
                ("Build", 20, "hour", 95),
                ("Handover", 1, "project", 400),
            )
        )
        self.assertEqual([i["amount"] for i in items], [950.0, 1900.0, 400.0])
        self.assertEqual(subtotal, 3250.0)
        self.assertEqual(total, subtotal)

    def test_fractional_quantities_round_to_cents(self):
        items, subtotal, _ = _price(draft(("Audit", 2.5, "day", 733.33)))
        self.assertEqual(items[0]["amount"], 1833.33)
        self.assertEqual(subtotal, 1833.33)

    def test_rounding_happens_per_line_then_sums(self):
        """Three lines that each round up must not silently drift from
        the displayed figures -- the client adds up what they can see."""
        items, subtotal, _ = _price(
            draft(("A", 1, "project", 0.005), ("B", 1, "project", 0.005), ("C", 1, "project", 0.005))
        )
        self.assertEqual(subtotal, round(sum(i["amount"] for i in items), 2))

    def test_zero_lines_total_zero(self):
        _, subtotal, total = _price(
            QuoteDraft(
                line_items=[],
                timeline="",
                assumptions=[],
                exclusions=[],
                covering_note="",
                rationale="",
            )
        )
        self.assertEqual((subtotal, total), (0, 0))


class TestPaymentTerms(unittest.TestCase):
    def test_reads_net_n(self):
        self.assertEqual(_terms_days("Net 14"), 14)
        self.assertEqual(_terms_days("net30"), 30)
        self.assertEqual(_terms_days("NET 7"), 7)

    def test_reads_terms_buried_in_prose(self):
        self.assertEqual(_terms_days("50% upfront, balance net 30"), 30)
        self.assertEqual(_terms_days("payable within 21 days of invoice"), 21)

    def test_falls_back_when_there_is_no_number(self):
        self.assertEqual(_terms_days("on completion"), DEFAULT_TERMS_DAYS)
        self.assertEqual(_terms_days(None), DEFAULT_TERMS_DAYS)
        self.assertEqual(_terms_days(""), DEFAULT_TERMS_DAYS)

    def test_absurd_windows_fall_back(self):
        """A fat-fingered "net 999" must not produce an invoice due in
        three years; the default is safer than the typo."""
        self.assertEqual(_terms_days("net 999"), DEFAULT_TERMS_DAYS)
        self.assertEqual(_terms_days("net 0"), DEFAULT_TERMS_DAYS)


class TestInvoiceNumbering(unittest.TestCase):
    def test_first_invoice(self):
        self.assertEqual(_next_invoice_number_from([]), "INV-0001")

    def test_increments_from_the_highest(self):
        self.assertEqual(
            _next_invoice_number_from([{"number": "INV-0001"}, {"number": "INV-0002"}]),
            "INV-0003",
        )

    def test_does_not_reuse_a_number_after_a_void(self):
        """Derived from the highest issued, not from a count -- a client
        must never see the same invoice number twice."""
        self.assertEqual(
            _next_invoice_number_from([{"number": "INV-0007"}, {"number": "INV-0009"}]),
            "INV-0010",
        )

    def test_ignores_unparseable_numbers(self):
        self.assertEqual(
            _next_invoice_number_from([{"number": "DRAFT"}, {"number": None}, {"number": "INV-0004"}]),
            "INV-0005",
        )


class TestRenderQuote(unittest.TestCase):
    def setUp(self):
        items, subtotal, total = _price(
            draft(("Discovery", 10, "hour", 95), ("Fixed-price build", 1, "project", 7200))
        )
        self.quote = {
            "currency": "USD",
            "line_items": items,
            "total": total,
            "timeline": "4 weeks from kickoff",
            "payment_terms": "Net 14",
            "assumptions": ["Sandbox access"],
            "exclusions": ["Front-end redesign"],
            "covering_note": "Here is what the work involves.",
        }
        self.rendered = render_quote(self.quote)

    def test_shows_the_total_the_lines_add_up_to(self):
        self.assertIn("USD 8,150.00", self.rendered)

    def test_shows_quantity_only_when_it_is_meaningful(self):
        self.assertIn("10 × hour", self.rendered)
        # A single fixed-price line reads as a price, not "1 × project".
        self.assertNotIn("1 × project", self.rendered)

    def test_carries_the_terms_the_client_needs(self):
        for fragment in ("Here is what the work involves.", "4 weeks from kickoff", "Net 14",
                         "Sandbox access", "Front-end redesign"):
            self.assertIn(fragment, self.rendered)


if __name__ == "__main__":
    unittest.main()
