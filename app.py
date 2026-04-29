import streamlit as st
import os
import traceback
from datetime import datetime, timedelta
from stem_order.core import normalize_planning_sku
from stem_order.dashboard import (
    california_truck_summary,
    dashboard_metrics,
    filter_recommendations,
    format_dashboard_dataframe,
    location_summary,
    po_export_dataframe,
    recommendations_to_dataframe,
    supplier_summary,
)
from stem_order.ingest import load_importers_csv
from stem_order.pipeline import build_ordering_pipeline
from stem_order.supabase_repository import SupabaseRepository


def uploaded_file_size(uploaded_file):
    if hasattr(uploaded_file, "size"):
        return uploaded_file.size
    if hasattr(uploaded_file, "getbuffer"):
        return len(uploaded_file.getbuffer())
    return ""


# Set page configuration - must be first Streamlit command
st.set_page_config(
    page_title="Stock That Matters",
    page_icon=" bottles:",
    layout="wide"
)

# Custom CSS for warm hospitality theme
st.markdown("""
<style>
@import url('https://fonts.googleapis.com/css2?family=Quicksand:wght@300;400;500;600;700&display=swap');

/* Enhanced Color System for Premium Wine Dashboard */
:root {
    --soft-black: #2C2C2C;
    --charcoal: #3A3A3A;
    --deep-olive: #5A6B3E;
    --muted-green: #7A8A5F;
    --warm-brown: #8B7355;
    --taupe: #A0957B;
    --sand: #D4C5B9;
    --beige: #F5F2ED;
    --off-white: #FAF8F6;
    --white: #FFFFFF;
    --light-sand: #E8E0D5;
    --warm-white: #FFFCF8;
    --subtle-shadow: rgba(0, 0, 0, 0.08);
    --card-shadow: 0 4px 12px rgba(0, 0, 0, 0.06);
    --hover-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
}

/* Global Styles */
body {
    font-family: 'Quicksand', sans-serif !important;
    background: linear-gradient(to bottom, var(--warm-white), var(--white)) !important;
    color: var(--soft-black) !important;
    line-height: 1.6 !important;
}

/* Main Content Area */
.stApp {
    background: linear-gradient(to bottom, var(--warm-white), var(--white)) !important;
}

.block-container {
    padding-top: 1.5rem !important;
    padding-bottom: 3rem !important;
    max-width: 1400px !important;
}

/* Enhanced Typography */
* {
    font-family: 'Quicksand', sans-serif !important;
}

/* Enhanced Typography */
h1 {
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 600 !important;
    color: var(--soft-black) !important;
    font-size: 2.2rem !important;
    margin-bottom: 0.5rem !important;
    letter-spacing: -0.5px !important;
}

h2 {
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 500 !important;
    color: var(--charcoal) !important;
    font-size: 1.6rem !important;
    margin-top: 2rem !important;
    margin-bottom: 1rem !important;
    letter-spacing: -0.3px !important;
}

h3 {
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 500 !important;
    color: var(--charcoal) !important;
    font-size: 1.3rem !important;
    letter-spacing: -0.2px !important;
}

h4 {
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 500 !important;
    color: var(--charcoal) !important;
    font-size: 1.1rem !important;
    letter-spacing: -0.1px !important;
}

p, span, label {
    font-family: 'Quicksand', sans-serif !important;
    color: var(--charcoal) !important;
    font-weight: 400 !important;
}

/* Enhanced Sidebar */
.css-1d391kg, .css-1lcbmhc {
    background: linear-gradient(to bottom, var(--off-white), var(--warm-white)) !important;
    border-right: 1px solid var(--light-sand) !important;
    box-shadow: 2px 0 8px var(--subtle-shadow) !important;
}

/* Sidebar Header */
.sidebar-header {
    background: linear-gradient(135deg, var(--deep-olive), var(--muted-green)) !important;
    padding: 2rem 1.5rem !important;
    margin: -1rem -1rem 2rem -1rem !important;
    border-radius: 0 !important;
    border-bottom: none !important;
    box-shadow: 0 4px 12px rgba(90, 107, 62, 0.15) !important;
}

.sidebar-header h3 {
    color: var(--white) !important;
    font-weight: 600 !important;
    margin: 0 !important;
    font-size: 1.4rem !important;
    letter-spacing: -0.2px !important;
    text-shadow: 0 1px 2px rgba(0, 0, 0, 0.1) !important;
}

/* Dark Mode Adaptations */
@media (prefers-color-scheme: dark) {
    /* Sidebar background in dark mode */
    .css-1d391kg, .css-1lcbmhc, [data-testid="stSidebar"] {
        background: linear-gradient(to bottom, #2D2D2D, #1F1F1F) !important;
        border-right: 1px solid #404040 !important;
    }

    /* Sidebar text labels */
    [data-testid="stSidebar"] label,
    [data-testid="stSidebar"] .stMarkdown,
    [data-testid="stSidebar"] p,
    [data-testid="stSidebar"] span {
        color: #E8E8E8 !important;
    }

    /* File uploader text */
    [data-testid="stSidebar"] .stFileUploader label {
        color: #E8E8E8 !important;
    }

    /* Upload area in dark mode */
    [data-testid="stSidebar"] .stFileUploader {
        background: linear-gradient(to bottom, #3A3A3A, #2D2D2D) !important;
        border-color: #555555 !important;
    }

    /* Upload area text */
    [data-testid="stSidebar"] .stFileUploader p,
    [data-testid="stSidebar"] .stFileUploader span,
    [data-testid="stSidebar"] .stFileUploader small {
        color: #CCCCCC !important;
    }

    /* Small text in upload area */
    [data-testid="stSidebar"] .stFileUploader [data-testid="stText"] {
        color: #AAAAAA !important;
    }

    /* Main content area in dark mode */
    body, .stApp, [data-testid="stAppViewContainer"] {
        background: linear-gradient(to bottom, #1F1F1F, #2D2D2D) !important;
    }

    /* Main content text */
    .stApp h1, .stApp h2, .stApp h3, .stApp h4,
    .stApp p, .stApp span, .stApp label,
    .stApp div:not(.sidebar-header):not(.sidebar-header h3) {
        color: #E8E8E8 !important;
    }

    /* Header title in dark mode */
    .stApp h1 {
        color: #FFFFFF !important;
    }

    /* Subtitle text */
    .stApp .subtitle, .stApp p {
        color: #CCCCCC !important;
    }

    /* Section dividers */
    .section-divider {
        background: linear-gradient(90deg, transparent, #555555, transparent) !important;
    }

    /* Info boxes */
    .stApp .stInfo {
        background: linear-gradient(135deg, #2D4A3E, #1F3A2F) !important;
        border-left-color: var(--deep-olive) !important;
    }

    /* Dataframe/table in dark mode */
    .stApp .stDataFrame, .stApp [data-testid="stDataFrame"] {
        background: #2D2D2D !important;
    }

    /* Table text */
    .stApp .stDataFrame td, .stApp .stDataFrame th,
    .stApp [data-testid="stDataFrame"] td, .stApp [data-testid="stDataFrame"] th {
        color: #E8E8E8 !important;
    }

    /* Invert logo to white in dark mode */
    .stApp img {
        filter: brightness(0) invert(1) !important;
    }
}

/* Enhanced File Upload Area */
.stFileUploader {
    background: linear-gradient(to bottom, var(--white), var(--off-white)) !important;
    border: 2px dashed var(--sand) !important;
    border-radius: 16px !important;
    padding: 2rem !important;
    margin-bottom: 1.5rem !important;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
    box-shadow: var(--card-shadow) !important;
    position: relative !important;
    overflow: hidden !important;
}

.stFileUploader::before {
    content: '' !important;
    position: absolute !important;
    top: 0 !important;
    left: 0 !important;
    right: 0 !important;
    height: 4px !important;
    background: linear-gradient(90deg, var(--deep-olive), var(--muted-green)) !important;
    opacity: 0 !important;
    transition: opacity 0.3s ease !important;
}

.stFileUploader:hover {
    border-color: var(--deep-olive) !important;
    background: linear-gradient(to bottom, var(--off-white), var(--white)) !important;
    transform: translateY(-2px) !important;
    box-shadow: var(--hover-shadow) !important;
}

.stFileUploader:hover::before {
    opacity: 1 !important;
}

.stFileUploader label {
    color: var(--charcoal) !important;
    font-weight: 500 !important;
    font-family: 'Quicksand', sans-serif !important;
    font-size: 0.95rem !important;
    letter-spacing: 0.2px !important;
}

/* Enhanced Buttons */
.stButton > button {
    background: linear-gradient(135deg, var(--deep-olive), var(--muted-green)) !important;
    color: var(--white) !important;
    border: none !important;
    border-radius: 12px !important;
    padding: 0.875rem 2rem !important;
    font-weight: 500 !important;
    font-family: 'Quicksand', sans-serif !important;
    font-size: 0.95rem !important;
    letter-spacing: 0.3px !important;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
    box-shadow: 0 4px 12px rgba(90, 107, 62, 0.25) !important;
    position: relative !important;
    overflow: hidden !important;
}

.stButton > button::before {
    content: '' !important;
    position: absolute !important;
    top: 0 !important;
    left: -100% !important;
    width: 100% !important;
    height: 100% !important;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent) !important;
    transition: left 0.6s ease !important;
}

.stButton > button:hover {
    background: linear-gradient(135deg, var(--muted-green), var(--deep-olive)) !important;
    transform: translateY(-2px) !important;
    box-shadow: 0 8px 20px rgba(90, 107, 62, 0.35) !important;
}

.stButton > button:hover::before {
    left: 100% !important;
}

.stButton > button:active {
    transform: translateY(0) !important;
    box-shadow: 0 2px 6px rgba(90, 107, 62, 0.25) !important;
}

/* Enhanced Messages */
.stSuccess {
    background: linear-gradient(to bottom, #E8F5E8, #F0FAF0) !important;
    border: 1px solid var(--muted-green) !important;
    border-radius: 12px !important;
    padding: 1.25rem 1.5rem !important;
    color: var(--deep-olive) !important;
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 500 !important;
    box-shadow: 0 4px 12px rgba(122, 138, 95, 0.15) !important;
    position: relative !important;
}

.stSuccess::before {
    content: '✓' !important;
    position: absolute !important;
    top: 1.25rem !important;
    left: 1.5rem !important;
    color: var(--muted-green) !important;
    font-weight: 700 !important;
    font-size: 1.2rem !important;
    margin-right: 0.5rem !important;
}

.stInfo {
    background: linear-gradient(to bottom, var(--off-white), var(--warm-white)) !important;
    border: 1px solid var(--sand) !important;
    border-radius: 12px !important;
    padding: 1.25rem 1.5rem !important;
    color: var(--charcoal) !important;
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 500 !important;
    box-shadow: var(--card-shadow) !important;
}

.stException {
    background: linear-gradient(to bottom, #FDE8E8, #FEF0F0) !important;
    border: 1px solid #D4A5A5 !important;
    border-radius: 12px !important;
    padding: 1.25rem 1.5rem !important;
    color: #8B4545 !important;
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 500 !important;
    box-shadow: 0 4px 12px rgba(212, 165, 165, 0.15) !important;
}

/* Enhanced Data Frame Table */
.stDataFrame {
    background: linear-gradient(to bottom, var(--white), var(--off-white)) !important;
    border: 1px solid var(--light-sand) !important;
    border-radius: 16px !important;
    overflow: hidden !important;
    box-shadow: var(--card-shadow) !important;
    margin: 1rem 0 !important;
}

.stDataFrame table {
    font-family: 'Quicksand', sans-serif !important;
    color: var(--soft-black) !important;
    border-collapse: separate !important;
    border-spacing: 0 !important;
}

.stDataFrame th {
    background: linear-gradient(to bottom, var(--beige), var(--sand)) !important;
    color: var(--soft-black) !important;
    font-weight: 600 !important;
    font-size: 0.9rem !important;
    border-bottom: 2px solid var(--taupe) !important;
    padding: 1.25rem 1rem !important;
    letter-spacing: 0.2px !important;
    text-transform: uppercase !important;
    position: sticky !important;
    top: 0 !important;
    z-index: 10 !important;
}

.stDataFrame td {
    border-bottom: 1px solid var(--light-sand) !important;
    padding: 1rem !important;
    font-size: 0.95rem !important;
    transition: all 0.2s ease !important;
}

.stDataFrame tr:hover {
    background: linear-gradient(to right, var(--off-white), var(--white)) !important;
}

.stDataFrame tr:hover td {
    color: var(--deep-olive) !important;
    font-weight: 500 !important;
}

/* Enhanced Expander */
.streamlit-expanderHeader {
    background: linear-gradient(to bottom, var(--beige), var(--light-sand)) !important;
    border-radius: 12px !important;
    border: 1px solid var(--sand) !important;
    font-family: 'Quicksand', sans-serif !important;
    font-weight: 500 !important;
    color: var(--charcoal) !important;
    padding: 1rem 1.25rem !important;
    margin-bottom: 0 !important;
    box-shadow: var(--card-shadow) !important;
    transition: all 0.3s ease !important;
}

.streamlit-expanderHeader:hover {
    background: linear-gradient(to bottom, var(--light-sand), var(--beige)) !important;
    transform: translateY(-1px) !important;
    box-shadow: var(--hover-shadow) !important;
}

.streamlit-expanderContent {
    background: linear-gradient(to bottom, var(--off-white), var(--warm-white)) !important;
    border: 1px solid var(--sand) !important;
    border-top: none !important;
    border-radius: 0 0 12px 12px !important;
    font-family: 'Quicksand', sans-serif !important;
    padding: 1.5rem !important;
    margin-top: 0 !important;
    box-shadow: var(--card-shadow) !important;
}

/* Enhanced Download Button */
.stDownloadButton > button {
    background: linear-gradient(135deg, var(--warm-brown), var(--taupe)) !important;
    color: var(--white) !important;
    border: none !important;
    border-radius: 12px !important;
    padding: 0.875rem 2rem !important;
    font-weight: 500 !important;
    font-family: 'Quicksand', sans-serif !important;
    font-size: 0.95rem !important;
    letter-spacing: 0.3px !important;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
    box-shadow: 0 4px 12px rgba(139, 115, 85, 0.25) !important;
    position: relative !important;
    overflow: hidden !important;
}

.stDownloadButton > button::before {
    content: '' !important;
    position: absolute !important;
    top: 0 !important;
    left: -100% !important;
    width: 100% !important;
    height: 100% !important;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,0.2), transparent) !important;
    transition: left 0.6s ease !important;
}

.stDownloadButton > button:hover {
    background: linear-gradient(135deg, var(--taupe), var(--warm-brown)) !important;
    transform: translateY(-2px) !important;
    box-shadow: 0 8px 20px rgba(139, 115, 85, 0.35) !important;
}

.stDownloadButton > button:hover::before {
    left: 100% !important;
}

/* Enhanced File Upload Dropzone */
.stFileUploader div[data-testid="stFileUploaderDropzone"] {
    background: linear-gradient(to bottom, var(--white), var(--off-white)) !important;
    border: 2px dashed var(--sand) !important;
    border-radius: 16px !important;
    padding: 2rem !important;
    transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1) !important;
    box-shadow: var(--card-shadow) !important;
}

.stFileUploader div[data-testid="stFileUploaderDropzone"]:hover {
    border-color: var(--deep-olive) !important;
    background: linear-gradient(to bottom, var(--off-white), var(--white)) !important;
    transform: translateY(-2px) !important;
    box-shadow: var(--hover-shadow) !important;
}

/* Enhanced Spacing and Layout */
div[data-testid="stVerticalBlock"] > div[style*="flex-direction: column"] > div > div > div {
    margin-bottom: 1.5rem !important;
}

/* Premium Section Dividers */
.section-divider {
    height: 2px !important;
    background: linear-gradient(90deg, transparent, var(--sand), transparent) !important;
    margin: 2rem 0 !important;
    border-radius: 1px !important;
}

/* Card Elements */
.premium-card {
    background: linear-gradient(to bottom, var(--white), var(--off-white)) !important;
    border: 1px solid var(--light-sand) !important;
    border-radius: 16px !important;
    padding: 2rem !important;
    box-shadow: var(--card-shadow) !important;
    margin: 1rem 0 !important;
    transition: all 0.3s ease !important;
}

.premium-card:hover {
    transform: translateY(-2px) !important;
    box-shadow: var(--hover-shadow) !important;
}

/* Remove default Streamlit padding */
.st-emotion-cache-1y4p8pa {
    padding-top: 0 !important;
}

/* Enhanced scrollbar */
::-webkit-scrollbar {
    width: 8px !important;
}

::-webkit-scrollbar-track {
    background: var(--off-white) !important;
}

::-webkit-scrollbar-thumb {
    background: var(--sand) !important;
    border-radius: 4px !important;
}

::-webkit-scrollbar-thumb:hover {
    background: var(--taupe) !important;
}

/* Analytics Table Card Container */
.analytics-table-card {
    background: linear-gradient(to bottom, var(--white), var(--off-white)) !important;
    border: 1px solid var(--light-sand) !important;
    border-radius: 16px !important;
    padding: 1.5rem !important;
    box-shadow: var(--card-shadow) !important;
    margin: 1rem 0 2rem 0 !important;
    overflow: hidden !important;
}

/* Ag-Grid Custom Styling */
.ag-theme-streamlit {
    --ag-background-color: var(--white) !important;
    --ag-header-background-color: linear-gradient(to bottom, var(--deep-olive), var(--muted-green)) !important;
    --ag-header-foreground-color: white !important;
    --ag-foreground-color: var(--soft-black) !important;
    --ag-row-hover-color: var(--warm-white) !important;
    --ag-border-color: var(--light-sand) !important;
    --ag-odd-row-background-color: var(--warm-white) !important;
    --ag-even-row-background-color: var(--white) !important;
    --ag-font-family: 'Quicksand', sans-serif !important;
    --ag-font-size: 13px !important;
    --ag-cell-horizontal-padding: 12px !important;
    --ag-header-cell-horizontal-padding: 12px !important;
    --ag-header-height: 48px !important;
    --ag-row-height: 40px !important;
}

/* Dark mode table support */
@media (prefers-color-scheme: dark) {
    .analytics-table-card {
        background: linear-gradient(to bottom, #2D2D2D, #1F1F1F) !important;
        border-color: #3A3A3A !important;
    }
}
</style>
""", unsafe_allow_html=True)

