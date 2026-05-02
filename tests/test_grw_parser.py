import unittest

from modules.po_tools.grw_invoice_converter.parser import (
    extract_description_fragment_from_line,
    parse_item_block,
)
from modules.po_tools.grw_invoice_converter.validator import validate_no_duplicate_skus


class GrwParserTests(unittest.TestCase):
    def test_wrapped_descriptions_remain_distinct_for_duplicate_validation(self):
        block_one = (
            "5 Sale BUR:VIN:DANC- Vincent Dancer Chassagne Montrachet $149.00 1 750mL $149.00\n"
            "Premier Cru Tete du Clos Blanc 2017 750mL"
        )
        block_two = (
            "6 Sale BUR:VIN:DANC- Vincent Dancer Chassagne Montrachet $159.00 1 750mL $159.00\n"
            "La Romanee 2017 750mL"
        )

        item_one = parse_item_block(block_one)
        item_two = parse_item_block(block_two)

        self.assertIsNotNone(item_one)
        self.assertIsNotNone(item_two)
        self.assertIn("premier cru tete du clos blanc", item_one["clean_description"].lower())
        self.assertIn("la romanee", item_two["clean_description"].lower())
        self.assertNotEqual(item_one["clean_description"], item_two["clean_description"])

        validate_no_duplicate_skus([item_one, item_two])

    def test_wrapped_description_with_mixed_price_and_qty_text_is_preserved(self):
        block = (
            "5 Sale BUR:VIN:DANC- Vincent Dancer Chassagne Montrachet $149.00 1 750mL $149.00\n"
            "Premier Cru Tete du Clos Blanc 2017 750mL $149.00 1 750mL"
        )

        item = parse_item_block(block)

        self.assertIsNotNone(item)
        self.assertIn("premier cru tete du clos blanc", item["clean_description"].lower())
        self.assertIn("Vincent Dancer Chassagne Montrachet", item["description"])

    def test_code_prefixed_continuation_line_keeps_descriptive_remainder(self):
        fragment = extract_description_fragment_from_line(
            "0750-2017-F0L0C0 Premier Cru Tete du Clos Blanc 2017"
        )
        self.assertEqual(fragment, "Premier Cru Tete du Clos Blanc 2017")

        fragment_two = extract_description_fragment_from_line(
            "0750-2017-F0L0C0 La Romanee 2017 750mL"
        )
        self.assertEqual(fragment_two, "La Romanee 2017 750mL")

        code_only = extract_description_fragment_from_line("0750-1996-F0L0C0")
        self.assertEqual(code_only, "")


if __name__ == "__main__":
    unittest.main()
