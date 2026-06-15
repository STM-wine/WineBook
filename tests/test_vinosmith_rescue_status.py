from __future__ import annotations

from datetime import date
import unittest

from scripts.report_vinosmith_rescue_status import build_report, format_cents


class VinosmithRescueStatusTests(unittest.TestCase):
    def test_build_report_summarizes_orders_lines_and_missing_links(self):
        report = build_report(
            order_rows=[
                {
                    "supplier_order_id": "order-1",
                    "delivery_at": "2026-05-10T12:00:00+00:00",
                    "total_cents": 2500,
                    "account_id": "account-1",
                    "user_id": "user-1",
                },
                {
                    "supplier_order_id": "order-2",
                    "delivery_at": "2026-05-11T12:00:00+00:00",
                    "total_cents": "1500",
                    "account_id": None,
                    "user_id": "",
                },
                {
                    "supplier_order_id": "outside-range",
                    "delivery_at": "2026-06-01T12:00:00+00:00",
                    "total_cents": 1000,
                    "account_id": "account-2",
                    "user_id": "user-2",
                },
            ],
            line_rows=[
                {
                    "line_item_id": "line-1",
                    "supplier_order_id": "order-1",
                    "wine_id": "wine-1",
                    "total_cents": 2000,
                    "quantity_bottles": "12",
                },
                {
                    "line_item_id": "line-2",
                    "supplier_order_id": "order-2",
                    "wine_id": None,
                    "total_cents": "500",
                    "quantity_bottles": 6,
                },
                {
                    "line_item_id": "line-3",
                    "supplier_order_id": "missing-order",
                    "wine_id": "wine-2",
                    "total_cents": 999,
                    "quantity_bottles": 1,
                },
            ],
            checkpoints=[
                {
                    "checkpoint_key": "2026-05-01:2026-05-31",
                    "status": "completed",
                    "requested_start_date": "2026-05-01",
                    "requested_end_date": "2026-05-31",
                },
                {"checkpoint_key": "repair-me", "status": "needs_repair"},
            ],
            recent_runs=[],
            start_date=date(2026, 5, 1),
            end_date=date(2026, 5, 31),
        )

        self.assertEqual(report["totals"]["orders"], 2)
        self.assertEqual(report["totals"]["lines"], 2)
        self.assertEqual(report["totals"]["order_total_cents"], 4000)
        self.assertEqual(report["totals"]["line_total_cents"], 2500)
        self.assertEqual(report["totals"]["quantity_bottles"], 18)
        self.assertEqual(report["totals"]["missing_account_orders"], 1)
        self.assertEqual(report["totals"]["missing_user_orders"], 1)
        self.assertEqual(report["totals"]["missing_wine_lines"], 1)
        self.assertEqual(report["totals"]["unknown_order_lines"], 1)
        self.assertEqual(report["months"][0]["month"], "2026-05")
        self.assertEqual(report["checkpoints"]["completed_count"], 1)
        self.assertEqual(report["checkpoints"]["incomplete"], [{"checkpoint_key": "repair-me", "status": "needs_repair"}])

    def test_format_cents(self):
        self.assertEqual(format_cents(123456), "$1,234.56")


if __name__ == "__main__":
    unittest.main()