# Centered header within main content area
st.markdown("""
<style>
.content-centered-header {
    display: flex;
    flex-direction: column;
    align-items: center;
    text-align: center;
    padding: 1.5rem 0 2rem 0;
    max-width: 600px;
    margin: 0 auto;
}

.content-centered-header .logo-wrapper {
    margin-bottom: 1.5rem;
}

.content-centered-header .title-wrapper h1 {
    margin: 0 0 0.5rem 0;
    color: var(--soft-black);
    font-family: 'Quicksand', sans-serif;
    font-size: 2.4rem;
    font-weight: 600;
    letter-spacing: -0.5px;
}

.content-centered-header .title-wrapper .subtitle {
    margin: 0;
    color: var(--charcoal);
    font-family: 'Quicksand', sans-serif;
    font-weight: 400;
    font-size: 1.1rem;
    letter-spacing: 0.1px;
    opacity: 0.9;
}
</style>
""", unsafe_allow_html=True)

# Simple header with logo on top right
col_left, col_right = st.columns([5, 1])

with col_left:
    st.markdown("""
    <div style="padding-top: 2rem;">
        <h1 style="margin: 0 0 0.3rem 0; color: var(--soft-black); font-family: 'Quicksand', sans-serif; font-size: 2.2rem; font-weight: 600; letter-spacing: -0.5px;">Stock That Matters</h1>
        <p style="margin: 0; color: var(--charcoal); font-family: 'Quicksand', sans-serif; font-weight: 400; font-size: 1rem; letter-spacing: 0.1px; opacity: 0.9;">Internal inventory and reorder planning</p>
    </div>
    """, unsafe_allow_html=True)

