import unittest

import pandas as pd

from services.normalization_service import normalize_wine_identity
from services.price_change_service import detect_price_change
from services.pricing_engine import calculate_best_price, calculate_pricing
from services.request_workflow_service import approve_request, create_request, is_approver
from services.supplier_catalog_service import default_laid_in_for_supplier, importer_options, supplier_filter_options


class SupplierCatalogServiceTests(unittest.TestCase):
    def test_supplier_options_and_laid_in_use_loaded_importer_frame(self):
        importers = pd.DataFrame(
            [
                {
                    "importer_name": "Supplier B",
                    "importer_name_clean": "supplier b",
                    "laid_in_per_bottle": 1.75,
                },
                {
                    "importer_name": "Supplier A",
                    "importer_name_clean": "supplier a",
                    "laid_in_per_bottle": 1.25,
                },
            ]
        )

        self.assertEqual(importer_options(importers), ["Supplier A", "Supplier B"])
        self.assertEqual(default_laid_in_for_supplier(importers, " Supplier   A "), 1.25)
        self.assertEqual(supplier_filter_options(importers, []), ["All", "Supplier A", "Supplier B"])

    def test_supplier_filter_options_include_importers_and_catalog_wines(self):
        importers = pd.DataFrame([{"importer_name": "Supplier A"}])
        wines = [{"supplier_name": "Supplier C"}]

        self.assertEqual(supplier_filter_options(importers, wines), ["All", "Supplier A", "Supplier C"])

    def test_supplier_laid_in_falls_back_to_trucking_cost_column(self):
        importers = pd.DataFrame(
            [
                {
                    "supplier_name": "Supplier A",
                    "trucking_cost_per_bottle": 2.5,
                }
            ]
        )

        self.assertEqual(importer_options(importers), ["Supplier A"])
        self.assertEqual(default_laid_in_for_supplier(importers, "Supplier A"), 2.5)

    def test_pricing_calculates_bottle_case_frontline_best_price_and_margin(self):
        result = calculate_pricing(pack_size=12, fob_case=240, laid_in_per_bottle=2)

        self.assertEqual(result.fob_bottle, 20)
        self.assertEqual(result.fob_case, 240)
        self.assertEqual(result.landed_bottle_cost, 22)
        self.assertEqual(result.frontline_bottle_price, 33)
        self.assertEqual(result.best_price, 31)
        self.assertAlmostEqual(result.gross_profit_margin, 0.3333)
        self.assertEqual(result.warnings, [])

    def test_best_price_tiers(self):
        self.assertIsNone(calculate_best_price(51))
        self.assertIsNone(calculate_best_price(50))
        self.assertEqual(calculate_best_price(49), 47)
        self.assertEqual(calculate_best_price(20), 18)
        self.assertEqual(calculate_best_price(19), 18)

    def test_low_margin_warning_is_in_diagnostics(self):
        result = calculate_pricing(
            pack_size=12,
            fob_bottle=20,
            laid_in_per_bottle=2,
            frontline_bottle_price=28,
        )

        self.assertLess(result.gross_profit_margin, 0.27)
        self.assertIn("Gross profit margin is below 27%.", result.warnings)
        self.assertEqual(result.diagnostics["warnings"], result.warnings)

    def test_normalization_preserves_champagne_prefix_pack_and_nv(self):
        identity = normalize_wine_identity(
            producer="Pierre Peters",
            wine_name="Champagne Cuvee de Reserve GC",
            vintage="",
            pack_size=12,
            bottle_size="750ML",
        )

        self.assertEqual(
            identity["display_name"],
            "Champagne Pierre Peters Cuvee de Reserve GC NV 12/750ml",
        )
        self.assertEqual(
            identity["planning_sku"],
            "champagne pierre peters cuvee de reserve gc nv 12/750ml",
        )

    def test_pack_format_preserves_uppercase_liter(self):
        identity = normalize_wine_identity(
            producer="Neboa",
            wine_name="Albarino KEG",
            vintage=2024,
            pack_size=1,
            bottle_size="20l",
        )

        self.assertEqual(identity["display_name"], "Neboa Albarino KEG 2024 1/20L")

    def test_request_other_requires_notes_and_approver_gate(self):
        with self.assertRaises(ValueError):
            create_request(
                {
                    "account_customer": "Account",
                    "requested_quantity": 1,
                    "needed_by_date": "2026-06-01",
                    "placement_type": "Other",
                    "notes": "",
                }
            )

        request = create_request(
            {
                "account_customer": "Account",
                "requested_quantity": 12,
                "needed_by_date": "2026-06-01",
                "placement_type": "BTG",
                "wine_display_name": "Test Wine",
            }
        )
        self.assertFalse(is_approver("Someone"))
        with self.assertRaises(PermissionError):
            approve_request(request, approver_name="Someone", decision="approve")

        approved = approve_request(request, approver_name="Mark", decision="approve_as_special_order")
        self.assertEqual(approved.request_status, "approved")
        self.assertEqual(approved.fulfillment_status, "waiting_for_next_order")
        self.assertEqual(approved.ordering_workflow_payload["source"], "supplier_catalog_request")

    def test_default_laid_in_uses_current_importer_trucking_column(self):
        importers = pd.DataFrame(
            [
                {
                    "importer_name": "Supplier A",
                    "importer_name_clean": "supplier a",
                    "trucking_cost_per_bottle": 1.25,
                }
            ]
        )

        self.assertEqual(default_laid_in_for_supplier(importers, "Supplier A"), 1.25)

    def test_price_change_event_generated_on_fob_or_frontline_change(self):
        previous = {
            "supplier_name": "Supplier",
            "display_name": "Wine",
            "vintage": "2023",
            "fob_bottle": 20,
            "frontline_bottle_price": 33,
            "best_price": 31,
            "gross_profit_margin": 0.3333,
        }
        current = {
            "supplier_name": "Supplier",
            "display_name": "Wine",
            "vintage": "2023",
            "fob_bottle": 22,
            "frontline_bottle_price": 36,
            "best_price": 34,
            "gross_profit_margin": 0.3333,
        }

        event = detect_price_change(previous, current, effective_date="2026-06-01")
        self.assertIsNotNone(event)
        self.assertTrue(event.fob_increase)
        self.assertEqual(event.status, "draft")


if __name__ == "__main__":
    unittest.main()
