from __future__ import annotations

from datetime import date
import unittest

from scripts.sync_vinosmith_rescue import parse_query_params, resource_query_params
from stem_order.vinosmith_api import (
    analyze_vintage_values,
    collect_wine_snapshots,
    filter_supplier_orders_by_delivery_status,
    filter_supplier_orders_by_delivery_window,
    records_for_resource,
    supplier_order_line_bottle_quantity,
    validate_supplier_order_window,
)


class VinosmithApiHelperTests(unittest.TestCase):
    def test_validate_supplier_order_window_rejects_too_large_windows(self):
        with self.assertRaisesRegex(ValueError, "may not exceed"):
            validate_supplier_order_window("2026-05-01", "2026-06-15")

    def test_supplier_orders_are_filtered_by_local_window_and_status(self):
        orders = [
            {
                "supplier_order": {
                    "id": "april",
                    "delivery_at": "2026-04-30T12:00:00Z",
                    "delivery_status": "sent-to-warehouse",
                }
            },
            {
                "supplier_order": {
                    "id": "may-delivered",
                    "delivery_at": "2026-05-10T12:00:00Z",
                    "delivery_status": "sent-to-warehouse",
                }
            },
            {
                "supplier_order": {
                    "id": "may-pending",
                    "delivery_at": "2026-05-11T12:00:00Z",
                    "delivery_status": "pending",
                }
            },
        ]

        windowed = filter_supplier_orders_by_delivery_window(
            orders,
            date(2026, 5, 1),
            date(2026, 5, 31),
        )
        delivered = filter_supplier_orders_by_delivery_status(windowed, ("sent-to-warehouse",))

        self.assertEqual([order["supplier_order"]["id"] for order in windowed], ["may-delivered", "may-pending"])
        self.assertEqual([order["supplier_order"]["id"] for order in delivered], ["may-delivered"])

    def test_records_for_resource_and_bottle_quantity(self):
        payload = {"data": {"wines": [{"id": "wine-1"}]}}
        self.assertEqual(records_for_resource("wines", payload), [{"id": "wine-1"}])
        self.assertEqual(
            supplier_order_line_bottle_quantity({"quantity": "3", "wine": {"unit_set": "12"}}),
            36,
        )

    def test_analyze_vintage_values_counts_missing_odd_and_future_values(self):
        wines = [
            {"id": "wine-1", "code": "A", "name": "No Vintage", "vintage": None},
            {"id": "wine-2", "code": "B", "name": "NV Wine", "vintage": "NV"},
            {"id": "wine-3", "code": "C", "name": "Current Wine", "vintage": "2026"},
            {"id": "wine-4", "code": "D", "name": "Future Wine", "vintage": "2027"},
        ]

        diagnostics = analyze_vintage_values(wines, current_year=2026)

        self.assertEqual(diagnostics["missing_count"], 1)
        self.assertEqual(diagnostics["non_year_count"], 1)
        self.assertEqual(diagnostics["current_or_future_year_count"], 2)
        self.assertEqual(diagnostics["future_year_count"], 1)
        self.assertEqual(diagnostics["recent_year_count"], 2)
        self.assertEqual(diagnostics["current_or_future_samples"][0]["code"], "C")

    def test_collect_wine_snapshots_from_supplier_orders(self):
        records = [{"line_items": [{"wine": {"id": "wine-1"}}, {"wine": None}]}]

        self.assertEqual(collect_wine_snapshots("supplier_orders", records), [{"id": "wine-1"}])

    def test_parse_query_params_supports_global_and_resource_specific_values(self):
        parsed = parse_query_params(
            [
                "include=producer:logo",
                "wines.updated_since=2026-06-01T00:00:00Z",
                "supplier_orders.account_id=123",
            ]
        )

        self.assertEqual(parsed["*"], {"include": "producer:logo"})
        self.assertEqual(parsed["wines"], {"updated_since": "2026-06-01T00:00:00Z"})
        self.assertEqual(parsed["supplier_orders"], {"account_id": "123"})
        self.assertEqual(
            resource_query_params("wines", parsed),
            {"include": "producer:logo", "updated_since": "2026-06-01T00:00:00Z"},
        )

    def test_parse_query_params_rejects_unknown_resource(self):
        with self.assertRaises(SystemExit):
            parse_query_params(["winery.secret=true"])


if __name__ == "__main__":
    unittest.main()