with col_right:
    st.markdown("<div style='padding-top: 1.5rem;' class='logo-container'></div>", unsafe_allow_html=True)
    st.image("logo/StemWineCoLogo.png", width=100)

st.markdown("""
<div class="section-divider"></div>
""", unsafe_allow_html=True)

# Custom sidebar header
st.sidebar.markdown("""
<div class="sidebar-header">
    <h3>Admin Refresh</h3>
</div>
""", unsafe_allow_html=True)

# MVP Phase 1 - RB6 + RADs only
st.sidebar.markdown("""
<div style="padding: 0.5rem; background: linear-gradient(135deg, var(--deep-olive), var(--muted-green)); border-radius: 8px; margin-bottom: 1rem;">
    <p style="margin: 0; color: white; font-size: 0.85rem; text-align: center;">Manual RB6 + RADs refresh</p>
</div>
""", unsafe_allow_html=True)

developer_mode = st.sidebar.checkbox("Developer mode", value=False)

# Load importers.csv from project root
project_root = os.path.dirname(os.path.abspath(__file__))
importers_path = os.path.join(project_root, 'importers.csv')
importers_data, importers_loaded, importers_warning = load_importers_csv(importers_path)

latest_repo = None
try:
    latest_repo = SupabaseRepository.from_env()
    latest_report_run, latest_recommendations = latest_repo.get_latest_recommendations(limit=1000)
