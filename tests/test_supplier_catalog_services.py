import unittest

from services.normalization_service import normalize_wine_identity
from services.price_change_service import detect_price_change
from services.pricing_engine import balance_price_level, calculate_best_price, calculate_pricing
from services.request_workflow_service import approve_request, create_request, is_approver
from services.supplier_catalog_service import default_laid_in_for_supplier


class SupplierCatalogServiceTests(unittest.TestCase):
    def test_pricing_calculates_bottle_case_frontline_best_price_and_margin(self):
        result = calculate_pricing(pack_size=12, fob_case=240, laid_in_per_bottle=2)

        self.assertEqual(result.fob_bottle, 20)
        self.assertEqual(result.fob_case, 240)
        self.assertEqual(result.landed_bottle_cost, 22)
        self.assertEqual(result.frontline_bottle_price, 33)
        self.assertEqual(result.best_price, 32)
        self.assertAlmostEqual(result.gross_profit_margin, 0.3333)
        self.assertAlmostEqual(result.best_gross_profit_margin, 0.3125)
        self.assertEqual(result.warnings, [])

    def test_best_price_is_independent_and_rounds_up(self):
        self.assertEqual(calculate_best_price(10.30), 14.75)
        self.assertEqual(calculate_best_price(22), 32)
        self.assertEqual(calculate_best_price(40), 58)

    def test_pack_size_must_be_a_positive_whole_number(self):
        for invalid in (None, 0, -1, 2.5, "bad"):
            with self.subTest(invalid=invalid), self.assertRaises(ValueError):
                calculate_pricing(pack_size=invalid, fob_case=240)

    def test_best_30_percent_target_conflict_uses_best_da(self):
        without_da = calculate_pricing(pack_size=12, fob_bottle=13, laid_in_per_bottle=0)
        with_da = calculate_pricing(pack_size=12, fob_bottle=13, laid_in_per_bottle=0, best_depletion_allowance=1)
        self.assertEqual((without_da.frontline_bottle_price, without_da.best_price), (19.25, 18.75))
        self.assertFalse(without_da.diagnostics["best_target_conflict"])
        self.assertEqual((with_da.frontline_bottle_price, with_da.best_price), (19.25, 18.75))
        self.assertFalse(with_da.diagnostics["best_target_conflict"])

    def test_da_warning_and_explicit_solve_validation(self):
        result = balance_price_level(
            bottle_price=20,
            landed_bottle_cost=20,
            depletion_allowance=21,
            solve_for="gp",
        )
        self.assertTrue(result["da_exceeds_landed_cost"])
        with self.assertRaisesRegex(ValueError, "below 100%"):
            balance_price_level(
                bottle_price=20,
                landed_bottle_cost=20,
                target_gp_margin=1,
                solve_for="da",
            )

    def test_manual_frontline_override_is_preserved(self):
        result = calculate_pricing(
            pack_size=12,
            fob_bottle=20,
            laid_in_per_bottle=2,
            frontline_bottle_price=28,
        )

        self.assertEqual(result.frontline_bottle_price, 28)
        self.assertAlmostEqual(result.gross_profit_margin, 0.2143)
        self.assertIn("Gross profit margin is below 28%.", result.warnings)
        self.assertEqual(result.diagnostics["warnings"], result.warnings)

    def test_acceptance_under_twenty_and_frontline_only(self):
        result = calculate_pricing(pack_size=12, fob_bottle=10.30, laid_in_per_bottle=0)
        self.assertEqual((result.best_price, result.frontline_bottle_price), (14.75, 15.25))
        self.assertAlmostEqual(result.best_gross_profit_margin, 0.3017)
        self.assertAlmostEqual(result.gross_profit_margin, 0.3246)
        self.assertIsNone(calculate_pricing(pack_size=12, fob_bottle=40, laid_in_per_bottle=0, frontline_only=True).best_price)

    def test_rounding_threshold_and_required_inputs(self):
        below = calculate_pricing(pack_size=1, fob_bottle=13.99, laid_in_per_bottle=0)
        equal = calculate_pricing(pack_size=1, fob_bottle=14, laid_in_per_bottle=0)
        above = calculate_pricing(pack_size=1, fob_bottle=14.01, laid_in_per_bottle=0)
        self.assertEqual((below.best_price, equal.best_price, above.best_price), (20, 20, 21))
        self.assertFalse(calculate_pricing(pack_size=12, fob_bottle=10.30).suggestions_ready)

    def test_price_level_balancing_preserves_gp_then_da_before_frontline(self):
        result = balance_price_level(
            landed_bottle_cost=20,
            target_gp_margin=0.30,
            depletion_allowance=1.10,
            bottle_price=25,
            solve_for="price",
        )

        self.assertEqual(result["calculated_field"], "price")
        self.assertEqual(result["bottle_price"], 27)
        self.assertEqual(result["depletion_allowance"], 1.10)
        self.assertAlmostEqual(result["calculated_gp_margin"], 0.30)

    def test_price_level_balancing_calculates_da_when_price_constrains_target_gp(self):
        result = balance_price_level(
            landed_bottle_cost=20,
            target_gp_margin=0.30,
            bottle_price=27,
            solve_for="da",
        )

        self.assertEqual(result["calculated_field"], "da")
        self.assertEqual(result["depletion_allowance"], 1.10)
        self.assertAlmostEqual(result["calculated_gp_margin"], 0.30)

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
        import pandas as pd

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
