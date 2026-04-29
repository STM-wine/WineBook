"""
GRW Invoice Converter - Streamlit App

A branded web interface for converting GRW invoice PDFs to Excel templates.
"""

import os
import re
import tempfile
import traceback
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


LOGO_PATH = Path(__file__).parent / "logo" / "StemWineCoLogo.png"
OUTPUT_DIR = Path(os.path.expanduser("~")) / "Documents" / "Stem" / "PO's" / "GRW"
TEMPLATE_PATH = (
    Path(__file__).parent
    / "modules"
    / "po_tools"
    / "grw_invoice_converter"
    / "templates"
    / "GRW_Template_Updated.xlsx"
)


def uploaded_file_key(uploaded_pdf) -> str:
    size = getattr(uploaded_pdf, "size", None)
    return f"{uploaded_pdf.name}:{size}"


def inject_styles() -> None:
    st.markdown(
        """
        <style>
        @import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@400;500;600;700&display=swap');

        :root {
            --wb-ink: #2d2a26;
            --wb-olive: #59663f;
            --wb-olive-soft: #73805a;
            --wb-sand: #efe6da;
            --wb-sand-deep: #dccbb6;
            --wb-cream: #fbf7f1;
            --wb-card: rgba(255, 252, 247, 0.88);
            --wb-line: rgba(103, 90, 71, 0.16);
            --wb-shadow: 0 20px 50px rgba(65, 53, 39, 0.10);
        }

        html, body, [class*="css"] {
            font-family: 'Quicksand', sans-serif;
        }

        .stApp {
            background:
                radial-gradient(circle at top left, rgba(115, 128, 90, 0.16), transparent 28%),
                radial-gradient(circle at top right, rgba(220, 203, 182, 0.45), transparent 32%),
                linear-gradient(180deg, #fcfaf7 0%, #f6f0e8 100%);
        }

        .block-container {
            padding-top: 1.4rem;
            padding-bottom: 3rem;
            max-width: 1280px;
        }

        [data-testid="stSidebar"] {
            background: linear-gradient(180deg, #f6efe5 0%, #fdf9f4 100%);
            border-right: 1px solid var(--wb-line);
        }

        .hero-shell {
            border: 1px solid var(--wb-line);
            background:
                linear-gradient(135deg, rgba(255, 250, 243, 0.98), rgba(246, 238, 226, 0.94));
            border-radius: 28px;
            padding: 1.4rem 1.5rem;
            box-shadow: var(--wb-shadow);
            margin-bottom: 1.25rem;
        }

        .hero-kicker {
            display: inline-block;
            color: var(--wb-olive);
            background: rgba(115, 128, 90, 0.12);
            border: 1px solid rgba(115, 128, 90, 0.18);
            padding: 0.3rem 0.7rem;
            border-radius: 999px;
            font-size: 0.82rem;
            font-weight: 700;
            letter-spacing: 0.02em;
            text-transform: uppercase;
        }

        .hero-title {
            color: var(--wb-ink);
            font-size: 2.5rem;
            line-height: 1.02;
            margin: 0.8rem 0 0.55rem 0;
            font-weight: 700;
        }

        .hero-copy {
            color: #544c44;
            font-size: 1.05rem;
            margin: 0;
            max-width: 48rem;
        }

        .section-card {
            background: var(--wb-card);
            border: 1px solid var(--wb-line);
            border-radius: 24px;
            padding: 1.15rem 1.2rem;
            box-shadow: 0 12px 35px rgba(65, 53, 39, 0.06);
            margin-bottom: 1rem;
            backdrop-filter: blur(8px);
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
            background: linear-gradient(180deg, rgba(255,255,255,0.92), rgba(246,240,232,0.92));
            border: 1px solid rgba(103, 90, 71, 0.12);
        }

        .mini-card-label {
            color: #6d6358;
            font-size: 0.8rem;
            text-transform: uppercase;
            letter-spacing: 0.04em;
            margin-bottom: 0.35rem;
            font-weight: 700;
        }

        .mini-card-value {
            color: var(--wb-ink);
            font-size: 1.02rem;
            font-weight: 700;
            word-break: break-word;
        }

        .feature-list {
            margin: 0.85rem 0 0 0;
            padding-left: 1.1rem;
            color: #544c44;
        }

        .feature-list li {
            margin-bottom: 0.35rem;
        }

        .panel-title {
            color: var(--wb-ink);
            font-size: 1.15rem;
            font-weight: 700;
            margin-bottom: 0.2rem;
        }

        .panel-copy {
            color: #62584e;
            margin-bottom: 0;
        }

        [data-testid="stFileUploader"] {
            background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(247,241,233,0.96));
            border-radius: 22px;
            border: 1px dashed rgba(89, 102, 63, 0.35);
            padding: 0.4rem;
        }

        div[data-testid="stMetric"] {
            background: linear-gradient(180deg, rgba(255,255,255,0.95), rgba(247,241,233,0.96));
            border: 1px solid rgba(103, 90, 71, 0.12);
            border-radius: 20px;
            padding: 0.8rem 0.9rem;
            box-shadow: 0 10px 30px rgba(65, 53, 39, 0.05);
        }

        .stButton > button, .stDownloadButton > button {
            border-radius: 999px;
            border: none;
            background: linear-gradient(135deg, #59663f 0%, #73805a 100%);
            color: white;
            font-weight: 700;
            padding: 0.75rem 1.1rem;
            box-shadow: 0 10px 24px rgba(89, 102, 63, 0.22);
        }

        .stButton > button:hover, .stDownloadButton > button:hover {
            background: linear-gradient(135deg, #4d5936 0%, #687450 100%);
        }

        .dataframe {
            border-radius: 18px;
            overflow: hidden;
        }

        .result-path {
            background: rgba(89, 102, 63, 0.08);
            border: 1px solid rgba(89, 102, 63, 0.14);
            border-radius: 18px;
            padding: 0.95rem 1rem;
            color: #3d4332;
            font-weight: 600;
        }

        @media (max-width: 900px) {
            .hero-title {
                font-size: 2rem;
            }
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


def build_preview_dataframe(priced_items: list[dict]) -> pd.DataFrame:
    preview_data = []
    for item in priced_items:
        preview_data.append(
            {
                "Description": item.get("description", "")[:60],
                "SKU": item.get("sku_prefix", ""),
                "PK": item.get("pack_size", 1),
                "Qty": item.get("quantity", 0),
                "FOB Bottle": f"${item.get('fob_bottle', 0):.2f}",
                "Frontline": f"${item.get('frontline', 0)}",
                "Ext Cost": f"${item.get('ext_cost', 0):.2f}",
                "Markup": "15%" if item.get("sku_prefix") == "BDX" else "10%",
            }
        )
    return pd.DataFrame(preview_data)


def render_sidebar() -> None:
    with st.sidebar:
        if LOGO_PATH.exists():
            st.image(str(LOGO_PATH), use_column_width=True)

        st.markdown("### GRW Workflow")
        st.markdown(
            """
            1. Upload a GRW sales order PDF.
            2. Review the parsed account and order number.
            3. Convert and validate the workbook.
            4. Download the finished Excel file or use the saved local copy.
            """
        )

        st.markdown("### Output")
        st.code(str(OUTPUT_DIR))

        st.markdown("### Pricing Rules")
        st.markdown(
            """
            - `BDX`: `ceil(FOB Bottle × 1.15)`
            - Others: `ceil(FOB Bottle × 1.15 / 1.05)`
            """
        )

        st.markdown("### Why This Exists")
        st.caption(
            "This utility stays separate for focused development, but the visual system is being brought closer to the main WineBook product."
        )


def render_hero() -> None:
    left, right = st.columns([1, 3])
    with left:
        if LOGO_PATH.exists():
            st.image(str(LOGO_PATH), use_column_width=True)
    with right:
        st.markdown(
            """
            <div class="hero-shell">
                <div class="hero-kicker">Stem Wine Company</div>
                <div class="hero-title">GRW Invoice Converter</div>
                <p class="hero-copy">
                    Turn GRW sales order PDFs into polished Stem-ready Excel templates with validated pricing,
                    clean item formatting, and a faster buyer workflow.
                </p>
            </div>
            """,
            unsafe_allow_html=True,
        )


def render_intro_panels() -> None:
    left, right = st.columns([1.35, 1], gap="large")
    with left:
        st.markdown(
            """
            <div class="section-card">
                <div class="panel-title">What the converter handles</div>
                <p class="panel-copy">
                    The workflow is already strong. This page keeps the same conversion logic while giving the tool a more polished,
                    production-ready surface inside the broader WineBook ecosystem.
                </p>
                <ul class="feature-list">
                    <li>Extracts GRW PDF line items</li>
                    <li>Applies Stem pricing logic automatically</li>
                    <li>Writes into the updated GRW workbook template</li>
                    <li>Saves a local copy and offers a direct download</li>
                </ul>
            </div>
            """,
            unsafe_allow_html=True,
        )
    with right:
        st.markdown(
            """
            <div class="section-card">
                <div class="panel-title">Ready-to-ship expectations</div>
                <p class="panel-copy">
                    Best results come from GRW sales order PDFs with a filename like
                    <strong>Account Name #58672.pdf</strong>. The app can fall back to PDF extraction when needed.
                </p>
                <div class="mini-card-grid">
                    <div class="mini-card">
                        <div class="mini-card-label">Default output</div>
                        <div class="mini-card-value">Local save + download</div>
                    </div>
                    <div class="mini-card">
                        <div class="mini-card-label">Supported packs</div>
                        <div class="mini-card-value">PK03, 3-Pack, 6-Pack</div>
                    </div>
                    <div class="mini-card">
                        <div class="mini-card-label">Default size</div>
                        <div class="mini-card-value">750ml</div>
                    </div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )


def render_upload_panel() -> None:
    st.markdown(
        """
        <div class="section-card">
            <div class="panel-title">Upload a GRW invoice PDF</div>
            <p class="panel-copy">
                Drop in a GRW sales order PDF to preview the parsed output, validate pricing, and generate the Excel workbook.
            </p>
        </div>
        """,
        unsafe_allow_html=True,
    )


def render_empty_state() -> None:
    st.info("Upload a GRW invoice PDF to begin.")

    col1, col2 = st.columns(2, gap="large")
    with col1:
        with st.expander("Expected PDF format"):
            st.markdown(
                """
                - GRW Wine Collection sales order PDFs
                - Items with SKU prefixes like `BDX`, `BUR`, `ITY`, `USR`
                - Pack sizes such as `PK03`, `3-Pack`, `6-Pack`
                - Vintage years like `1998` or `2022`
                - Bottle sizes with `750ml` as the default fallback
                """
            )
    with col2:
        with st.expander("Template output columns"):
            st.markdown(
                """
                - Item Description
                - GRW Order #
                - PK
                - Quantity
                - FOB Btl
                - Frontline
                - Account
                - FOB Case
                - Ext Cost
                """
            )


def render_file_details(uploaded_pdf, customer_name: str | None, invoice_number: str | None) -> None:
    st.markdown(
        f"""
        <div class="section-card">
            <div class="panel-title">File recognized</div>
            <p class="panel-copy">
                Review the parsed details below before running the conversion.
            </p>
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

    with st.expander("Filename parsing details"):
        st.write(f"Uploaded filename: `{uploaded_pdf.name}`")
        st.write(f"Parsed account name: `{customer_name}`")
        st.write(f"Parsed GRW order number: `{invoice_number}`")
        if customer_name and invoice_number:
            st.write(f"Final output filename: `{customer_name} GRW {invoice_number}.xlsx`")


def render_success_state(
    output_file: str,
    priced_items: list[dict],
    validation_result: dict,
    preview_df: pd.DataFrame,
    customer_name: str,
    invoice_number: str,
    debug_info: dict,
    pages_parsed,
) -> None:
    st.success("Conversion complete. The workbook is ready.")

    total_ext_cost = sum(item.get("ext_cost", 0) for item in priced_items)
    total_ext_price = sum(item.get("ext_price", 0) for item in priced_items)
    bdx_count = sum(1 for item in priced_items if item.get("sku_prefix") == "BDX")

    metric_cols = st.columns(4)
    with metric_cols[0]:
        st.metric("Line Items", len(priced_items))
    with metric_cols[1]:
        st.metric("Total Ext Cost", f"${total_ext_cost:,.2f}")
    with metric_cols[2]:
        st.metric("Total Ext Price", f"${total_ext_price:,.2f}")
    with metric_cols[3]:
        st.metric("BDX Items", bdx_count)

    st.markdown('<div class="section-card">', unsafe_allow_html=True)
    st.markdown("#### Saved workbook")
    st.markdown(
        f'<div class="result-path">{output_file}</div>',
        unsafe_allow_html=True,
    )
    st.markdown("</div>", unsafe_allow_html=True)

    with open(output_file, "rb") as output_handle:
        excel_data = output_handle.read()

    st.download_button(
        label="Download Excel File",
        data=excel_data,
        file_name=Path(output_file).name,
        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        use_container_width=True,
    )

    results_left, results_right = st.columns([1.55, 1], gap="large")
    with results_left:
        st.markdown("### Extracted line items")
        st.dataframe(preview_df, use_container_width=True, hide_index=True)
    with results_right:
        st.markdown("### Conversion details")
        st.markdown(
            f"""
            <div class="section-card">
                <div class="mini-card-grid">
                    <div class="mini-card">
                        <div class="mini-card-label">Customer</div>
                        <div class="mini-card-value">{customer_name}</div>
                    </div>
                    <div class="mini-card">
                        <div class="mini-card-label">Order #</div>
                        <div class="mini-card-value">{invoice_number}</div>
                    </div>
                    <div class="mini-card">
                        <div class="mini-card-label">Pages parsed</div>
                        <div class="mini-card-value">{pages_parsed}</div>
                    </div>
                    <div class="mini-card">
                        <div class="mini-card-label">Validation</div>
                        <div class="mini-card-value">{len(validation_result.get('checks_passed', []))} checks passed</div>
                    </div>
                </div>
            </div>
            """,
            unsafe_allow_html=True,
        )

    with st.expander("Validation details"):
        for check in validation_result.get("checks_passed", []):
            st.success(check)

        left, right = st.columns(2)
        with left:
            st.metric("Validated total ext cost", f"${validation_result.get('total_ext_cost', 0):.2f}")
        with right:
            st.metric("Validated line count", validation_result.get("line_count", 0))

    with st.expander("Technical details"):
        st.write(f"APP PARSED ITEMS COUNT: {len(priced_items)}")
        st.write(f"PDF page count: {debug_info.get('pdf_page_count', 'N/A')}")
        st.write(f"Pages parsed: {pages_parsed}")
        st.write(f"Items per page: {debug_info.get('items_per_page', {})}")
        st.write(f"First item number: {debug_info.get('first_item_number', 'N/A')}")
        st.write(f"Last item number: {debug_info.get('last_item_number', 'N/A')}")
        missing = debug_info.get("missing_item_numbers", [])
        if missing:
            st.warning(f"Missing item numbers: {missing}")


def run_conversion(uploaded_pdf, customer_name: str, invoice_number: str) -> dict:
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
        items, pages_parsed, debug_info = parse_grw_pdf(pdf_path, debug=True)

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
        OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

        output_filename = f"{customer_name} GRW {invoice_number}.xlsx"
        output_path = OUTPUT_DIR / output_filename
        counter = 1
        original_path = output_path
        while output_path.exists():
            output_path = original_path.parent / f"{original_path.stem} ({counter}){original_path.suffix}"
            counter += 1

        status.text("Writing Excel workbook")
        progress_bar.progress(96)
        output_file = write_to_updated_template(
            items=priced_items,
            template_path=str(TEMPLATE_PATH),
            output_path=str(output_path),
            invoice_number=invoice_number,
            customer_name=customer_name,
        )
    finally:
        os.unlink(pdf_path)

    progress_bar.progress(100)
    status.empty()

    return {
        "output_file": output_file,
        "priced_items": priced_items,
        "validation_result": validation_result,
        "preview_df": preview_df,
        "customer_name": customer_name,
        "invoice_number": invoice_number,
        "debug_info": debug_info,
        "pages_parsed": pages_parsed,
    }


def main() -> None:
    inject_styles()
    render_sidebar()
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

    customer_name, invoice_number = parse_filename_details(uploaded_pdf.name)
    file_key = uploaded_file_key(uploaded_pdf)

    if not customer_name or not invoice_number:
        st.warning("The filename did not fully identify the account or order number. Using PDF extraction as fallback.")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp_pdf:
            tmp_pdf.write(uploaded_pdf.getvalue())
            fallback_pdf_path = tmp_pdf.name

        try:
            if not customer_name:
                customer_name = extract_customer_name(fallback_pdf_path)
            if not invoice_number:
                invoice_number = extract_order_number(fallback_pdf_path)
        finally:
            os.unlink(fallback_pdf_path)

    render_file_details(uploaded_pdf, customer_name, invoice_number)

    if st.session_state.get("grw_active_file_key") != file_key:
        st.session_state["grw_active_file_key"] = file_key
        st.session_state.pop("grw_conversion_result", None)
        st.session_state.pop("grw_conversion_error", None)
        st.session_state.pop("grw_conversion_traceback", None)

    if st.session_state.get("grw_conversion_result", {}).get("file_key") != file_key:
        st.info("PDF received. Starting conversion automatically...")
        try:
            with st.spinner("Processing invoice..."):
                result = run_conversion(uploaded_pdf, customer_name or "", invoice_number or "")
            result["file_key"] = file_key
            st.session_state["grw_conversion_result"] = result
            st.session_state.pop("grw_conversion_error", None)
            st.session_state.pop("grw_conversion_traceback", None)
        except ValidationError as exc:
            st.session_state["grw_conversion_error"] = f"Validation failed: {exc}"
            st.session_state.pop("grw_conversion_traceback", None)
        except Exception as exc:
            st.session_state["grw_conversion_error"] = f"Unexpected error: {exc}"
            st.session_state["grw_conversion_traceback"] = traceback.format_exc()

    error_message = st.session_state.get("grw_conversion_error")
    if error_message:
        st.error(error_message)
        if st.session_state.get("grw_conversion_traceback"):
            with st.expander("Technical traceback"):
                st.code(st.session_state["grw_conversion_traceback"])
        return

    result = st.session_state.get("grw_conversion_result")
    if result and result.get("file_key") == file_key:
        render_success_state(
            output_file=result["output_file"],
            priced_items=result["priced_items"],
            validation_result=result["validation_result"],
            preview_df=result["preview_df"],
            customer_name=result["customer_name"],
            invoice_number=result["invoice_number"],
            debug_info=result["debug_info"],
            pages_parsed=result["pages_parsed"],
        )


if __name__ == "__main__":
    main()