except Exception:
    latest_report_run, latest_recommendations = None, []

if latest_report_run:
    dashboard_df = recommendations_to_dataframe(latest_recommendations)
    metrics = dashboard_metrics(dashboard_df)
    completed_at = latest_report_run.get("completed_at", "unknown")

    st.markdown("""
    <div class="premium-card">
        <h2 style="margin: 0 0 0.5rem 0; color: var(--soft-black);">Ordering Dashboard</h2>
        <p style="margin: 0; color: var(--charcoal); opacity: 0.8; font-size: 0.95rem;">Latest saved recommendation run</p>
    </div>
    """, unsafe_allow_html=True)

    metric_cols = st.columns(5)
    metric_cols[0].metric("Urgent SKUs", f"{metrics.urgent_skus:,}")
    metric_cols[1].metric("Low SKUs", f"{metrics.low_skus:,}")
    metric_cols[2].metric("Recommended Qty", f"{metrics.recommended_bottles:,}")
    metric_cols[3].metric("Est. Order Cost", f"${metrics.estimated_order_cost:,.0f}")
    metric_cols[4].metric("Suppliers", f"{metrics.suppliers_with_orders:,}")

    st.caption(f"Run ID: {latest_report_run['id']} | Completed: {completed_at}")

    st.markdown("### Supplier Focus")
    filter_cols = st.columns([2, 2, 3, 1])
    supplier_values = (
        dashboard_df["supplier_name"].dropna().unique()
        if "supplier_name" in dashboard_df.columns
        else []
    )
    supplier_options = ["All"] + sorted(
        [s for s in supplier_values if s]
    )
    selected_supplier = filter_cols[0].selectbox("Supplier", supplier_options)
    selected_statuses = filter_cols[1].multiselect(
        "Status",
        ["URGENT", "LOW", "OK", "NO SALES"],
        default=["URGENT", "LOW"],
    )
    search_query = filter_cols[2].text_input("Wine search", "")
    only_order_qty = filter_cols[3].checkbox("Qty > 0", value=True)

    filtered_dashboard = filter_recommendations(
        dashboard_df,
        supplier=selected_supplier,
        statuses=selected_statuses,
        search=search_query,
        only_order_qty=only_order_qty,
    )

    tab_recs, tab_suppliers, tab_locations, tab_po = st.tabs(["Recommendations", "Suppliers", "Locations", "PO Draft"])
    with tab_recs:
        st.dataframe(
            format_dashboard_dataframe(filtered_dashboard),
            use_container_width=True,
            hide_index=True,
        )

    with tab_suppliers:
        supplier_base = filter_recommendations(
            dashboard_df,
            supplier="All",
            statuses=selected_statuses,
            search=search_query,
            only_order_qty=only_order_qty,
        )
        st.dataframe(supplier_summary(supplier_base), use_container_width=True, hide_index=True)

    with tab_locations:
        location_base = filter_recommendations(
            dashboard_df,
            supplier="All",
            statuses=selected_statuses,
            search=search_query,
            only_order_qty=only_order_qty,
        )
        truck = california_truck_summary(location_base)
        truck_cols = st.columns(3)
        truck_cols[0].metric("CA Truck Progress", f"{truck['progress_pct']:.0f}%")
        truck_cols[1].metric("Bottles to FTL", f"{truck['bottles_needed']:,}")
        truck_cols[2].metric("Est. FTL Savings", f"${truck['estimated_savings']:,.0f}")
        st.dataframe(location_summary(location_base), use_container_width=True, hide_index=True)

    with tab_po:
        if selected_supplier == "All":
            st.info("Select a supplier to preview a PO draft.")
        else:
            po_df = po_export_dataframe(filtered_dashboard)
            po_qty = int(po_df["Quantity"].sum()) if "Quantity" in po_df else 0
            po_cost = float(po_df["Estimated Cost"].sum()) if "Estimated Cost" in po_df else 0
            po_metric_cols = st.columns(3)
            po_metric_cols[0].metric("PO Lines", f"{len(po_df):,}")
            po_metric_cols[1].metric("PO Qty", f"{po_qty:,}")
            po_metric_cols[2].metric("PO Est. Cost", f"${po_cost:,.0f}")
            st.dataframe(po_df, use_container_width=True, hide_index=True)
            st.download_button(
                label="Download PO CSV",
                data=po_df.to_csv(index=False),
                file_name=f"{selected_supplier.replace(' ', '_').lower()}_po_draft.csv",
                mime="text/csv",
            )
            if po_df.empty:
                st.info("This supplier has no recommended order quantities in the current filter.")
            elif st.button("Create PO Draft", type="primary"):
                try:
                    draft = latest_repo.create_purchase_order_draft(
                        supplier_name=selected_supplier,
                        report_run_id=latest_report_run["id"],
                        recommendations=filtered_dashboard,
                        notes="Created from Ordering Dashboard supplier preview.",
                    )
                    st.success(
                        f"Created PO draft {draft['id']} with {len(draft.get('lines', [])):,} lines."
                    )
                except Exception as draft_error:
                    st.error(f"Could not create PO draft: {draft_error}")
