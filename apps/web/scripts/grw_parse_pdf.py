#!/usr/bin/env python3
"""JSON bridge for the Next.js GRW parser route.

This imports the existing Streamlit-era parser as the production reference and
emits a compact JSON payload for the Next.js UI. It intentionally does not write
Excel files or mutate any GRW converter source files.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from modules.po_tools.grw_invoice_converter.grw_converter import extract_order_number  # noqa: E402
from modules.po_tools.grw_invoice_converter.parser import extract_invoice_summary, parse_grw_pdf  # noqa: E402


def as_float(value):
    if value in (None, ""):
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def as_int(value):
    if value in (None, ""):
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def build_line_item(item):
    unit_price = as_float(item.get("unit_price")) or 0.0
    pack_size = as_int(item.get("pack_size")) or 1
    return {
        "itemNumber": "NEW",
        "lineNumber": as_int(item.get("line_number")),
        "skuPrefix": item.get("sku_prefix") or "",
        "wineName": item.get("clean_description") or "",
        "description": item.get("description") or "",
        "rawDescription": item.get("raw_description") or "",
        "vintage": str(item.get("vintage") or ""),
        "bottleSize": str(item.get("size") or ""),
        "pack": pack_size,
        "orderedQty": as_int(item.get("ordered_qty")) or 0,
        "quantity": as_int(item.get("quantity")) or 0,
        "fobBottle": unit_price,
        "fobCase": unit_price * pack_size,
        "extCost": as_float(item.get("ext_cost")) or 0.0,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Expected PDF path argument."}), file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(json.dumps({"error": f"PDF not found: {pdf_path}"}), file=sys.stderr)
        return 2

    items, pages_parsed, debug_info = parse_grw_pdf(str(pdf_path), debug=True)
    summary = extract_invoice_summary(str(pdf_path))
    order_number = extract_order_number(str(pdf_path))

    payload = {
        "items": [build_line_item(item) for item in items],
        "metadata": {
            "orderNumber": order_number,
            "pagesParsed": pages_parsed,
            "pdfPageCount": debug_info.get("pdf_page_count"),
            "itemsPerPage": debug_info.get("items_per_page"),
            "totalItems": debug_info.get("total_items", len(items)),
            "itemNumbers": debug_info.get("item_numbers", []),
            "missingItemNumbers": debug_info.get("missing_item_numbers", []),
            "unparsedBlocksCount": debug_info.get("unparsed_blocks_count", 0),
            "invoiceSummary": summary,
        },
    }
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
