import unittest

from modules.po_tools.grw_invoice_converter.pricing import apply_pricing, calculate_frontline


class GrwPricingRulesTests(unittest.TestCase):
    def test_bdx_and_non_bdx_frontline(self):
        self.assertEqual(calculate_frontline(10, "BDX"), 12)
        self.assertEqual(calculate_frontline(10, "OTHER"), 11)

    def test_bdx_source_and_informational_scope_are_explicit(self):
        [priced] = apply_pricing([{
            "unit_price": 120,
            "pack_size": 12,
            "quantity": 2,
            "sku_prefix": "BDX",
        }])
        self.assertTrue(priced["is_bdx"])
        self.assertEqual(priced["bdx_status_source"], "SKU prefix parsed from invoice")
        self.assertEqual(priced["pricing_control_scope"], "informational_only")


if __name__ == "__main__":
    unittest.main()
