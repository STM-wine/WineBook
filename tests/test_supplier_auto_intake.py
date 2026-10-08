import unittest

from stem_order.supplier_auto_intake import plan_supplier_intake


class SupplierAutoIntakeTests(unittest.TestCase):
    def test_new_producer_without_wines_is_eligible(self):
        matches, review = plan_supplier_intake(
            [{"list_id": "qb-talley", "name": "Talley Vineyards", "is_active": True}],
            [{"id": 61344, "name": "Talley Vineyards", "active": True}],
            [{"representation_producer_id": 148293, "name": "Talley Vineyards", "active": True}],
            [],
            [],
        )
        self.assertEqual(review, [])
        self.assertEqual(len(matches), 1)
        self.assertEqual(matches[0]["importer_id"], "61344")
        self.assertIsNone(matches[0]["supplier_id"])

    def test_existing_qb_alias_prevents_duplicate(self):
        matches, review = plan_supplier_intake(
            [{"list_id": "qb-rune", "name": "Rune Wines", "is_active": True}],
            [{"id": 56472, "name": "Rune Wines", "active": True}],
            [],
            [{"id": "stem-rune", "name": "Rune", "qb_vendor_name": "Rune Wines", "importer_id": "14559"}],
            [],
        )
        self.assertEqual(review, [])
        self.assertEqual(matches[0]["supplier_id"], "stem-rune")
        self.assertEqual(matches[0]["existing_importer_id"], "14559")

    def test_ambiguous_vendor_and_similar_supplier_are_held(self):
        matches, review = plan_supplier_intake(
            [
                {"list_id": "qb-one", "name": "Goldschmidt Vineyards", "is_active": True},
                {"list_id": "qb-two", "name": "Goldschmidt Vineyards", "is_active": True},
                {"list_id": "qb-three", "name": "Emerson Wines", "is_active": True},
            ],
            [
                {"id": 1, "name": "Goldschmidt Vineyards", "active": True},
                {"id": 2, "name": "Emerson Wines", "active": True},
            ],
            [],
            [{"id": "stem-emerson", "name": "Emerson Brown Wines"}],
            [],
        )
        self.assertEqual(matches, [])
        self.assertEqual({row["reason"] for row in review}, {"ambiguous_source_name", "similar_stem_supplier"})

    def test_inactive_source_does_not_create_supplier(self):
        matches, review = plan_supplier_intake(
            [{"list_id": "qb-talley", "name": "Talley Vineyards", "is_active": True}],
            [{"id": 61344, "name": "Talley Vineyards", "active": False}],
            [],
            [],
            [],
        )
        self.assertEqual((matches, review), ([], []))


if __name__ == "__main__":
    unittest.main()