elif latest_repo:
    st.info("No saved recommendation run found yet. Upload RB6 and RADs files to create the first dashboard run.")

# File upload widgets - Phase 1: Only RB6 and RADs required
rb6_file = st.sidebar.file_uploader("Velocity Report RB6", type=['csv', 'xlsx'])
sales_file = st.sidebar.file_uploader("Sales History Vinosmith RADs File", type=['csv', 'xlsx'])

# Store files in session state for re-run capability
if rb6_file and sales_file:
    st.session_state['rb6_file'] = rb6_file
    st.session_state['sales_file'] = sales_file

# Run Again button (only show if files have been uploaded)
if 'rb6_file' in st.session_state and 'sales_file' in st.session_state:
    st.sidebar.markdown("---")
    if st.sidebar.button("🔄 Run Again", help="Re-process the uploaded files after making fixes"):
        st.session_state['force_save_report_run'] = True
        st.rerun()

if rb6_file and sales_file:
    try:
        result = build_ordering_pipeline(rb6_file, sales_file, importers_path)
        rb6_data = result.rb6.data
        sales_data = result.rads.data
        recommendations = result.recommendations
        raw_df = result.raw_df
        display_df = result.display_df
        original_cols = result.rb6.original_columns
        rads_original_cols = result.rads.original_columns
        col_map = result.rb6.column_map
        rads_col_map = result.rads.column_map
        header_row = result.rb6.header_row
        rads_header_row = result.rads.header_row
        diagnostics = result.diagnostics
        report_run_id = None
        run_signature = (
            f"{getattr(rb6_file, 'name', '')}:"
            f"{uploaded_file_size(rb6_file)}:"
            f"{getattr(sales_file, 'name', '')}:"
            f"{uploaded_file_size(sales_file)}"
        )
        force_save = st.session_state.pop('force_save_report_run', False)
        should_save_run = st.session_state.get('last_saved_report_run_signature') != run_signature or force_save
        if should_save_run:
            try:
                repo = SupabaseRepository.from_env()
                report_run = repo.create_report_run(
                    run_type="manual_upload",
                    diagnostics={
                        **diagnostics,
                        "rb6_file_name": getattr(rb6_file, "name", None),
                        "rads_file_name": getattr(sales_file, "name", None),
                    },
                )
                report_run_id = report_run["id"]
                repo.save_recommendations(report_run_id, recommendations)
                repo.complete_report_run(report_run_id, diagnostics=diagnostics)
                st.session_state['last_saved_report_run_signature'] = run_signature
                st.success(f"✅ Saved report run to Supabase: {report_run_id}")
            except Exception as supabase_error:
                if report_run_id:
                    try:
                        repo.fail_report_run(report_run_id, str(supabase_error))
                    except Exception:
                        pass
                st.warning(f"⚠️ Supabase save skipped: {supabase_error}")
        else:
            st.info("This uploaded file pair has already been saved to Supabase in this session.")

        if developer_mode:
            st.sidebar.markdown("---")
            st.sidebar.write("Detecting RB6 header...")
            st.sidebar.write(f"Detected header at row {header_row}")
            st.sidebar.write("Debug: Original columns:", original_cols[:10], "...")
            st.sidebar.write("Debug: Normalized columns:", result.rb6.normalized_columns[:10], "...")
            st.sidebar.write("Debug: Column mapping:", col_map)
            st.sidebar.write(f"DEBUG: rb6_data shape: {rb6_data.shape}")
            st.sidebar.write(f"DEBUG: rb6_data columns: {list(rb6_data.columns)[:15]}")

            st.sidebar.write("Sample RB6 data (first 3 rows):")
            sample_cols = ['name', 'importer', 'available_inventory', 'on_order']
            available_sample_cols = [c for c in sample_cols if c in rb6_data.columns]
            st.sidebar.dataframe(rb6_data[available_sample_cols].head(3), hide_index=True)

            st.sidebar.markdown("---")
            st.sidebar.write("Detecting RADs header...")
            st.sidebar.write(f"Detected RADs header at row {rads_header_row}")
            st.sidebar.write("Debug: Original RADs columns:", rads_original_cols[:10], "...")
            st.sidebar.write("Debug: Normalized RADs columns:", result.rads.normalized_columns[:10], "...")
            st.sidebar.write("Debug: RADs column mapping:", rads_col_map)
            st.sidebar.write(f"DEBUG: sales_data shape: {sales_data.shape}")
            st.sidebar.write(f"DEBUG: sales_data columns: {list(sales_data.columns)[:15]}")
            st.sidebar.write("DEBUG: RADs columns setup complete!")

            st.sidebar.write("Sample RADs data (first 3 rows):")
            rads_sample_cols = ['wine_name', 'quantity']
            if 'account' in sales_data.columns:
                rads_sample_cols.append('account')
            rads_sample_cols.append('date')
            available_rads_sample_cols = [c for c in rads_sample_cols if c in sales_data.columns]
            st.sidebar.dataframe(sales_data[available_rads_sample_cols].head(3), hide_index=True)

        st.success("✅ Files loaded with dynamic header detection!")

        # Show importers.csv status
        if result.importers_loaded:
            st.success(f"✅ Importers loaded: {len(importers_data)} suppliers")
        elif result.importers_warning:
            st.warning(f"⚠️ {result.importers_warning}")

        # Note: Normalization and preprocessing now handled in wine_calculator.py

        if developer_mode:
            # --- DEBUG OUTPUT (HIDDEN BY DEFAULT) ---
            with st.expander("🔧 Debug: Data Validation (click to expand)", expanded=False):
                st.markdown("""
                <div style="margin: 1rem 0; padding: 1rem; background: linear-gradient(to right, #FFFCF8, #F5F0E8); border-radius: 8px; border-left: 4px solid #8B9A7B;">
                    <h4 style="margin: 0; color: #2C2C2C; font-size: 0.9rem;">Normalization Preview</h4>
                </div>
                """, unsafe_allow_html=True)

                # Show 5 raw wine names from RB6 and their planning_sku results
                st.write("**RB6 Name → planning_sku mapping (first 5):**")
                if "name" in rb6_data.columns:
                    rb6_data['planning_sku_preview'] = rb6_data["name"].apply(normalize_planning_sku)
                    rb6_sample = rb6_data[["name", 'planning_sku_preview']].head(5)
                    for idx, row in rb6_sample.iterrows():
                        st.write(f"• \"{row['name']}\" → \"{row['planning_sku_preview']}\"")

                # Show 5 raw wine names from RADs and their planning_sku results
                st.write("**RADs Wine Name → planning_sku mapping (first 5):**")
                if "wine_name" in sales_data.columns:
                    sales_data['planning_sku_preview'] = sales_data["wine_name"].apply(normalize_planning_sku)
                    rads_sample = sales_data[["wine_name", 'planning_sku_preview']].head(5)
                    for idx, row in rads_sample.iterrows():
                        st.write(f"• \"{row['wine_name']}\" → \"{row['planning_sku_preview']}\"")

                # Total Quantity sum from RADs
                if 'quantity' in sales_data.columns:
                    total_quantity = sales_data['quantity'].sum()
                    st.write(f"**Total Quantity from RADs:** {total_quantity:,.0f}")

                # First 10 unique Pack Size values from RADs (check both normalized and original)
                pack_size_col = None
                if 'pack_size' in sales_data.columns:
                    pack_size_col = 'pack_size'
                elif 'Pack Size' in sales_data.columns:
                    pack_size_col = 'Pack Size'

                if pack_size_col:
                    unique_pack_sizes = sales_data[pack_size_col].dropna().unique()[:10]
                    st.write(f"**First 10 unique Pack Sizes from RADs:** {list(unique_pack_sizes)}")

            # --- MERGE DIAGNOSTICS (HIDDEN BY DEFAULT) ---
            with st.expander("🔧 Debug: Merge Quality (click to expand)", expanded=False):
                st.markdown("""
                <div style="margin: 1rem 0; padding: 1rem; background: linear-gradient(to right, #FFFCF8, #F5F0E8); border-radius: 8px; border-left: 4px solid #4A4A4A;">
                    <h4 style="margin: 0; color: #2C2C2C; font-size: 0.9rem;">RB6 + RADs Merge Quality (by planning_sku)</h4>
                </div>
                """, unsafe_allow_html=True)

                # Basic counts
                total_rb6_rows = len(rb6_data)
                total_rads_rows = len(sales_data)

                # Use normalized planning_sku for matching
                if "name" in rb6_data.columns:
                    rb6_data['planning_sku_norm'] = rb6_data["name"].apply(normalize_planning_sku)
                if "wine_name" in sales_data.columns:
                    sales_data['planning_sku_norm'] = sales_data["wine_name"].apply(normalize_planning_sku)

                unique_rb6_planning = diagnostics.get('rb6_unique_planning_skus', 0)
                unique_rads_planning = diagnostics.get('rads_unique_planning_skus', 0)

                st.write(f"**Total RB6 rows:** {total_rb6_rows}")
                st.write(f"**Total RADs rows:** {total_rads_rows}")
                st.write(f"**Unique RB6 planning_sku values:** {unique_rb6_planning}")
                st.write(f"**Unique RADs planning_sku values:** {unique_rads_planning}")

                # Calculate matches
                if 'planning_sku_norm' in rb6_data.columns and 'planning_sku_norm' in sales_data.columns:
                    rb6_planning_skus = set(rb6_data['planning_sku_norm'].dropna().unique())
                    rads_planning_skus = set(sales_data['planning_sku_norm'].dropna().unique())

                    matched_count = diagnostics.get('matched_planning_skus', 0)
                    unmatched_count = diagnostics.get('unmatched_rb6_planning_skus', 0)

                    st.write(f"**Matched by planning_sku:** {matched_count}")
                    st.write(f"**Unmatched:** {unmatched_count}")

        # Calculate recommendations - Phase 1: RB6 + RADs only

        if developer_mode:
            # DEBUG: Check data before passing to calculator
            st.sidebar.markdown("---")
            st.sidebar.write("🧮 **Pre-calculation Debug:**")
            st.sidebar.write(f"- rb6_data shape: {rb6_data.shape}")
            st.sidebar.write(f"- rb6_data columns: {list(rb6_data.columns)[:15]}")
            if 'available_inventory' in rb6_data.columns:
                ai_count = rb6_data['available_inventory'].notna().sum()
                st.sidebar.write(f"- rb6_data available_inventory non-null: {ai_count}/{len(rb6_data)}")
            st.sidebar.write(f"- sales_data shape: {sales_data.shape}")
            st.sidebar.write(f"- sales_data columns: {list(sales_data.columns)[:10]}")

            # DEBUG: Check what came back from calculator
            if recommendations is not None:
                st.sidebar.markdown("---")
                st.sidebar.write("📊 **Post-calculation Debug:**")
                st.sidebar.write(f"- recommendations shape: {recommendations.shape}")
                st.sidebar.write(f"- recommendations columns: {list(recommendations.columns)[:15]}")
                if 'true_available' in recommendations.columns:
                    ta_count = recommendations['true_available'].notna().sum()
                    st.sidebar.write(f"- true_available non-null: {ta_count}/{len(recommendations)}")
                if 'available_inventory' in recommendations.columns:
                    ai_count = recommendations['available_inventory'].notna().sum()
                    st.sidebar.write(f"- available_inventory non-null: {ai_count}/{len(recommendations)}")

                # Check FOB status
                if 'fob' in recommendations.columns:
                    fob_nonzero = (recommendations['fob'] > 0).sum()
                    fob_zero = (recommendations['fob'] == 0).sum()
                    st.sidebar.write(f"- FOB > 0: {fob_nonzero}/{len(recommendations)}, FOB = 0: {fob_zero}/{len(recommendations)}")
                    if fob_zero > len(recommendations) * 0.5:  # More than 50% have zero FOB
                        st.warning(f"⚠️ {fob_zero} SKUs have FOB = 0. Order costs cannot be calculated correctly.")

        # Display results with premium styling
        st.markdown("""
        <div class="premium-card">
            <h2 style="margin: 0 0 1rem 0; color: var(--soft-black);">Reorder Recommendations</h2>
            <p style="margin: 0; color: var(--charcoal); opacity: 0.8; font-size: 0.95rem;">Strategic inventory insights based on your uploaded data</p>
        </div>
        """, unsafe_allow_html=True)

        if developer_mode:
            # --- VALIDATION: Check final output quality ---
            st.sidebar.markdown("---")
            st.sidebar.write("📋 **Final Output Validation:**")
            st.sidebar.write(f"- DataFrame shape: {raw_df.shape}")
            st.sidebar.write(f"- DataFrame columns: {list(raw_df.columns)}")

            # Check inventory pipeline specifically
            st.sidebar.write("🔍 **Inventory Pipeline Check:**")
            if 'true_available' in recommendations.columns:
                ta_count = recommendations['true_available'].notna().sum()
                ta_total = len(recommendations)
                st.sidebar.write(f"- true_available: {ta_count}/{ta_total} populated ({(ta_count/ta_total)*100:.1f}%)")
            if 'available_inventory' in recommendations.columns:
                ai_count = recommendations['available_inventory'].notna().sum()
                st.sidebar.write(f"- available_inventory: {ai_count}/{len(recommendations)} populated")
            if 'on_order' in recommendations.columns:
                oo_count = recommendations['on_order'].notna().sum()
                st.sidebar.write(f"- on_order: {oo_count}/{len(recommendations)} populated")

            # Check key fields are not mostly null
            critical_fields = ['product_code', 'Name', 'importer', 'true_available', 'last_30_day_sales']
            for field in critical_fields:
                if field in raw_df.columns:
                    null_count = raw_df[field].isna().sum()
                    total_count = len(raw_df)
                    null_pct = (null_count / total_count) * 100 if total_count > 0 else 0
                    status = "✅" if null_pct < 50 else "⚠️" if null_pct < 90 else "❌"
                    st.sidebar.write(f"{status} {field}: {null_pct:.1f}% null ({null_count}/{total_count})")

            # Show sample of key fields
            st.sidebar.write("📊 Sample of key fields (first 5 rows):")
            sample_fields = ['product_code', 'Name', 'importer', 'true_available', 'last_30_day_sales', 'weeks_on_hand']
            available_sample = [f for f in sample_fields if f in raw_df.columns]
            if available_sample:
                st.sidebar.dataframe(raw_df[available_sample].head(5), hide_index=True)

        # Display in styled card container
        st.markdown("""
        <div class="analytics-table-card">
        """, unsafe_allow_html=True)

        # Render formatted display dataframe
        st.dataframe(display_df, use_container_width=True, hide_index=True)

        st.markdown("""
        </div>
        """, unsafe_allow_html=True)

        if developer_mode:
            # --- DEBUG CHECK: Final output rows ---
            with st.expander("🔧 Debug: Final Output Check (click to expand)", expanded=False):
                st.markdown("""
                <div style="margin: 1rem 0; padding: 1rem; background: linear-gradient(to right, #FFFCF8, #F5F0E8); border-radius: 8px; border-left: 4px solid #6B8E6B;">
                    <h4 style="margin: 0; color: #2C2C2C; font-size: 0.9rem;">Final Output: Top 10 by Sales</h4>
                </div>
                """, unsafe_allow_html=True)

                # Show 10 rows with key identity fields
                st.write("**Top 10 rows (planning_sku, Name, product_code, last_30_day_sales):**")
                debug_cols = ['planning_sku', 'Name', 'product_code', 'last_30_day_sales']
                available_debug_cols = [c for c in debug_cols if c in raw_df.columns]
                if available_debug_cols:
                    debug_df = raw_df[available_debug_cols].head(10)
                    st.dataframe(debug_df, hide_index=True)
                else:
                    st.write("• Required columns not found in results")

            # --- IMPORTER DEBUG (HIDDEN BY DEFAULT) ---
            with st.expander("🔧 Debug: Importer Logistics (click to expand)", expanded=False):
                st.markdown("""
                <div style="margin: 1rem 0; padding: 1rem; background: linear-gradient(to right, #FFFCF8, #F5F0E8); border-radius: 8px; border-left: 4px solid #8B9A7B;">
                    <h4 style="margin: 0; color: #2C2C2C; font-size: 0.9rem;">Importer Matching Summary</h4>
                </div>
                """, unsafe_allow_html=True)

                if result.importers_loaded and 'importer' in recommendations.columns:
                    # Count unique RB6 importers
                    unique_importers = recommendations['importer'].dropna().nunique()
                    st.write(f"**Unique RB6 importers:** {unique_importers}")

                    # Count matched importers (have eta_days)
                    matched_importers = recommendations['eta_days'].notna().sum()
                    st.write(f"**Importers matched to CSV:** {matched_importers}")

                    # Count missing ETA
                    missing_eta = recommendations['eta_days'].isna().sum()
                    st.write(f"**Importers missing ETA:** {missing_eta}")

                    # Show unmatched importer names
                    st.write("**Unmatched importer names:**")
                    unmatched = recommendations[recommendations['eta_days'].isna() & recommendations['importer'].notna()]['importer'].unique()
                    if len(unmatched) > 0:
                        for imp in unmatched[:10]:  # Show first 10
                            st.write(f"• {imp}")
                        if len(unmatched) > 10:
                            st.write(f"... and {len(unmatched) - 10} more")
                    else:
                        st.write("• All importers matched!")
                else:
                    st.write("• Importer data not available (check importers.csv)")

            # --- RADs DEBUG (HIDDEN BY DEFAULT) ---
            with st.expander("🔧 Debug: RADs Header Detection (click to expand)", expanded=False):
                st.markdown("""
                <div style="margin: 1rem 0; padding: 1rem; background: linear-gradient(to right, #FFFCF8, #F5F0E8); border-radius: 8px; border-left: 4px solid #7B8E9A;">
                    <h4 style="margin: 0; color: #2C2C2C; font-size: 0.9rem;">RADs File Detection Summary</h4>
                </div>
                """, unsafe_allow_html=True)

                # Show detection results
                st.write(f"**Detected RADs header row:** {rads_header_row}")

                st.write("**Original columns (first 15):**")
                st.write(rads_original_cols[:15])

                st.write("**Normalized columns (first 15):**")
                st.write(list(sales_data.columns)[:15])

                st.write("**Column mapping used:**")
                for standard_name, detected_col in rads_col_map.items():
                    st.write(f"• {standard_name} → '{detected_col}'")

                st.write("**Required fields status:**")
                required_fields = ['product_name', 'quantity', 'date']
                for field in required_fields:
                    status = "✅ Found" if field in rads_col_map else "❌ Missing"
                    detected = f" ({rads_col_map[field]})" if field in rads_col_map else ""
                    st.write(f"• {field}: {status}{detected}")

                st.write("**Optional fields status:**")
                optional_fields = ['item_number', 'cases', 'account']
                for field in optional_fields:
                    status = "✅ Found" if field in rads_col_map else "⚪ Not found"
                    detected = f" ({rads_col_map[field]})" if field in rads_col_map else ""
                    st.write(f"• {field}: {status}{detected}")

                # Show sample of raw data
                st.write("**Sample raw data (first 5 rows):**")
                sample_display_cols = ['wine_name', 'quantity', 'date']
                if 'account' in sales_data.columns:
                    sample_display_cols.append('account')
                available_display = [c for c in sample_display_cols if c in sales_data.columns]
                if available_display:
                    st.dataframe(sales_data[available_display].head(5), hide_index=True)

            # --- SEASONAL REFERENCE DEBUG (HIDDEN BY DEFAULT) ---
            with st.expander("🔧 Debug: Seasonal Reference (click to expand)", expanded=False):
                st.markdown("""
                <div style="margin: 1rem 0; padding: 1rem; background: linear-gradient(to right, #FFFCF8, #F5F0E8); border-radius: 8px; border-left: 4px solid #6B8E6B;">
                    <h4 style="margin: 0; color: #2C2C2C; font-size: 0.9rem;">Seasonal Reference (Next 60 Days LY)</h4>
                </div>
                """, unsafe_allow_html=True)

                # Show date window used
                today = datetime.now()
                future_start = today
                future_end = today + timedelta(days=60)
                historical_start = future_start - timedelta(days=365)
                historical_end = future_end - timedelta(days=365)

                st.write(f"**Future reference window:** {future_start.strftime('%Y-%m-%d')} to {future_end.strftime('%Y-%m-%d')}")
                st.write(f"**Historical comparison window:** {historical_start.strftime('%Y-%m-%d')} to {historical_end.strftime('%Y-%m-%d')}")

                # Show 10 sample rows
                st.write("**Sample rows:**")
                if 'next_60_days_ly_sales' in raw_df.columns and 'weekly_velocity' in raw_df.columns:
                    sample_cols = ['planning_sku', 'weekly_velocity', 'next_60_days_ly_sales']
                    available_sample_cols = [c for c in sample_cols if c in raw_df.columns]
                    sample_df = raw_df[available_sample_cols].head(10)
                    st.dataframe(sample_df, hide_index=True)
                else:
                    st.write("• Seasonal columns not found in results")

        # CSV export with premium styling - use raw_df for clean numeric export
        csv = raw_df.to_csv(index=False)
        st.markdown("""
        <div class="premium-card" style="text-align: center; margin-top: 2rem;">
            <p style="margin: 0 0 1rem 0; color: var(--charcoal); font-weight: 500; opacity: 0.8;">Export your reorder recommendations for further analysis</p>
        """, unsafe_allow_html=True)
        st.download_button(
            label="Download CSV Report",
            data=csv,
            file_name="wine_reorder_recommendations.csv",
            mime="text/csv"
        )
        st.markdown("""
        </div>
        """, unsafe_allow_html=True)

    except Exception as e:
        st.error(f"Error processing files: {str(e)}")
        st.error("Full traceback:")
        st.code(traceback.format_exc())
