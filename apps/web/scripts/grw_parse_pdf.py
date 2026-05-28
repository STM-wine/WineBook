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

import pdfplumber

REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from modules.po_tools.grw_invoice_converter.grw_converter import extract_order_number  # noqa: E402
from modules.po_tools.grw_invoice_converter.parser import extract_invoice_summary, parse_grw_pdf  # noqa: E402
from modules.po_tools.grw_invoice_converter.pricing import apply_pricing  # noqa: E402


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
    page_text = []
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if text:
                page_text.append(text)
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

    return None


def build_payment_rows(summary):
    rows = []
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

    items, pages_parsed, debug_info = parse_grw_pdf(str(pdf_path), debug=True)
    priced_items = apply_pricing(items)
    summary = extract_invoice_summary(str(pdf_path))
    order_number = extract_order_number(str(pdf_path))
    pdf_text = extract_pdf_text(str(pdf_path))
    invoice_summary = build_invoice_summary(summary, pdf_text, order_number)

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
            "invoiceSummary": invoice_summary,
        },
    }
    print(json.dumps(payload))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
