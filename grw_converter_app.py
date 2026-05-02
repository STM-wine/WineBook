"""
GRW Invoice Converter - Streamlit App

A branded web interface for converting GRW invoice PDFs to Excel templates.
"""

from dataclasses import dataclass
import base64
import hashlib
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
from modules.po_tools.grw_invoice_converter.parser import parse_grw_pdf
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
    validation_result: dict[str, Any]
    preview_df: pd.DataFrame
    customer_name: str
    invoice_number: str
    debug_info: dict[str, Any]
    pages_parsed: Any


@dataclass
class ConversionFailure:
    message: str
    traceback_text: str | None = None


def uploaded_file_key(uploaded_pdf) -> str:
    uploaded_pdf.seek(0)
    file_bytes = uploaded_pdf.getvalue()
    file_digest = hashlib.sha256(file_bytes).hexdigest()[:16]
    parser_path = Path(parse_grw_pdf.__code__.co_filename)
    parser_mtime = int(parser_path.stat().st_mtime) if parser_path.exists() else 0
    return f"{uploaded_pdf.name}:{file_digest}:{parser_mtime}"


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
    items: list[dict[str, Any]],
    resolution: FileResolution,
    excel_filename: str,
) -> tuple[str, bytes]:
    with tempfile.TemporaryDirectory() as temp_dir:
        temp_output_path = Path(temp_dir) / excel_filename
        output_file = write_to_updated_template(
            items=items,
            template_path=str(TEMPLATE_PATH),
            output_path=str(temp_output_path),
            invoice_number=resolution.invoice_number,
            customer_name=resolution.customer_name,
        )
        excel_bytes = Path(output_file).read_bytes()
    return excel_filename, excel_bytes


def build_optional_saasant_csv(
    items: list[dict[str, Any]],
    resolution: FileResolution,
    csv_filename: str,
) -> tuple[str | None, bytes | None]:
    _ = items
    _ = resolution
    return csv_filename, None


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
            --grw-uploader-bg: linear-gradient(180deg, rgba(58, 51, 44, 0.96), rgba(42, 36, 31, 0.98));
            --grw-uploader-border: rgba(237, 230, 218, 0.30);
            --grw-uploader-text: #f7f0e6;
            --grw-uploader-muted: #e5d9c9;
            --grw-uploader-icon: #f3eadc;
            --grw-uploader-button-bg: rgba(255, 250, 243, 0.10);
            --grw-uploader-button-border: rgba(247, 240, 230, 0.35);
            --grw-uploader-button-text: #fff9f1;
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
                --grw-uploader-bg: linear-gradient(180deg, rgba(57, 49, 43, 0.98), rgba(39, 33, 29, 0.99));
                --grw-uploader-border: rgba(237, 230, 218, 0.26);
                --grw-uploader-text: #f8efe3;
                --grw-uploader-muted: #e8ddce;
                --grw-uploader-icon: #f5ebdf;
                --grw-uploader-button-bg: rgba(255, 250, 243, 0.12);
                --grw-uploader-button-border: rgba(247, 240, 230, 0.34);
                --grw-uploader-button-text: #fffaf3;
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
            padding-top: 1.4rem;
            padding-bottom: 3rem;
            max-width: 1280px;
            color: var(--grw-page-text);
        }

        .grw-logo-wrapper {
            display: flex;
            justify-content: center;
            margin: 0.25rem 0 1.5rem 0;
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

        [data-testid="stFileUploader"] label {
            color: var(--grw-page-text) !important;
        }

        [data-testid="stFileUploaderDropzone"] {
            background: var(--grw-uploader-bg) !important;
            border: 1px dashed var(--grw-uploader-border) !important;
            border-radius: 22px !important;
            padding: 1rem !important;
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

        [data-testid="stFileUploader"] svg,
        [data-testid="stFileUploaderDropzone"] svg {
            color: var(--grw-uploader-icon) !important;
            fill: var(--grw-uploader-icon) !important;
        }

        [data-testid="stBaseButton-secondary"] {
            background: var(--grw-uploader-button-bg) !important;
            border: 1px solid var(--grw-uploader-button-border) !important;
            color: var(--grw-uploader-button-text) !important;
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
            border: none;
            background: var(--grw-button-bg);
            color: var(--grw-button-text) !important;
            font-weight: 700;
            padding: 0.75rem 1.1rem;
            box-shadow: 0 10px 24px rgba(89, 102, 63, 0.22);
        }

        .stButton > button:hover, .stDownloadButton > button:hover {
            background: var(--grw-button-bg-hover);
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

        h1, h2, h3, h4 {
            color: var(--grw-page-text);
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


def build_preview_dataframe(priced_items: list[dict]) -> pd.DataFrame:
    preview_data = []
    for item in priced_items:
        preview_data.append(
            {
                "Description": item.get("description", ""),
                "SKU": item.get("sku_prefix", ""),
                "PK": item.get("pack_size", 1),
                "Qty": item.get("quantity", 0),
                "FOB Bottle": f"${item.get('fob_bottle', 0):.2f}",
                "FOB Case": f"${item.get('fob_case', 0):.2f}",
                "Frontline": f"${item.get('frontline', 0)}",
                "Ext Cost": f"${item.get('ext_cost', 0):.2f}",
                "Ext Price": f"${item.get('ext_price', 0):.2f}",
                "Markup": "15%" if item.get("sku_prefix") == "BDX" else "10%",
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
    else:
        st.markdown(
            '<div class="status-note">SaasAnt / QuickBooks CSV export is not available in this build yet.</div>',
            unsafe_allow_html=True,
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
        items, pages_parsed, debug_info = parse_grw_pdf(pdf_path, debug=parser_debug)

        if not items:
            raise RuntimeError("No line items were found in the PDF. Please check the file format and try again.")

        status.text("Calculating pricing")
        progress_bar.progress(55)
        priced_items = apply_pricing(items)
        preview_df = build_preview_dataframe(priced_items)

        status.text("Validating workbook data")
        progress_bar.progress(75)
        expected_subtotal = sum(item.get("ext_cost", 0) for item in priced_items)
        validation_result = validate_invoice(priced_items, expected_subtotal)

        status.text("Preparing Excel output")
        progress_bar.progress(88)
        status.text("Building download files")
        progress_bar.progress(96)
        excel_filename, csv_filename = allocate_download_filenames(resolution)
        excel_filename, excel_bytes = build_excel_download_bytes(priced_items, resolution, excel_filename)
        csv_filename, csv_bytes = build_optional_saasant_csv(priced_items, resolution, csv_filename)
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
        validation_result=validation_result,
        preview_df=preview_df,
        customer_name=resolution.customer_name,
        invoice_number=resolution.invoice_number,
        debug_info=debug_info,
        pages_parsed=pages_parsed,
    )


def process_single_upload(uploaded_pdf, resolution: FileResolution) -> ConversionSuccess | ConversionFailure:
    try:
        with st.spinner("Processing invoice..."):
            return convert_uploaded_pdf(uploaded_pdf, resolution)
    except ValidationError as exc:
        return ConversionFailure(message=f"Validation failed: {exc}")
    except Exception as exc:
        return ConversionFailure(
            message=f"Unexpected error: {exc}",
            traceback_text=traceback.format_exc(),
        )


def main() -> None:
    inject_styles()
    render_hero()
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

    resolution = resolve_file_details(uploaded_pdf)
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
            with st.expander("Technical traceback"):
                st.code(outcome.traceback_text)
        return

    render_success_state(outcome)


if __name__ == "__main__":
    main()
