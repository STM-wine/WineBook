#!/usr/bin/env python3
"""Server-side export bridge for the Next.js GRW converter module."""

from __future__ import annotations

import csv
import json
import re
import sys
from dataclasses import dataclass
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parents[3]
sys.path.insert(0, str(REPO_ROOT))

from modules.po_tools.grw_invoice_converter.grw_converter import (  # noqa: E402
    extract_customer_name,
    extract_order_number,
    generate_unique_filename,
    write_to_updated_template,
)
from modules.po_tools.grw_invoice_converter.parser import extract_invoice_summary, parse_grw_pdf  # noqa: E402
from modules.po_tools.grw_invoice_converter.pricing import apply_pricing  # noqa: E402
from modules.po_tools.grw_invoice_converter.validator import validate_invoice  # noqa: E402


TEMPLATE_PATH = (
    REPO_ROOT
    / "modules"
    / "po_tools"
    / "grw_invoice_converter"
    / "templates"
    / "GRW_Template_Updated.xlsx"
)


@dataclass
class FileResolution:
    customer_name: str
    invoice_number: str
    used_fallback: bool


def safe_filename_token(value: str | None, fallback: str) -> str:
    token = (value or "").strip() or fallback
    token = re.sub(r"[^A-Za-z0-9]+", "_", token).strip("_")
    return token or fallback


def build_base_output_stem(resolution: FileResolution) -> str:
    invoice_token = safe_filename_token(resolution.invoice_number, "Invoice")
    customer_token = safe_filename_token(resolution.customer_name, "Account")
    return f"{customer_token}_{invoice_token}"


def parse_filename_details(filename: str) -> tuple[str | None, str | None]:
    customer_name = None
    invoice_number = None

    if "#" not in filename:
        return customer_name, invoice_number

    parts = filename.rsplit("#", 1)
    if len(parts) != 2:
        return customer_name, invoice_number

    account_part = parts[0].strip()
    number_part = parts[1].strip().replace(".pdf", "").replace(".PDF", "").strip()
    customer_name = account_part.rstrip(" _")

    number_match = re.search(r"(\d+)", number_part)
    if number_match:
        invoice_number = f"S{number_match.group(1)}"

    return customer_name, invoice_number


def resolve_file_details(pdf_path: Path, original_filename: str | None) -> FileResolution:
    customer_name, invoice_number = parse_filename_details(original_filename or pdf_path.name)
    used_fallback = False

    if customer_name and invoice_number:
        return FileResolution(
            customer_name=customer_name,
            invoice_number=invoice_number,
            used_fallback=used_fallback,
        )

    used_fallback = True
    if not customer_name:
        customer_name = extract_customer_name(str(pdf_path)) or ""
    if not invoice_number:
        invoice_number = extract_order_number(str(pdf_path)) or ""

    return FileResolution(
        customer_name=customer_name or "",
        invoice_number=invoice_number or "",
        used_fallback=used_fallback,
    )


def build_export_rows(priced_items: list[dict[str, Any]], resolution: FileResolution) -> list[dict[str, Any]]:
    export_rows: list[dict[str, Any]] = []
    for item in priced_items:
        markup = 0.15 if item.get("sku_prefix") == "BDX" else 0.10
        export_rows.append(
            {
                "Item Number": "NEW",
                "Item Description": item.get("description", ""),
                "Description": item.get("description", ""),
                "Supplier": item.get("supplier", ""),
                "GRW Order #": resolution.invoice_number,
                "SKU": item.get("sku_prefix", ""),
                "PK": item.get("pack_size", 1),
                "Quantity": item.get("quantity", 0),
                "Qty": item.get("quantity", 0),
                "FOB Btl": item.get("fob_bottle", 0),
                "FOB Bottle": item.get("fob_bottle", 0),
                "Frontline": item.get("frontline", 0),
                "Account": resolution.customer_name,
                "FOB Case": item.get("fob_case", 0),
                "Ext Cost": item.get("ext_cost", 0),
                "STM Markup %": markup,
                "Markup": "15%" if markup == 0.15 else "10%",
                "Ext Price": item.get("ext_price", 0),
            }
        )
    return export_rows


