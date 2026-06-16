from __future__ import annotations

import unittest

from scripts.repair_vinosmith_order_line_wines import missing_order_line_wines


class RepairVinosmithOrderLineWinesTests(unittest.TestCase):
    def test_missing_order_line_wines_extracts_raw_wines_and_dedupes(self):
        wines = missing_order_line_wines(
            [
                {
                    "line_item_id": "line-1",
                    "wine_id": "wine-1",
                    "wine_name": "Already Known",
                    "raw_data": {"wine": {"id": "wine-1", "name": "Already Known"}},
                },
                {
                    "line_item_id": "line-2",
                    "wine_id": "missing-1",
                    "wine_name": "Missing Wine",
                    "raw_data": {"wine": {"id": "missing-1", "name": "Missing Wine", "unit_set": "6"}},
                },
                {
                    "line_item_id": "line-3",
                    "wine_id": "missing-1",
                    "wine_name": "Missing Wine Duplicate",
                    "raw_data": {"wine": {"id": "missing-1", "name": "Missing Wine Duplicate"}},
                },
                {
                    "line_item_id": "line-4",
                    "wine_id": "missing-2",
                    "wine_code": "ABC",
                    "wine_name": "Fallback Wine",
                    "vintage": "2021",
                    "raw_data": {},
                },
            ],
            {"wine-1"},
        )

        self.assertEqual([wine["id"] for wine in wines], ["missing-1", "missing-2"])
        self.assertEqual(wines[0]["unit_set"], "6")
        self.assertEqual(wines[1]["code"], "ABC")
        self.assertEqual(wines[1]["vintage"], "2021")


if __name__ == "__main__":
    unittest.main()