else:
    st.info("📋 **Phase 1**: Please upload both RB6 and RADs files to generate reorder recommendations.")

    # Premium file format information
    with st.expander("Expected File Formats"):
        st.markdown("""
        <div style="font-family: 'Quicksand', sans-serif;">
        <h4 style="color: var(--charcoal); margin-bottom: 1.5rem; font-weight: 500;">Required File Columns</h4>

        <div style="background: linear-gradient(to bottom, var(--white), var(--off-white)); padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem; border: 1px solid var(--light-sand); box-shadow: var(--card-shadow);">
        <strong style="color: var(--deep-olive); font-size: 1.05rem; display: block; margin-bottom: 0.75rem;">RB6 Inventory Report</strong>
        <ul style="margin: 0; padding-left: 1.5rem; color: var(--charcoal); line-height: 1.6;">
            <li style="margin-bottom: 0.5rem;">planning_sku</li>
            <li style="margin-bottom: 0.5rem;">true_available</li>
            <li>on_order</li>
        </ul>
        </div>

        <div style="background: linear-gradient(to bottom, var(--white), var(--off-white)); padding: 1.5rem; border-radius: 12px; margin-bottom: 1.5rem; border: 1px solid var(--light-sand); box-shadow: var(--card-shadow);">
        <strong style="color: var(--deep-olive); font-size: 1.05rem; display: block; margin-bottom: 0.75rem;">Sales History Export</strong>
        <ul style="margin: 0; padding-left: 1.5rem; color: var(--charcoal); line-height: 1.6;">
            <li style="margin-bottom: 0.5rem;">planning_sku</li>
            <li style="margin-bottom: 0.5rem;">quantity_sold</li>
            <li>date</li>
        </ul>
        </div>

        </div>

        <div style="margin-top: 1rem; padding: 1rem; background: linear-gradient(to right, var(--light-sand), var(--sand)); border-radius: 8px; text-align: center;">
            <p style="margin: 0; color: var(--charcoal); font-size: 0.9rem;">💡 <em>Wine Needs file coming in Phase 2</em></p>
        </div>
        </div>
        """, unsafe_allow_html=True)