def write_saasant_csv(export_rows: list[dict[str, Any]], output_path: Path) -> None:
    csv_columns = [
        "Item Number",
        "Item Description",
        "GRW Order #",
        "SKU",
        "PK",
        "Quantity",
        "FOB Btl",
        "Frontline",
        "Account",
        "FOB Case",
        "Ext Cost",
        "STM Markup %",
        "Ext Price",
    ]

    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w", newline="", encoding="utf-8") as csv_file:
        writer = csv.DictWriter(csv_file, fieldnames=csv_columns, extrasaction="ignore")
        writer.writeheader()
        for row in export_rows:
            csv_row = {column: row.get(column, "") for column in csv_columns}
            markup = csv_row.get("STM Markup %")
            csv_row["STM Markup %"] = f"{float(markup):.0%}" if markup not in ("", None) else ""
            writer.writerow(csv_row)


def build_export(
    pdf_path: Path,
    export_format: str,
    output_dir: Path,
    original_filename: str | None = None,
) -> dict[str, Any]:
    if export_format not in {"xlsx", "csv"}:
        raise ValueError("Export format must be xlsx or csv.")

    items, pages_parsed, debug_info = parse_grw_pdf(str(pdf_path), debug=True)
    invoice_summary = extract_invoice_summary(str(pdf_path))

    if not items:
        raise RuntimeError("No line items were found in the PDF.")

    priced_items = apply_pricing(items)
    expected_subtotal = invoice_summary.get("subtotal")
    if expected_subtotal is None:
        expected_subtotal = sum(item.get("ext_cost", 0) for item in priced_items)
    validation_result = validate_invoice(priced_items, expected_subtotal)

    resolution = resolve_file_details(pdf_path, original_filename)
    export_rows = build_export_rows(priced_items, resolution)
    base_stem = build_base_output_stem(resolution)

    if export_format == "xlsx":
        filename = f"{base_stem}.xlsx"
        output_path = output_dir / filename
        output_file = write_to_updated_template(
            items=export_rows,
            template_path=str(TEMPLATE_PATH),
            output_path=str(output_path),
            invoice_number=resolution.invoice_number,
            customer_name=resolution.customer_name,
            invoice_summary=invoice_summary,
        )
        filename = Path(output_file).name
    else:
        filename = f"{base_stem}_SAASANT.csv"
        output_path = generate_unique_filename(output_dir / filename)
        filename = output_path.name
        write_saasant_csv(export_rows, output_path)
        output_file = str(output_path)

    return {
        "filename": filename,
        "path": output_file,
        "format": export_format,
        "lineCount": len(export_rows),
        "pagesParsed": pages_parsed,
        "debugInfo": debug_info,
        "validation": validation_result,
        "resolution": {
            "customerName": resolution.customer_name,
            "invoiceNumber": resolution.invoice_number,
            "usedFallback": resolution.used_fallback,
        },
    }


def main() -> int:
    if len(sys.argv) not in {4, 5}:
        print(json.dumps({"error": "Expected PDF path, export format, output directory, and optional filename."}), file=sys.stderr)
        return 2

    pdf_path = Path(sys.argv[1])
    export_format = sys.argv[2].lower()
    output_dir = Path(sys.argv[3])
    original_filename = sys.argv[4] if len(sys.argv) == 5 else None

    if not pdf_path.exists():
        print(json.dumps({"error": f"PDF not found: {pdf_path}"}), file=sys.stderr)
        return 2

    try:
        print(json.dumps(build_export(pdf_path, export_format, output_dir, original_filename)))
    except Exception as exc:
        print(json.dumps({"error": str(exc)}), file=sys.stderr)
        return 1

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
