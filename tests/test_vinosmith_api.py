from __future__ import annotations

from datetime import date
import unittest

from stem_order.vinosmith_api import (
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


if __name__ == "__main__":
    unittest.main()
