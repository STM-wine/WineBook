"""
GRW Invoice Converter - Streamlit App

A branded web interface for converting GRW invoice PDFs to Excel templates.
"""

from dataclasses import dataclass
import base64
import hashlib
import io
import os
import re
import tempfile
import traceback
from typing import Any
from pathlib import Path

import pandas as pd
import streamlit as st

from modules.po_tools.grw_invoice_converter.grw_converter import (
    extract_customer_name,
    extract_order_number,
    write_to_updated_template,
)
from modules.po_tools.grw_invoice_converter.parser import extract_invoice_summary, parse_grw_pdf
from modules.po_tools.grw_invoice_converter.pricing import apply_pricing
from modules.po_tools.grw_invoice_converter.validator import ValidationError, validate_invoice


st.set_page_config(
    page_title="GRW Invoice Converter",
    page_icon=":wine_glass:",
    layout="wide",
)


LOGO_PATH = (
    Path(__file__).parent
    / "modules"
    / "po_tools"
    / "grw_invoice_converter"
    / "logo"
    / "GRW_converter_logo.png"
)
TEMPLATE_PATH = (
    Path(__file__).parent
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


@dataclass
class ConversionSuccess:
    excel_filename: str
    excel_bytes: bytes
    csv_filename: str | None
    csv_bytes: bytes | None
    priced_items: list[dict[str, Any]]
    export_rows: list[dict[str, Any]]
    validation_result: dict[str, Any]
    preview_df: pd.DataFrame
    customer_name: str
    invoice_number: str
    invoice_summary: dict[str, Any]
    debug_info: dict[str, Any]
    pages_parsed: Any


@dataclass
class ConversionFailure:
    message: str
    traceback_text: str | None = None
    debug_info: dict[str, Any] | None = None


def uploaded_file_key(uploaded_pdf) -> str:
    uploaded_pdf.seek(0)
    file_bytes = uploaded_pdf.getvalue()
    file_digest = hashlib.sha256(file_bytes).hexdigest()[:16]
    dependency_paths = [
        Path(parse_grw_pdf.__code__.co_filename),
        Path(write_to_updated_template.__code__.co_filename),
        TEMPLATE_PATH,
        Path(__file__),
    ]
    dependency_stamp = 0
    for dependency_path in dependency_paths:
        if dependency_path.exists():
            dependency_stamp = max(dependency_stamp, int(dependency_path.stat().st_mtime))
    return f"{uploaded_pdf.name}:{file_digest}:{dependency_stamp}"


def safe_filename_token(value: str | None, fallback: str) -> str:
    token = (value or "").strip()
    if not token:
        token = fallback
    token = re.sub(r"[^A-Za-z0-9]+", "_", token).strip("_")
    return token or fallback


def build_base_output_stem(resolution: FileResolution) -> str:
    invoice_token = safe_filename_token(resolution.invoice_number, "Invoice")
    customer_token = safe_filename_token(resolution.customer_name, "Account")
    return f"{customer_token}_{invoice_token}"


def allocate_download_filenames(resolution: FileResolution) -> tuple[str, str]:
    base_stem = build_base_output_stem(resolution)
    session_counts = st.session_state.setdefault("grw_download_name_counts", {})
    copy_index = session_counts.get(base_stem, 0)
    session_counts[base_stem] = copy_index + 1

    suffix = "" if copy_index == 0 else f" ({copy_index})"
    excel_filename = f"{base_stem}{suffix}.xlsx"
    csv_filename = f"{base_stem}_SAASANT{suffix}.csv"
    return excel_filename, csv_filename


def build_excel_download_bytes(
    export_rows: list[dict[str, Any]],
    resolution: FileResolution,
    excel_filename: str,
    invoice_summary: dict[str, Any],
) -> tuple[str, bytes]:
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_output_path = Path(temp_dir) / excel_filename
        output_file = write_to_updated_template(
            items=export_rows,
            template_path=str(TEMPLATE_PATH),
            output_path=str(temp_output_path),
            invoice_number=resolution.invoice_number,
            customer_name=resolution.customer_name,
            invoice_summary=invoice_summary,
        )
        excel_bytes = Path(output_file).read_bytes()
    return excel_filename, excel_bytes


def build_optional_saasant_csv(
    export_rows: list[dict[str, Any]],
    resolution: FileResolution,
    csv_filename: str,
) -> tuple[str | None, bytes | None]:
    _ = resolution
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
    csv_df = pd.DataFrame(export_rows)
    csv_df = csv_df.reindex(columns=csv_columns).fillna("")
    csv_df["STM Markup %"] = csv_df["STM Markup %"].map(
        lambda value: f"{float(value):.0%}" if value not in ("", None) else ""
    )
    csv_buffer = io.StringIO()
    csv_df.to_csv(csv_buffer, index=False)
    return csv_filename, csv_buffer.getvalue().encode("utf-8")


def logo_data_uri(path: Path) -> str:
    suffix = path.suffix.lower()
    mime_type = "image/png" if suffix == ".png" else "image/jpeg"
    encoded = base64.b64encode(path.read_bytes()).decode("ascii")
    return f"data:{mime_type};base64,{encoded}"


def inject_styles() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap');

        :root {
            --grw-page-bg:
                radial-gradient(circle at top left, rgba(115, 128, 90, 0.16), transparent 28%),
                radial-gradient(circle at top right, rgba(220, 203, 182, 0.45), transparent 32%),
                linear-gradient(180deg, #fcfaf7 0%, #f6f0e8 100%);
            --grw-card-surface: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(246,240,232,0.96));
            --grw-card-shell: linear-gradient(135deg, rgba(255, 250, 243, 0.98), rgba(246, 238, 226, 0.94));
            --grw-card-border: rgba(103, 90, 71, 0.14);
            --grw-page-border: rgba(103, 90, 71, 0.16);
            --grw-page-text: #f7f0e6;
            --grw-page-muted: #eadfce;
            --grw-text: #2d2a26;
            --grw-muted: #5f564d;
            --grw-label: #6d6358;
            --grw-success-bg: rgba(89, 102, 63, 0.10);
            --grw-success-text: #24482f;
            --grw-button-bg: linear-gradient(135deg, #59663f 0%, #73805a 100%);
            --grw-button-bg-hover: linear-gradient(135deg, #4d5936 0%, #687450 100%);
            --grw-button-text: #ffffff;
            --grw-shadow: 0 20px 50px rgba(65, 53, 39, 0.10);
            --grw-logo-accent: #59663f;
            --grw-uploader-bg: linear-gradient(180deg, rgba(255, 250, 243, 0.98), rgba(244, 236, 226, 0.98));
            --grw-uploader-border: rgba(103, 90, 71, 0.20);
            --grw-uploader-text: #2f2a24;
            --grw-uploader-muted: #64594d;
            --grw-uploader-icon: #59663f;
            --grw-uploader-button-bg: linear-gradient(135deg, #59663f 0%, #73805a 100%);
            --grw-uploader-button-border: rgba(89, 102, 63, 0.32);
            --grw-uploader-button-text: #ffffff;
            --grw-heading-text: #2f2a24;
            --grw-button-disabled-bg: rgba(89, 102, 63, 0.22);
            --grw-button-disabled-text: rgba(255, 255, 255, 0.88);
            --grw-button-disabled-border: rgba(89, 102, 63, 0.16);
            --grw-file-chip-bg: linear-gradient(180deg, rgba(255, 250, 243, 0.99), rgba(244, 236, 226, 0.99));
            --grw-file-chip-border: rgba(103, 90, 71, 0.18);
            --grw-file-chip-text: #2f2a24;
            --grw-file-chip-muted: #64594d;
            --grw-header-bg: rgba(252, 248, 241, 0.78);
            --grw-header-border: rgba(103, 90, 71, 0.18);
            --grw-header-text: #2f2a24;
            --grw-header-icon: #4e463d;
        }

        @media (prefers-color-scheme: dark) {
            :root {
                --grw-page-bg:
                    radial-gradient(circle at top left, rgba(115, 128, 90, 0.16), transparent 28%),
                    radial-gradient(circle at top right, rgba(220, 203, 182, 0.30), transparent 32%),
                    linear-gradient(180deg, #231f1b 0%, #2e2822 100%);
                --grw-card-surface: linear-gradient(180deg, rgba(255,250,244,0.96), rgba(244,236,226,0.97));
                --grw-card-shell: linear-gradient(135deg, rgba(255, 250, 243, 0.98), rgba(244, 236, 226, 0.96));
                --grw-card-border: rgba(95, 82, 63, 0.20);
                --grw-page-border: rgba(95, 82, 63, 0.22);
                --grw-page-text: #f6ecdf;
                --grw-page-muted: #e6d9c8;
                --grw-text: #241f1a;
                --grw-muted: #4d443b;
                --grw-label: #5e554a;
                --grw-success-bg: rgba(89, 102, 63, 0.12);
                --grw-success-text: #23432d;
                --grw-shadow: 0 20px 50px rgba(0, 0, 0, 0.20);
                --grw-uploader-bg: linear-gradient(180deg, rgba(255, 250, 243, 0.98), rgba(244, 236, 226, 0.98));
                --grw-uploader-border: rgba(95, 82, 63, 0.24);
                --grw-uploader-text: #2f2a24;
                --grw-uploader-muted: #64594d;
                --grw-uploader-icon: #59663f;
                --grw-uploader-button-bg: linear-gradient(135deg, #59663f 0%, #73805a 100%);
                --grw-uploader-button-border: rgba(89, 102, 63, 0.34);
                --grw-uploader-button-text: #ffffff;
                --grw-heading-text: #2f2a24;
                --grw-button-disabled-bg: rgba(89, 102, 63, 0.24);
                --grw-button-disabled-text: rgba(255, 255, 255, 0.88);
                --grw-button-disabled-border: rgba(89, 102, 63, 0.18);
                --grw-file-chip-bg: linear-gradient(180deg, rgba(255, 250, 243, 0.99), rgba(244, 236, 226, 0.99));
                --grw-file-chip-border: rgba(95, 82, 63, 0.22);
                --grw-file-chip-text: #2f2a24;
                --grw-file-chip-muted: #64594d;
                --grw-header-bg: rgba(38, 33, 29, 0.72);
                --grw-header-border: rgba(237, 230, 218, 0.16);
                --grw-header-text: #f6ecdf;
                --grw-header-icon: #f0e6d8;
            }
        }

        html, body, [class*="css"] {
            font-family: 'Quicksand', sans-serif;
        }

        html, body {
            color: var(--grw-page-text);
        }

        .stApp {
            background: var(--grw-page-bg);
            color: var(--grw-page-text);
        }

        .block-container {
            padding-top: 4.85rem;
            padding-bottom: 3rem;
            max-width: 1280px;
            color: var(--grw-page-text);
        }

        .grw-logo-wrapper {
            display: flex;
            justify-content: center;
            margin: 0.5rem 0 1.5rem 0;
        }

        [data-testid="stHeader"] {
            background: var(--grw-header-bg) !important;
            border-bottom: 1px solid var(--grw-header-border) !important;
            backdrop-filter: blur(14px);
            -webkit-backdrop-filter: blur(14px);
        }

        [data-testid="stHeader"] *,
        [data-testid="stToolbar"] *,
        [data-testid="stDecoration"] *,
        [data-testid="stStatusWidget"] * {
            color: var(--grw-header-text) !important;
            fill: var(--grw-header-icon) !important;
            stroke: var(--grw-header-icon) !important;
        }

        [data-testid="stToolbar"] button,
        [data-testid="stHeader"] button,
        [data-testid="stHeaderActionElements"] button {
            color: var(--grw-header-text) !important;
            background: rgba(255, 255, 255, 0.06) !important;
            border-radius: 999px !important;
        }

        [data-testid="stToolbar"] button:hover,
        [data-testid="stHeader"] button:hover,
        [data-testid="stHeaderActionElements"] button:hover {
            background: rgba(89, 102, 63, 0.12) !important;
        }

        .grw-logo-card {
            display: inline-flex;
            align-items: center;
            justify-content: center;
            background: var(--grw-card-shell);
            border: 1px solid var(--grw-card-border);
            border-radius: 24px;
            box-shadow: var(--grw-shadow);
            padding: 1rem 1.25rem;
            min-width: 320px;
            max-width: 420px;
        }

        .grw-logo-image {
            width: min(100%, 300px);
            height: auto;
            display: block;
            margin: 0 auto;
        }

        .grw-card,
        .section-card {
            background: var(--grw-card-surface);
            border: 1px solid var(--grw-card-border);
            border-radius: 24px;
            padding: 1.15rem 1.2rem;
            box-shadow: 0 12px 35px rgba(65, 53, 39, 0.06);
            margin-bottom: 1rem;
            backdrop-filter: blur(8px);
            color: var(--grw-text);
        }

        .grw-card.tight,
        .section-card.tight {
            padding: 1rem 1.1rem;
        }

        .grw-card,
        .grw-card *,
        .section-card,
        .section-card * {
            color: var(--grw-text);
        }

        .mini-card-grid {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(170px, 1fr));
            gap: 0.8rem;
            margin-top: 0.9rem;
        }

        .mini-card {
            padding: 0.95rem 1rem;
            border-radius: 18px;
            background: var(--grw-card-surface);
            border: 1px solid var(--grw-card-border);
            color: var(--grw-text);
        }

        .mini-card-label {
            color: var(--grw-label) !important;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 0.35rem;
            font-weight: 700;
        }

        .mini-card-value {
            color: var(--grw-text) !important;
            font-size: 1.02rem;
            font-weight: 700;
            word-break: break-word;
        }

        .feature-list {
            margin: 0.85rem 0 0 0;
            padding-left: 1.1rem;
            color: var(--grw-muted) !important;
        }

        .feature-list li {
            margin-bottom: 0.35rem;
            color: var(--grw-muted) !important;
        }

        .steps-list {
            margin: 0.8rem 0 0 0;
            padding-left: 1.15rem;
            color: var(--grw-muted) !important;
        }

        .steps-list li {
            margin-bottom: 0.4rem;
            color: var(--grw-muted) !important;
        }

        .panel-title {
            color: var(--grw-text) !important;
            font-size: 1.15rem;
            font-weight: 700;
            margin-bottom: 0.2rem;
        }

        .panel-copy {
            color: var(--grw-muted) !important;
            margin-bottom: 0;
        }

        [data-testid="stFileUploader"] {
            background: transparent;
            border-radius: 22px;
            border: none;
            padding: 0.2rem 0;
            color: var(--grw-uploader-text) !important;
        }

        [data-testid="stFileUploader"] label,
        [data-testid="stFileUploader"] > label,
        [data-testid="stFileUploader"] [data-testid="stWidgetLabel"],
        [data-testid="stFileUploader"] [data-testid="stWidgetLabel"] *,
        [data-testid="stFileUploader"] div[data-testid="stMarkdownContainer"],
        [data-testid="stFileUploader"] div[data-testid="stMarkdownContainer"] * {
            color: var(--grw-heading-text) !important;
            font-weight: 700 !important;
        }

        [data-testid="stFileUploaderDropzone"] {
            background: var(--grw-uploader-bg) !important;
            border: 1px dashed var(--grw-uploader-border) !important;
            border-radius: 22px !important;
            padding: 1rem !important;
            box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.35);
        }

        [data-testid="stFileUploaderDropzone"] *,
        [data-testid="stFileUploaderDropzoneInstructions"],
        [data-testid="stFileUploaderDropzoneInstructions"] * {
            color: var(--grw-uploader-text) !important;
            fill: var(--grw-uploader-icon) !important;
        }

        [data-testid="stFileUploaderDropzone"] small,
        [data-testid="stFileUploaderDropzone"] span,
        [data-testid="stFileUploaderDropzoneInstructions"] small,
        [data-testid="stFileUploaderDropzoneInstructions"] span {
            color: var(--grw-uploader-muted) !important;
        }

        [data-testid="stFileUploaderFile"],
        [data-testid="stFileUploaderFile"] *,
        [data-testid="stFileUploader"] small,
        [data-testid="stFileUploader"] [data-testid="stFileUploaderFileName"],
        [data-testid="stFileUploaderDropzone"] section,
        [data-testid="stFileUploaderDropzone"] section * {
            color: var(--grw-uploader-text) !important;
        }

        [data-testid="stFileUploaderFile"] {
            background: var(--grw-file-chip-bg) !important;
            border: 1px solid var(--grw-file-chip-border) !important;
            border-radius: 16px !important;
            box-shadow: 0 8px 20px rgba(65, 53, 39, 0.08) !important;
        }

        [data-testid="stFileUploaderFile"] *,
        [data-testid="stFileUploaderFileName"],
        [data-testid="stFileUploaderFile"] small,
        [data-testid="stFileUploaderFile"] span,
        [data-testid="stFileUploaderFile"] div {
            color: var(--grw-file-chip-text) !important;
            fill: var(--grw-uploader-icon) !important;
            stroke: var(--grw-uploader-icon) !important;
        }

        [data-testid="stFileUploaderFile"] small {
            color: var(--grw-file-chip-muted) !important;
        }

        [data-testid="stFileUploader"] svg,
        [data-testid="stFileUploaderDropzone"] svg {
            color: var(--grw-uploader-icon) !important;
            fill: var(--grw-uploader-icon) !important;
        }

        [data-testid="stBaseButton-secondary"] {
            background: var(--grw-uploader-button-bg) !important;
            border: 1px solid var(--grw-uploader-button-border) !important;
            color: var(--grw-uploader-button-text) !important;
            opacity: 1 !important;
        }

        [data-testid="stBaseButton-secondary"] * {
            color: var(--grw-uploader-button-text) !important;
        }

        [data-testid="stBaseButton-secondary"]:hover {
            background: rgba(255, 250, 243, 0.18) !important;
            border-color: rgba(247, 240, 230, 0.48) !important;
        }

        div[data-testid="stMetric"] {
            background: var(--grw-card-surface);
            border: 1px solid var(--grw-card-border);
            border-radius: 20px;
            padding: 0.8rem 0.9rem;
            box-shadow: 0 10px 30px rgba(65, 53, 39, 0.05);
        }

        div[data-testid="stMetric"] label,
        div[data-testid="stMetric"] [data-testid="stMetricLabel"],
        div[data-testid="stMetric"] [data-testid="stMetricValue"] {
            color: var(--grw-text) !important;
        }

        .stButton > button, .stDownloadButton > button {
            border-radius: 999px;
            border: 1px solid rgba(89, 102, 63, 0.18);
            background: var(--grw-button-bg);
            color: var(--grw-button-text) !important;
            font-weight: 700;
            padding: 0.75rem 1.1rem;
            box-shadow: 0 10px 24px rgba(89, 102, 63, 0.22);
            opacity: 1 !important;
        }

        .stButton > button:hover, .stDownloadButton > button:hover {
            background: var(--grw-button-bg-hover);
        }

        .stButton > button *, .stDownloadButton > button * {
            color: var(--grw-button-text) !important;
        }

        .stButton > button:disabled,
        .stDownloadButton > button:disabled,
        [data-testid="stBaseButton-secondary"]:disabled {
            background: var(--grw-button-disabled-bg) !important;
            border: 1px solid var(--grw-button-disabled-border) !important;
            color: var(--grw-button-disabled-text) !important;
            opacity: 1 !important;
            box-shadow: none !important;
            cursor: not-allowed !important;
        }

        .dataframe {
            border-radius: 18px;
            overflow: hidden;
        }

        .result-path {
            background: var(--grw-card-surface);
            border: 1px solid var(--grw-card-border);
            border-radius: 18px;
            padding: 0.95rem 1rem;
            color: var(--grw-text) !important;
            font-weight: 600;
            box-shadow: 0 10px 24px rgba(65, 53, 39, 0.05);
        }

        .status-note {
            color: var(--grw-muted) !important;
            font-size: 0.92rem;
            font-weight: 600;
            margin-top: 0.55rem;
        }

        .version-note {
            text-align: center;
            color: var(--grw-muted) !important;
            font-size: 0.92rem;
            font-weight: 600;
            margin: -0.25rem 0 1.1rem 0;
        }

        .result-path * {
            color: var(--grw-text) !important;
        }

        .stSuccess, .stSuccess p, .stSuccess div, .stSuccess span {
            color: var(--grw-success-text) !important;
        }

        .stSuccess {
            background: var(--grw-success-bg) !important;
        }

        .stInfo, .stInfo p, .stInfo div, .stInfo span,
        .stWarning, .stWarning p, .stWarning div, .stWarning span,
        .stError, .stError p, .stError div, .stError span {
            color: var(--grw-text) !important;
        }

        h1, h2, h3, h4,
        [data-testid="stMarkdownContainer"] h1,
        [data-testid="stMarkdownContainer"] h2,
        [data-testid="stMarkdownContainer"] h3,
        [data-testid="stMarkdownContainer"] h4 {
            color: var(--grw-heading-text);
        }

        p, li, label, span, div {
            color: inherit;
        }

        [data-testid="collapsedControl"],
        [data-testid="stSidebar"],
        section[data-testid="stSidebar"] {
            display: none !important;
        }

        </style>
        """,
        unsafe_allow_html=True,
    )


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


def resolve_file_details(uploaded_pdf) -> FileResolution:
    customer_name, invoice_number = parse_filename_details(uploaded_pdf.name)
    used_fallback = False

    if customer_name and invoice_number:
        return FileResolution(
            customer_name=customer_name,
            invoice_number=invoice_number,
            used_fallback=used_fallback,
        )

    used_fallback = True
    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_pdf:
        tmp_pdf.write(uploaded_pdf.getvalue())
        fallback_pdf_path = tmp_pdf.name

    try:
        if not customer_name:
            customer_name = extract_customer_name(fallback_pdf_path) or ""
        if not invoice_number:
            invoice_number = extract_order_number(fallback_pdf_path) or ""
    finally:
        os.unlink(fallback_pdf_path)

    return FileResolution(
        customer_name=customer_name or "",
        invoice_number=invoice_number or "",
        used_fallback=used_fallback,
    )


def build_export_rows(priced_items: list[dict], resolution: FileResolution) -> list[dict[str, Any]]:
    export_rows = []
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


def build_preview_dataframe(export_rows: list[dict[str, Any]]) -> pd.DataFrame:
    preview_data = []
    for row in export_rows:
        preview_data.append(
            {
                "Item Number": row.get("Item Number", "NEW"),
                "Description": row.get("Item Description", ""),
                "SKU": row.get("SKU", ""),
                "PK": row.get("PK", 1),
                "Qty": row.get("Qty", row.get("Quantity", 0)),
                "FOB Bottle": f"${row.get('FOB Bottle', row.get('FOB Btl', 0)):.2f}",
                "FOB Case": f"${row.get('FOB Case', 0):.2f}",
                "Frontline": f"${row.get('Frontline', 0)}",
                "Ext Cost": f"${row.get('Ext Cost', 0):.2f}",
                "Ext Price": f"${row.get('Ext Price', 0):.2f}",
                "Markup": row.get("Markup", ""),
            }
        )
    return pd.DataFrame(preview_data)


def render_hero() -> None:
    if not LOGO_PATH.exists():
        return
    st.markdown(
        f'''
        <div class="grw-logo-wrapper">
            <div class="grw-logo-card">
                <img class="grw-logo-image" src="{logo_data_uri(LOGO_PATH)}" alt="GRW Converter Logo" />
            </div>
        </div>
        ''',
        unsafe_allow_html=True,
    )


def render_version_note() -> None:
    st.markdown(
        '<div class="version-note">v0.1 – Internal Testing</div>',
        unsafe_allow_html=True,
    )


def render_intro_panels() -> None:
    left, right = st.columns([1.05, 0.95], gap="large")
    with left:
        st.markdown(
            """
            <div class="section-card tight">
                <div class="panel-title">What this does</div>
                <p class="panel-copy">
                    Converts one GRW invoice PDF into one Stem-ready Excel workbook with parsed line items, pricing, and validation handled automatically.
                </p>
                <ul class="feature-list">
                    <li>One PDF upload</li>
                    <li>One Excel output</li>
                    <li>Browser download for each user</li>
                </ul>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with right:
        st.markdown(
            """
            <div class="section-card tight">
                <div class="panel-title">How to use it</div>
                <p class="panel-copy">
                    Drag in a GRW invoice PDF and the converter takes it from there.
                </p>
                <ol class="steps-list">
                    <li>Upload one GRW PDF.</li>
                    <li>Let the converter process it automatically.</li>
                    <li>Download the finished workbook.</li>
                </ol>
                <p class="panel-copy">
                    Filenames like <strong>Account Name #58672.pdf</strong> work best, but fallback extraction is supported.
                </p>
            </div>
            """,
            unsafe_allow_html=True,
        )


def render_upload_panel() -> None:
    st.markdown(
        """
        <div class="section-card">
            <div class="panel-title">Upload invoice PDF</div>
            <p class="panel-copy">
                Drop in a GRW sales order PDF to generate the workbook immediately.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_empty_state() -> None:
    st.markdown(
        """
        <div class="section-card tight">
            <div class="panel-title">Ready when you are</div>
            <p class="panel-copy">
                Upload a GRW Wine Collection sales order PDF to begin.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_file_details(uploaded_pdf, customer_name: str | None, invoice_number: str | None) -> None:
    st.markdown(
        f"""
        <div class="section-card tight">
            <div class="panel-title">File recognized</div>
            <div class="mini-card-grid">
                <div class="mini-card">
                    <div class="mini-card-label">PDF file</div>
                    <div class="mini-card-value">{uploaded_pdf.name}</div>
                </div>
                <div class="mini-card">
                    <div class="mini-card-label">Account name</div>
                    <div class="mini-card-value">{customer_name or "Needs fallback extraction"}</div>
                </div>
                <div class="mini-card">
                    <div class="mini-card-label">GRW order #</div>
                    <div class="mini-card-value">{invoice_number or "Needs fallback extraction"}</div>
                </div>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_invoice_summary(invoice_summary: dict[str, Any]) -> None:
    if not invoice_summary:
        return

    summary_items: list[tuple[str, str]] = []
    if invoice_summary.get("subtotal") is not None:
        summary_items.append(("Subtotal", f"${invoice_summary['subtotal']:,.2f}"))
    if invoice_summary.get("credit_amount") is not None:
        credit_label = "Credit Applied"
        if invoice_summary.get("credit_date"):
            credit_label = f"Credit Applied ({invoice_summary['credit_date']})"
        summary_items.append((credit_label, f"${invoice_summary['credit_amount']:,.2f}"))
    if invoice_summary.get("paid_amount") is not None:
        summary_items.append(("Paid", f"${invoice_summary['paid_amount']:,.2f}"))
    if invoice_summary.get("balance_due") is not None:
        summary_items.append(("Balance Due", f"${invoice_summary['balance_due']:,.2f}"))

    if not summary_items:
        return

    cards_html = "".join(
        f"""
        <div class="mini-card">
            <div class="mini-card-label">{label}</div>
            <div class="mini-card-value">{value}</div>
        </div>
        """
        for label, value in summary_items
    )

    st.markdown(
        f"""
        <div class="section-card tight">
            <div class="panel-title">Invoice adjustments</div>
            <p class="panel-copy">
                Invoice-level credit and payment details are shown separately from wine setup rows.
            </p>
            <div class="mini-card-grid">
                {cards_html}
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_success_state(result: ConversionSuccess) -> None:
    st.success("Conversion complete. The workbook is ready.")

    total_ext_cost = sum(item.get("ext_cost", 0) for item in result.priced_items)
    total_ext_price = sum(item.get("ext_price", 0) for item in result.priced_items)
    bdx_count = sum(1 for item in result.priced_items if item.get("sku_prefix") == "BDX")

    metric_cols = st.columns(4)
    with metric_cols[0]:
        st.metric("Line Items", len(result.priced_items))
    with metric_cols[1]:
        st.metric("Total Ext Cost", f"${total_ext_cost:,.2f}")
    with metric_cols[2]:
        st.metric("Total Ext Price", f"${total_ext_price:,.2f}")
    with metric_cols[3]:
        st.metric("BDX Items", bdx_count)

    render_invoice_summary(result.invoice_summary)

    st.markdown('<div class="section-card">', unsafe_allow_html=True)
    st.markdown("#### Download outputs")
    st.markdown(
        f'<div class="result-path">{result.excel_filename}</div>',
        unsafe_allow_html=True,
    )
    st.markdown("</div>", unsafe_allow_html=True)

    st.download_button(
        label="Download Excel File",
        data=result.excel_bytes,
        file_name=result.excel_filename,
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
    )

    if result.csv_bytes and result.csv_filename:
        st.download_button(
            label="Download SaasAnt / QuickBooks CSV",
            data=result.csv_bytes,
            file_name=result.csv_filename,
            mime="text/csv",
            use_container_width=True,
        )

    missing = result.debug_info.get("missing_item_numbers", [])
    if missing:
        st.warning(f"Some item numbers were not detected during parsing: {missing}")

    st.markdown("### Extracted line items")
    st.dataframe(
        result.preview_df,
        use_container_width=True,
        hide_index=True,
        height=600,
    )

    with st.expander("Debug details", expanded=False):
        st.json(
            {
                "pages_parsed": result.pages_parsed,
                "invoice_summary": result.invoice_summary,
                "debug_info": result.debug_info,
                "export_row_count": len(result.export_rows),
            }
        )


def build_failure_message(exc: Exception) -> str:
    if isinstance(exc, ValidationError):
        return f"Validation failed: {exc}"
    if isinstance(exc, FileNotFoundError):
        return "A required app file is missing. Please confirm the logo/template files are present in the repo."
    return f"We couldn't process that PDF: {exc}"


def convert_uploaded_pdf(uploaded_pdf, resolution: FileResolution) -> ConversionSuccess:
    progress_bar = st.progress(0)
    status = st.empty()

    status.text("Reading PDF")
    progress_bar.progress(10)

    with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_pdf:
        tmp_pdf.write(uploaded_pdf.getvalue())
        pdf_path = tmp_pdf.name

    try:
        status.text("Extracting line items")
        progress_bar.progress(30)
        parser_debug = os.getenv("GRW_PDF_TRACE", "").strip() == "1"
        try:
            items, pages_parsed, debug_info = parse_grw_pdf(pdf_path, debug=parser_debug)
        except Exception as exc:
            raise RuntimeError(f"Unable to read line items from this PDF. {exc}") from exc

        invoice_summary = extract_invoice_summary(pdf_path)

        if not items:
            raise RuntimeError("No line items were found in the PDF. Please check the file format and try again.")

        status.text("Calculating pricing")
        progress_bar.progress(55)
        priced_items = apply_pricing(items)
        export_rows = build_export_rows(priced_items, resolution)
        preview_df = build_preview_dataframe(export_rows)

        status.text("Validating workbook data")
        progress_bar.progress(75)
        expected_subtotal = invoice_summary.get("subtotal")
        if expected_subtotal is None:
            expected_subtotal = sum(item.get("ext_cost", 0) for item in priced_items)
        validation_result = validate_invoice(priced_items, expected_subtotal)

        status.text("Preparing Excel output")
        progress_bar.progress(88)
        status.text("Building download files")
        progress_bar.progress(96)
        excel_filename, csv_filename = allocate_download_filenames(resolution)
        excel_filename, excel_bytes = build_excel_download_bytes(export_rows, resolution, excel_filename, invoice_summary)
        csv_filename, csv_bytes = build_optional_saasant_csv(export_rows, resolution, csv_filename)
    finally:
        os.unlink(pdf_path)

    progress_bar.progress(100)
    status.empty()

    return ConversionSuccess(
        excel_filename=excel_filename,
        excel_bytes=excel_bytes,
        csv_filename=csv_filename,
        csv_bytes=csv_bytes,
        priced_items=priced_items,
        export_rows=export_rows,
        validation_result=validation_result,
        preview_df=preview_df,
        customer_name=resolution.customer_name,
        invoice_number=resolution.invoice_number,
        invoice_summary=invoice_summary,
        debug_info=debug_info,
        pages_parsed=pages_parsed,
    )


def process_single_upload(uploaded_pdf, resolution: FileResolution) -> ConversionSuccess | ConversionFailure:
    try:
        with st.spinner("Processing invoice..."):
            return convert_uploaded_pdf(uploaded_pdf, resolution)
    except Exception as exc:
        return ConversionFailure(
            message=build_failure_message(exc),
            traceback_text=traceback.format_exc(),
            debug_info={"uploaded_file": uploaded_pdf.name, "resolution": resolution.__dict__},
        )


def main() -> None:
    inject_styles()
    render_hero()
    render_version_note()
    render_intro_panels()
    render_upload_panel()

    uploaded_pdf = st.file_uploader(
        "Upload GRW Invoice PDF",
        type=["pdf"],
        help="Select a GRW Wine Collection sales order PDF.",
    )

    if uploaded_pdf is None:
        render_empty_state()
        return

    try:
        resolution = resolve_file_details(uploaded_pdf)
    except Exception as exc:
        st.error(f"We couldn't inspect that PDF filename/details: {exc}")
        with st.expander("Debug details", expanded=False):
            st.code(traceback.format_exc())
        return
    file_key = uploaded_file_key(uploaded_pdf)

    if resolution.used_fallback:
        st.warning("The filename did not fully identify the account or order number. Using PDF extraction as fallback.")

    render_file_details(uploaded_pdf, resolution.customer_name, resolution.invoice_number)

    if st.session_state.get("grw_active_file_key") != file_key:
        st.session_state["grw_active_file_key"] = file_key
        st.session_state.pop("grw_conversion_result", None)

    cached_result = st.session_state.get("grw_conversion_result")
    if not cached_result or cached_result.get("file_key") != file_key:
        st.info("PDF received. Starting conversion automatically...")
        outcome = process_single_upload(uploaded_pdf, resolution)
        st.session_state["grw_conversion_result"] = {
            "file_key": file_key,
            "outcome": outcome,
        }
        cached_result = st.session_state["grw_conversion_result"]

    outcome = cached_result["outcome"]
    if isinstance(outcome, ConversionFailure):
        st.error(outcome.message)
        if outcome.traceback_text:
            with st.expander("Debug details", expanded=False):
                st.code(outcome.traceback_text)
                if outcome.debug_info:
                    st.json(outcome.debug_info)
        return

    render_success_state(outcome)


if __name__ == "__main__":
    main()
