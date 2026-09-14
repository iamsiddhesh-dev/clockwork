"""Ids the model copies back with look-alike dashes still match."""

import unittest

from clockwork.ids import clean_id


class CleanIdTest(unittest.TestCase):
    def test_restores_plain_hyphens(self):
        mangled = "a81a4727\u2011d0c2\u201141b6\u2013b3c2-B63D3AD32979 "
        self.assertEqual(clean_id(mangled), "a81a4727-d0c2-41b6-b3c2-b63d3ad32979")

    def test_leaves_a_clean_id_alone(self):
        value = "26ee5e25-5d8b-497f-8022-9294f9b2e99b"
        self.assertEqual(clean_id(value), value)

    def test_empty(self):
        self.assertEqual(clean_id(None), "")


if __name__ == "__main__":
    unittest.main()
