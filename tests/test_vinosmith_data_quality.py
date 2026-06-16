from __future__ import annotations

from datetime import date
import unittest

from scripts.report_vinosmith_data_quality import build_quality_report


class VinosmithDataQualityTests(unittest.TestCase):
    def test_build_quality_report_counts_cache_coverage_and_vintage_issues(self):
        report = build_quality_report(
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 15),
            checkpoints=[
                {"resource_name": "supplier_orders", "checkpoint_key": "2026-06-01:2026-06-15", "status": "completed"},
                {"resource_name": "wines", "checkpoint_key": "latest", "status": "needs_repair"},
            ],
            responses=[
                {
                    "request_identifier": "supplier_orders",
                    "response_status": 200,
                    "record_count": 10,
                    "fetched_at": "2026-06-15T12:00:00+00:00",
                }
            ],
            recent_runs=[],
            wines=[
                {
                    "wine_id": "wine-1",
                    "name": "Example Wine 2024 12/750ml",
                    "vintage": "2024",
                    "active": True,
                    "orderable": True,
                    "inventory_item": True,
                },
                {
                    "wine_id": "wine-2",
                    "name": "Mismatched Wine 2021 12/750ml",
                    "vintage": "2020",
                    "active": True,
                    "orderable": True,
                    "inventory_item": True,
                },
                {
                    "wine_id": "historical-wine",
                    "name": "Historical Wine 2019 12/750ml",
                    "vintage": "2019",
                },
            ],
            accounts=[{"account_id": "acct-1", "name": "Account"}],
            contacts=[
                {"contact_id": "contact-1", "account_id": "acct-1", "full_name": "Buyer"},
                {"contact_id": "contact-2", "account_id": "missing-account", "full_name": "Lost Buyer"},
            ],
            account_sales_reps=[
                {"account_id": "acct-1", "user_id": "user-1", "full_name": "Rep"},
                {"account_id": "acct-1", "user_id": "missing-user", "full_name": "Other Rep"},
            ],
            users=[{"user_id": "user-1", "full_name": "Rep"}],
            prices=[
                {"price_id": "price-1", "wine_id": "wine-1", "price_cents": 1200},
                {"price_id": "price-2", "wine_id": "missing-wine", "price_cents": 1500},
            ],
            prearrivals=[
                {"prearrival_key": "pre-1", "wine_id": "wine-1", "quantity": 12},
                {"prearrival_key": "pre-2", "wine_id": "missing-wine", "quantity": 6},
            ],
            inventory_rows=[{"wine_id": "wine-1", "available": 12}],
            inventory_snapshot_date="2026-06-16",
            inventory_snapshot_at="2026-06-16T12:00:00+00:00",
            inventory_source_sync_run_id="sync-run-1",
            orders=[
                {
                    "supplier_order_id": "order-1",
                    "account_id": "acct-1",
                    "user_id": "user-1",
                    "delivery_at": "2026-06-10T12:00:00+00:00",
                    "total_cents": 2500,
                },
                {
                    "supplier_order_id": "order-2",
                    "account_id": "missing-account",
                    "user_id": "",
                    "delivery_at": "2026-06-11T12:00:00+00:00",
                    "total_cents": 1000,
                },
            ],
            lines=[
                {
                    "line_item_id": "line-1",
                    "supplier_order_id": "order-1",
                    "wine_id": "wine-1",
                    "wine_name": "Example Wine 2024 12/750ml",
                    "vintage": "2024",
                    "quantity_bottles": 12,
                    "total_cents": 2500,
                },
                {
                    "line_item_id": "line-2",
                    "supplier_order_id": "order-2",
                    "wine_id": "missing-wine",
                    "wine_name": "Missing Wine",
                    "vintage": "2099",
                    "quantity_bottles": 6,
                    "total_cents": 1000,
                },
                {
                    "line_item_id": "line-3",
                    "supplier_order_id": "order-2",
                    "wine_id": "",
                    "wine_name": "Blank Wine",
                    "vintage": "",
                    "quantity_bottles": 1,
                    "total_cents": 0,
                },
            ],
        )

        self.assertEqual(report["cache_counts"]["orders"], 2)
        self.assertEqual(report["cache_counts"]["order_lines"], 3)
        self.assertEqual(report["cache_counts"]["wine_identities"], 3)
        self.assertEqual(report["cache_counts"]["current_catalog_wines"], 2)
        self.assertEqual(report["cache_counts"]["latest_inventory_source_sync_run_id"], "sync-run-1")
        self.assertEqual(report["cache_counts"]["account_contacts"], 2)
        self.assertEqual(report["cache_counts"]["account_sales_reps"], 2)
        self.assertEqual(report["sales_totals"]["line_total_cents"], 3500)
        self.assertEqual(report["coverage"]["order_accounts"]["missing"], 1)
        self.assertEqual(report["coverage"]["contact_accounts"]["missing"], 1)
        self.assertEqual(report["coverage"]["sales_rep_users"]["missing"], 1)
        self.assertEqual(report["coverage"]["order_users"]["blank"], 1)
        self.assertEqual(report["coverage"]["line_wines"]["missing"], 1)
        self.assertEqual(report["coverage"]["line_wines"]["blank"], 1)
        self.assertEqual(report["coverage"]["price_wines"]["missing"], 1)
        self.assertEqual(report["coverage"]["prearrival_wines"]["missing"], 1)
        self.assertEqual(report["coverage"]["current_catalog_wines_with_latest_inventory"]["missing"], 1)
        self.assertEqual(report["vintage_quality"]["wine_identities"]["name_year_mismatch_samples"][0]["wine_id"], "wine-2")
        self.assertEqual(report["vintage_quality"]["order_lines"]["suspect_count"], 1)
        self.assertIn("accounts", report["sync_metadata"]["missing_resource_checkpoints"])
        self.assertIn("wines", report["sync_metadata"]["missing_resource_responses"])

    def test_build_quality_report_can_skip_order_line_scan(self):
        report = build_quality_report(
            start_date=date(2026, 6, 1),
            end_date=date(2026, 6, 15),
            checkpoints=[],
            responses=[],
            recent_runs=[],
            wines=[
                {
                    "wine_id": "wine-1",
                    "name": "Example Wine 2024 12/750ml",
                    "vintage": "2024",
                    "active": True,
                }
            ],
            accounts=[{"account_id": "acct-1", "name": "Account"}],
            contacts=[],
            account_sales_reps=[],
            users=[{"user_id": "user-1", "full_name": "Rep"}],
            prices=[],
            prearrivals=[],
            inventory_rows=[],
            inventory_snapshot_date=None,
            inventory_snapshot_at=None,
            inventory_source_sync_run_id=None,
            orders=[
                {
                    "supplier_order_id": "order-1",
                    "account_id": "acct-1",
                    "user_id": "user-1",
                    "delivery_at": "2026-06-10T12:00:00+00:00",
                    "total_cents": 2500,
                }
            ],
            lines=[],
            order_lines_included=False,
        )

        self.assertEqual(report["cache_counts"]["order_lines"], 0)
        self.assertEqual(report["cache_counts"]["order_lines_included"], False)
        self.assertIsNone(report["sales_totals"]["line_total_cents"])
        self.assertIsNone(report["sales_totals"]["order_line_total_diff_cents"])
        self.assertIsNone(report["sales_totals"]["quantity_bottles"])
        self.assertIsNone(report["coverage"]["line_wines"])
        self.assertNotIn("order_lines", report["vintage_quality"])


if __name__ == "__main__":
    unittest.main()
