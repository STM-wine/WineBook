#!/usr/bin/env python3
"""JSON bridge for the Next.js GRW parser route.

This imports the existing Streamlit-era parser as the production reference and
emits a compact JSON payload for the Next.js UI. It intentionally does not write
Excel files or mutate any GRW converter source files.
"""

from __future__ import annotations

import json
import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from modules.po_tools.grw_invoice_converter.grw_converter import extract_order_number  # noqa: E402
from modules.po_tools.grw_invoice_converter.parser import (  # noqa: E402
    extract_invoice_summary,
    extract_pdf_text_pages,
    parse_grw_pdf,
)
from modules.po_tools.grw_invoice_converter.pricing import apply_pricing  # noqa: E402
from modules.po_tools.grw_invoice_converter.validator import duplicate_item_key  # noqa: E402


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


def extract_pdf_text(pdf_path):
    page_text, _ = extract_pdf_text_pages(pdf_path)
    return "\n".join(page_text)


def clean_summary_text(text):
    return " ".join((text or "").split())


def extract_order_date(text, order_number):
    compact_text = clean_summary_text(text)
    if order_number:
        match = re.search(rf"\b{re.escape(order_number)}\s+(\d{{2}}/\d{{2}}/\d{{4}})", compact_text)
        if match:
            return match.group(1)

    match = re.search(r"Order\s*#\s+Date\s+(?:S\d+\s+)?(\d{2}/\d{2}/\d{4})", compact_text, re.IGNORECASE)
    if match:
        return match.group(1)

    # Image-only invoices can lose the table relationship during OCR. The first
    # date on a GRW sales order is the order date; the print timestamp is later.
    match = re.search(r"\b(\d{2}/\d{2}/\d{4})\b", compact_text)
    if match:
        return match.group(1)

    return None


def build_payment_rows(summary):
    rows = []
    for adjustment in summary.get("adjustments") or []:
        rows.append(
            {
                "date": f"Line {adjustment.get('line_number')}" if adjustment.get("line_number") else "",
                "type": adjustment.get("type") or "Invoice adjustment",
                "amount": abs(as_float(adjustment.get("amount")) or 0.0),
            }
        )
    if summary.get("credit_amount") is not None:
        rows.append(
            {
                "date": summary.get("credit_date") or "",
                "type": "Credit",
                "amount": summary.get("credit_amount"),
            }
        )
    return rows


def build_invoice_summary(summary, pdf_text, order_number):
    return {
        **summary,
        "order_date": extract_order_date(pdf_text, order_number),
        "payment_rows": build_payment_rows(summary),
    }


def build_duplicate_warnings(items):
    seen = {}
    warnings = []

    for index, item in enumerate(items, 1):
        key = duplicate_item_key(item)
        if key in seen:
            first_item = seen[key]
            warnings.append(
                {
                    "message": "Duplicate line item found. Review before importing, but export is still available.",
                    "description": item.get("clean_description") or "",
                    "vintage": str(item.get("vintage") or ""),
                    "firstLine": first_item.get("line_number") or first_item.get("_row_index"),
                    "duplicateLine": item.get("line_number") or index,
                }
            )
            continue

        seen[key] = {**item, "_row_index": index}

    return warnings


def build_line_item(item):
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
        "fobBottle": as_float(item.get("fob_bottle")) or 0.0,
        "fobCase": as_float(item.get("fob_case")) or 0.0,
        "frontline": as_float(item.get("frontline")) or 0.0,
        "extCost": as_float(item.get("ext_cost")) or 0.0,
        "stmMarkup": 0.15 if item.get("sku_prefix") == "BDX" else 0.10,
        "extPrice": as_float(item.get("ext_price")) or 0.0,
    }


def main() -> int:
    if len(sys.argv) != 2:
        print(json.dumps({"error": "Expected PDF path argument."}), file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    if not pdf_path.exists():
        print(json.dumps({"error": f"PDF not found: {pdf_path}"}), file=sys.stderr)
        return 2

    try:
        items, pages_parsed, debug_info = parse_grw_pdf(str(pdf_path), debug=True)
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1
    if not items:
        source = " after OCR" if debug_info.get("ocr_used") else ""
        print(
            json.dumps({"error": f"No wine line items were found{source}. Check that this is a GRW sales order."}),
            file=sys.stderr,
        )
        return 1
    priced_items = apply_pricing(items)
    summary = extract_invoice_summary(str(pdf_path))
    order_number = extract_order_number(str(pdf_path))
    pdf_text = extract_pdf_text(str(pdf_path))
    invoice_summary = build_invoice_summary(summary, pdf_text, order_number)
    duplicate_warnings = build_duplicate_warnings(priced_items)

    payload = {
        "items": [build_line_item(item) for item in priced_items],
        "metadata": {
            "orderNumber": order_number,
            "pagesParsed": pages_parsed,
            "pdfPageCount": debug_info.get("pdf_page_count"),
            "itemsPerPage": debug_info.get("items_per_page"),
            "totalItems": debug_info.get("total_items", len(items)),
            "itemNumbers": debug_info.get("item_numbers", []),
            "missingItemNumbers": debug_info.get("missing_item_numbers", []),
            "unparsedBlocksCount": debug_info.get("unparsed_blocks_count", 0),
            "ocrUsed": bool(debug_info.get("ocr_used")),
            "warnings": duplicate_warnings,
            "invoiceSummary": invoice_summary,
        },
    }
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
