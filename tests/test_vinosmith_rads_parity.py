from __future__ import annotations

from datetime import date
import unittest

from scripts.report_vinosmith_rads_parity import build_parity_report


class VinosmithRadsParityTests(unittest.TestCase):
    def test_build_parity_report_compares_raw_and_multiplied_quantities(self):
        report = build_parity_report(
            report_run={
                "id": "run-1",
                "run_type": "scheduled_email",
                "report_date": "2026-06-15",
                "completed_at": "2026-06-15T12:00:00+00:00",
            },
            recommendations=[
                {
                    "planning_sku": "Example Wine 12/750ml",
                    "product_name": "Example Wine 2024 12/750ml",
                    "last_30_day_sales": 10,
                    "last_60_day_sales": 15,
                    "last_90_day_sales": 20,
                },
                {
                    "planning_sku": "Other Wine 6/750ml",
                    "product_name": "Other Wine 2023 6/750ml",
                    "last_30_day_sales": 3,
                    "last_60_day_sales": 3,
                    "last_90_day_sales": 3,
                },
            ],
            order_rows=[
                {"supplier_order_id": "order-1", "delivery_at": "2026-06-10T12:00:00+00:00"},
                {"supplier_order_id": "old-order", "delivery_at": "2026-02-01T12:00:00+00:00"},
            ],
            line_rows=[
                {
                    "line_item_id": "line-1",
                    "supplier_order_id": "order-1",
                    "wine_name": "Example Wine 2024 12/750ml",
                    "quantity_cases": 10,
                    "quantity_bottles": 120,
                    "total_cents": 25000,
                },
                {
                    "line_item_id": "line-2",
                    "supplier_order_id": "old-order",
                    "wine_name": "Example Wine 2024 12/750ml",
                    "quantity_cases": 999,
                    "quantity_bottles": 999,
                    "total_cents": 999,
                },
            ],
            as_of_date=date(2026, 6, 15),
            top=5,
        )

        last_30 = report["windows"]["30"]
        self.assertEqual(last_30["totals"]["rads_quantity"], 13)
        self.assertEqual(last_30["totals"]["vinosmith_raw_quantity"], 10)
        self.assertEqual(last_30["totals"]["vinosmith_multiplied_quantity"], 120)
        self.assertEqual(last_30["totals"]["best_quantity_basis"], "raw_quantity")
        self.assertEqual(last_30["top_raw_quantity_differences"][0]["product_name"], "Other Wine 2023 6/750ml")
        self.assertEqual(report["vinosmith_order_count"], 2)
        self.assertEqual(report["vinosmith_line_count"], 2)


if __name__ == "__main__":
    unittest.main()
