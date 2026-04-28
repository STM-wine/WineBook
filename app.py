import streamlit as st
import pandas as pd
import os
import traceback
from datetime import datetime, timedelta
from wine_calculator import calculate_reorder_recommendations

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
    <h3>Upload Files</h3>
</div>
""", unsafe_allow_html=True)

# MVP Phase 1 - RB6 + RADs only
st.sidebar.markdown("""
<div style="padding: 0.5rem; background: linear-gradient(135deg, var(--deep-olive), var(--muted-green)); border-radius: 8px; margin-bottom: 1rem;">
    <p style="margin: 0; color: white; font-size: 0.85rem; text-align: center;">📋 Phase 1: RB6 + RADs Only</p>
</div>
""", unsafe_allow_html=True)

# Helper function to clean importer names for matching
def clean_importer_name(name):
    """Clean importer name for matching: lowercase, strip, collapse spaces."""
    if pd.isna(name):
        return ''
    return ' '.join(str(name).lower().strip().split())

# Helper function to detect RB6 header row dynamically
def detect_rb6_header(file):
    """Detect header row dynamically by looking for key columns."""
    key_headers = ['importer', 'description', 'available', 'on_order', 'inventory', 'name']
    
    for i in range(10):
        try:
            if file.name.endswith('.csv'):
                temp_df = pd.read_csv(file, header=i)
            else:
                temp_df = pd.read_excel(file, header=i)
            
            # Normalize column names for checking
            temp_df = normalize_columns(temp_df)
            cols = list(temp_df.columns)
            
            # Check if any key headers exist
            matches = sum(1 for key in key_headers if any(key in col for col in cols))
            
            if matches >= 2:  # Found at least 2 key headers
                return i, temp_df
                
        except Exception:
            continue
    
    return 0, None  # Default to row 0 if not found

# Helper function to normalize RB6 dataframe
def normalize_rb6_dataframe(df):
    """Normalize RB6 column names and return with original columns for debug."""
    # Store original columns for debug
    original_cols = list(df.columns)
    
    # Use the reusable normalize_columns function
    df = normalize_columns(df)
    
    return df, original_cols

# Helper function to map normalized columns to standard fields
def map_rb6_columns(df):
    """Map normalized RB6 columns to standard field names."""
    col_map = {}
    
    # Find importer column
    for col in df.columns:
        if 'import' in col:
            col_map['importer'] = col
            break
    
    # Find inventory/available column
    for col in df.columns:
        if col == 'available_inventory':
            col_map['available_inventory'] = col
            break
        elif 'available' in col and 'inventory' in col:
            col_map['available_inventory'] = col
            break
        elif 'true_available' in col or 'trueavailable' in col:
            col_map['available_inventory'] = col
            break
    
    # Find on_order column
    for col in df.columns:
        if col in ['on_order', 'onorder']:
            col_map['on_order'] = col
            break
        elif 'order' in col and 'on' in col:
            col_map['on_order'] = col
            break
    
    # Find FOB/cost column
    for col in df.columns:
        if col in ['fob', 'FOB', 'unit_cost', 'bottle_cost', 'cost']:
            col_map['fob'] = col
            break
        elif 'fob' in col.lower():
            col_map['fob'] = col
            break
        elif 'cost' in col.lower() and 'unit' in col.lower():
            col_map['fob'] = col
            break
        elif 'bottle' in col.lower() and 'cost' in col.lower():
            col_map['fob'] = col
            break
        elif 'price' in col.lower() and 'unit' in col.lower():
            col_map['fob'] = col
            break
    
    # Find description/name column
    for col in df.columns:
        if col in ['name', 'description', 'wine_name']:
            col_map['description'] = col
            break
        elif 'description' in col or 'name' in col:
            col_map['description'] = col
            break
    
    return col_map


# Reusable function to normalize dataframe columns defensively
def normalize_columns(df):
    """
    Normalize dataframe columns safely.
    Handles MultiIndex, blanks, duplicates, and special characters.
    """
    df = df.copy()
    
    # Flatten MultiIndex columns if needed
    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [
            "_".join([str(x) for x in col if str(x) != "nan"]).strip()
            for col in df.columns
        ]
    
    # Force every column name to string
    df.columns = [str(col) for col in df.columns]
    
    # Normalize names
    df.columns = (
        pd.Index(df.columns)
        .str.strip()
        .str.lower()
        .str.replace(r"[^a-z0-9]+", "_", regex=True)
        .str.replace(r"_+", "_", regex=True)
        .str.strip("_")
    )
    
    # Handle duplicate column names safely
    counts = {}
    new_cols = []
    for col in df.columns:
        if col in counts:
            counts[col] += 1
            new_cols.append(f"{col}_{counts[col]}")
        else:
            counts[col] = 0
            new_cols.append(col)
    
    df.columns = new_cols
    return df


# Helper function to detect RADs header row dynamically
def detect_rads_header(file):
    """Detect header row dynamically by looking for key RADs columns."""
    # Key headers that indicate a valid RADs header row
    key_headers = ['quantity', 'date', 'wine', 'item', 'customer', 'account', 'invoice']
    
    for i in range(15):  # Scan first 15 rows
        try:
            if file.name.endswith('.csv'):
                temp_df = pd.read_csv(file, header=i)
            else:
                temp_df = pd.read_excel(file, header=i)
            
            # Normalize column names for checking
            temp_df = normalize_columns(temp_df)
            cols = list(temp_df.columns)
            
            # Check if any key headers exist
            matches = sum(1 for key in key_headers if any(key in col for col in cols))
            
            if matches >= 2:  # Found at least 2 key headers
                return i, temp_df
                
        except Exception:
            continue
    
    return 0, None  # Default to row 0 if not found


# Helper function to normalize RADs dataframe
def normalize_rads_dataframe(df):
    """Normalize RADs column names and return with original columns for debug."""
    # Store original columns for debug
    original_cols = list(df.columns)
    
    # Use the reusable normalize_columns function
    df = normalize_columns(df)
    
    return df, original_cols


# Helper function to map RADs columns to standard fields using aliases
def map_rads_columns(df):
    """Map normalized RADs columns to standard field names using precise matching."""
    col_map = {}
    cols = list(df.columns)
    
    # Define aliases for each standard field - EXACT MATCHES ONLY (no partial matching)
    # These are the normalized versions of actual Vinosmith RADs column names
    aliases = {
        'item_number': [
            'item_number', 'item_no', 'item_num', 'sku', 'product_code', 
            'item', 'item_number_', 'code', 'item_code'
        ],
        'product_name': [
            'wine_name', 'description', 'item_description', 'product_name', 
            'name', 'wine', 'product', 'item_name', 'wine_description'
        ],
        'quantity': [
            'quantity', 'qty', 'bottles', 'bottle_qty', 'bottle_quantity', 
            'units', 'unit_qty', 'bottle_count', 'bottles_qty'
        ],
        'cases': [
            'cases', 'case_qty', 'case_quantity', 'qty_cases', 
            'num_cases', 'case_count'
        ],
        'date': [
            'date_mm_dd_yyyy', 'invoice_date', 'date', 'transaction_date', 
            'order_date', 'sale_date', 'invoice_date_mm_dd_yyyy'
        ],
        'account': [
            'account_name', 'customer', 'account', 'customer_name', 
            'customer_code', 'account_code', 'customer_no', 'account_number'
        ]
    }
    
    # Find matches for each standard field - EXACT MATCHES FIRST
    for standard_field, field_aliases in aliases.items():
        # First try exact matches
        for col in cols:
            if col in field_aliases:
                col_map[standard_field] = col
                break
        
        # If no exact match, try if alias is contained in column name (but not vice versa)
        if standard_field not in col_map:
            for col in cols:
                for alias in field_aliases:
                    # Only match if alias is contained in column, and column isn't too different
                    if alias in col and len(col) < len(alias) + 10:
                        col_map[standard_field] = col
                        break
                if standard_field in col_map:
                    break
    
    return col_map


# Load importers.csv from project root
importers_data = None
importers_loaded = False
importers_warning = None

# Get the project root directory (where app.py is located)
project_root = os.path.dirname(os.path.abspath(__file__))
importers_path = os.path.join(project_root, 'importers.csv')

if os.path.exists(importers_path):
    try:
        importers_data = pd.read_csv(importers_path)
        
        # DEBUG: Show original columns
        st.sidebar.write("🔧 Debug: Importers original columns:", list(importers_data.columns))
        
        # Use normalize_columns for safe column normalization
        importers_data = normalize_columns(importers_data)
        
        # DEBUG: Show normalized columns
        st.sidebar.write("🔧 Debug: Importers normalized columns:", list(importers_data.columns))
        
        # Explicitly rename 'name' to 'importer_name'
        if 'name' in importers_data.columns:
            importers_data = importers_data.rename(columns={'name': 'importer_name'})
        
        # Validate required columns
        required_cols = ["importer_name", "eta_days"]
        missing_cols = [col for col in required_cols if col not in importers_data.columns]
        
        if missing_cols:
            importers_warning = f"importers.csv missing required columns: {missing_cols}"
            importers_loaded = False
        else:
            importers_loaded = True
            
            # Create cleaned matching key
            importers_data['importer_name_clean'] = importers_data['importer_name'].apply(clean_importer_name)
            
            # DEBUG: Confirm final expected columns
            expected_cols = ['importer_id', 'importer_name', 'eta_days', 'pick_up_location', 
                           'freight_forwarder', 'order_frequency', 'notes']
            available_cols = [col for col in expected_cols if col in importers_data.columns]
            st.sidebar.write(f"✅ Available logistics columns: {available_cols}")
            
    except Exception as e:
        importers_warning = f"Error loading importers.csv: {str(e)}"
else:
    importers_warning = "importers.csv not found in project root"

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
        st.rerun()

if rb6_file and sales_file:
    try:
        # --- DYNAMIC RB6 HEADER DETECTION ---
        st.sidebar.markdown("---")
        st.sidebar.write("🔍 Detecting RB6 header...")
        
        # Detect header row dynamically
        header_row, rb6_data = detect_rb6_header(rb6_file)
        
        if rb6_data is None:
            st.error("Could not detect header row in RB6 file. Please check the file format.")
            st.stop()
        
        st.sidebar.write(f"✅ Detected header at row {header_row}")
        
        # Normalize column names
        rb6_data, original_cols = normalize_rb6_dataframe(rb6_data)
        
        # Map columns to standard fields
        col_map = map_rb6_columns(rb6_data)
        
        # DEBUG: Show detection results
        st.sidebar.write("🔧 Debug: Original columns:", original_cols[:10], "...")
        st.sidebar.write("🔧 Debug: Normalized columns:", list(rb6_data.columns)[:10], "...")
        st.sidebar.write("🔧 Debug: Column mapping:", col_map)
        
        # VALIDATION: Check required columns
        if 'importer' not in col_map:
            st.error("❌ Importer column not found in RB6 file")
            st.sidebar.write("Available columns:", list(rb6_data.columns))
            st.stop()
        
        if 'available_inventory' not in col_map:
            st.error("❌ Inventory column not found in RB6 file")
            st.sidebar.write("Available columns:", list(rb6_data.columns))
            st.stop()
        
        # DEBUG before numeric conversion
        st.sidebar.write(f"DEBUG: rb6_data shape: {rb6_data.shape}")
        st.sidebar.write(f"DEBUG: rb6_data columns: {list(rb6_data.columns)[:15]}")
        
        # Create standardized column names for downstream use
        st.sidebar.write(f"DEBUG: Mapping importer from '{col_map['importer']}'")
        rb6_data['importer'] = rb6_data[col_map['importer']]
        
        st.sidebar.write(f"DEBUG: Converting available_inventory from '{col_map['available_inventory']}'")
        rb6_data['available_inventory'] = pd.to_numeric(rb6_data[col_map['available_inventory']], errors='coerce').fillna(0)
        
        if 'on_order' in col_map:
            st.sidebar.write(f"DEBUG: Converting on_order from '{col_map['on_order']}'")
            rb6_data['on_order'] = pd.to_numeric(rb6_data[col_map['on_order']], errors='coerce').fillna(0)
        else:
            rb6_data['on_order'] = 0
            st.sidebar.warning("⚠️ On Order column not found, defaulting to 0")
        
        if 'description' in col_map:
            st.sidebar.write(f"DEBUG: Mapping name from '{col_map['description']}'")
            rb6_data['name'] = rb6_data[col_map['description']]
        else:
            st.error("❌ Description/Name column not found in RB6 file")
            st.stop()
        
        # DEBUG: Show sample data
        st.sidebar.write("📊 Sample RB6 data (first 3 rows):")
        sample_cols = ['name', 'importer', 'available_inventory', 'on_order']
        available_sample_cols = [c for c in sample_cols if c in rb6_data.columns]
        st.sidebar.dataframe(rb6_data[available_sample_cols].head(3), hide_index=True)
        
        # --- DYNAMIC RADs HEADER DETECTION ---
        st.sidebar.markdown("---")
        st.sidebar.write("🔍 Detecting RADs header...")
        
        # Detect header row dynamically
        rads_header_row, sales_data = detect_rads_header(sales_file)
        
        if sales_data is None:
            st.error("Could not detect header row in RADs file. Please check the file format.")
            st.stop()
        
        st.sidebar.write(f"✅ Detected RADs header at row {rads_header_row}")
        
        # Normalize column names
        sales_data, rads_original_cols = normalize_rads_dataframe(sales_data)
        
        # Map columns to standard fields
        rads_col_map = map_rads_columns(sales_data)
        
        # DEBUG: Show detection results
        st.sidebar.write("🔧 Debug: Original RADs columns:", rads_original_cols[:10], "...")
        st.sidebar.write("🔧 Debug: Normalized RADs columns:", list(sales_data.columns)[:10], "...")
        st.sidebar.write("🔧 Debug: RADs column mapping:", rads_col_map)
        
        # VALIDATION: Check required RADs columns
        # Required: product_name (for matching), quantity (for sales), date (for filtering)
        required_rads_fields = {
            'product_name': ['Wine Name', 'product_name', 'description', 'name'],
            'quantity': ['Quantity', 'qty', 'bottles', 'quantity'],
            'date': ['Date', 'invoice_date', 'date', 'transaction_date']
        }
        
        missing_rads_fields = []
        for field, alternatives in required_rads_fields.items():
            if field not in rads_col_map:
                missing_rads_fields.append(f"{field} (tried: {alternatives})")
        
        if missing_rads_fields:
            st.error("❌ Required RADs columns not found:")
            for field in missing_rads_fields:
                st.error(f"  • {field}")
            st.sidebar.write("Available RADs columns:", list(sales_data.columns))
            st.stop()
        
        # DEBUG before RADs numeric conversion
        st.sidebar.write(f"DEBUG: sales_data shape: {sales_data.shape}")
        st.sidebar.write(f"DEBUG: sales_data columns: {list(sales_data.columns)[:15]}")
        
        # Create standardized column names for downstream use
        st.sidebar.write(f"DEBUG: Mapping RADs wine_name from '{rads_col_map['product_name']}'")
        sales_data['wine_name'] = sales_data[rads_col_map['product_name']]
        
        st.sidebar.write(f"DEBUG: Converting RADs quantity from '{rads_col_map['quantity']}'")
        sales_data['quantity'] = pd.to_numeric(sales_data[rads_col_map['quantity']], errors='coerce').fillna(0)
        
        st.sidebar.write(f"DEBUG: Mapping RADs date from '{rads_col_map['date']}'")
        sales_data['date'] = sales_data[rads_col_map['date']]
        
        # Handle account column if present
        if 'account' in rads_col_map:
            st.sidebar.write(f"DEBUG: Mapping RADs account from '{rads_col_map['account']}'")
            sales_data['account'] = sales_data[rads_col_map['account']]
        
        st.sidebar.write("DEBUG: RADs columns setup complete!")
        
        # DEBUG: Show sample RADs data
        st.sidebar.write("📊 Sample RADs data (first 3 rows):")
        rads_sample_cols = ['wine_name', 'quantity']
        if 'account' in sales_data.columns:
            rads_sample_cols.append('account')
        rads_sample_cols.append('date')
        available_rads_sample_cols = [c for c in rads_sample_cols if c in sales_data.columns]
        st.sidebar.dataframe(sales_data[available_rads_sample_cols].head(3), hide_index=True)
        
        st.success("✅ Files loaded with dynamic header detection!")
        
        # Show importers.csv status
        if importers_loaded:
            st.success(f"✅ Importers loaded: {len(importers_data)} suppliers")
        elif importers_warning:
            st.warning(f"⚠️ {importers_warning}")
        
        # Note: Normalization and preprocessing now handled in wine_calculator.py
        
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
                from wine_calculator import normalize_planning_sku
                rb6_data['planning_sku_preview'] = rb6_data["name"].apply(normalize_planning_sku)
                rb6_sample = rb6_data[["name", 'planning_sku_preview']].head(5)
                for idx, row in rb6_sample.iterrows():
                    st.write(f"• \"{row['name']}\" → \"{row['planning_sku_preview']}\"")
            
            # Show 5 raw wine names from RADs and their planning_sku results
            st.write("**RADs Wine Name → planning_sku mapping (first 5):**")
            if "wine_name" in sales_data.columns:
                from wine_calculator import normalize_planning_sku
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
            from wine_calculator import normalize_planning_sku
            if "name" in rb6_data.columns:
                rb6_data['planning_sku_norm'] = rb6_data["name"].apply(normalize_planning_sku)
            if "wine_name" in sales_data.columns:
                sales_data['planning_sku_norm'] = sales_data["wine_name"].apply(normalize_planning_sku)
            
            unique_rb6_planning = rb6_data['planning_sku_norm'].nunique() if 'planning_sku_norm' in rb6_data.columns else 0
            unique_rads_planning = sales_data['planning_sku_norm'].nunique() if 'planning_sku_norm' in sales_data.columns else 0
            
            st.write(f"**Total RB6 rows:** {total_rb6_rows}")
            st.write(f"**Total RADs rows:** {total_rads_rows}")
            st.write(f"**Unique RB6 planning_sku values:** {unique_rb6_planning}")
            st.write(f"**Unique RADs planning_sku values:** {unique_rads_planning}")
            
            # Calculate matches
            if 'planning_sku_norm' in rb6_data.columns and 'planning_sku_norm' in sales_data.columns:
                rb6_planning_skus = set(rb6_data['planning_sku_norm'].dropna().unique())
                rads_planning_skus = set(sales_data['planning_sku_norm'].dropna().unique())
                
                matched_by_planning = rb6_planning_skus & rads_planning_skus
                matched_count = len(matched_by_planning)
                unmatched_count = len(rb6_planning_skus - rads_planning_skus)
                
                st.write(f"**Matched by planning_sku:** {matched_count}")
                st.write(f"**Unmatched:** {unmatched_count}")
        
        # Calculate recommendations - Phase 1: RB6 + RADs only
        
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
        
        recommendations = calculate_reorder_recommendations(rb6_data, sales_data)
        
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
                importer_map = rb6_data.drop_duplicates(subset=['planning_sku_norm'], keep='first')[[
                    'planning_sku_norm', 'importer'
                ]].copy()
                importer_map.columns = ['planning_sku', 'importer']
                
                # Merge importer into recommendations
                recommendations = recommendations.merge(importer_map, on='planning_sku', how='left')
                
                # DEBUG: Show columns after merge
                st.write("DEBUG recommendations columns before importer_clean:", list(recommendations.columns))
                
                # DEFENSIVE: Resolve importer column after merge
                possible_importer_cols = [
                    'importer',
                    'importer_x',
                    'importer_y',
                    'rb6_importer',
                    'supplier',
                    'supplier_name'
                ]
                
                importer_col = next((c for c in possible_importer_cols if c in recommendations.columns), None)
                
                if importer_col:
                    recommendations['importer'] = recommendations[importer_col]
                else:
                    recommendations['importer'] = ''
                    st.warning("⚠️ Importer column missing after merge. Continuing without importer logistics matching.")
                
                # Clean importer names for matching
                recommendations['importer_clean'] = recommendations['importer'].fillna('').apply(clean_importer_name)
                
                # Merge logistics data from importers.csv
                recommendations = recommendations.merge(
                    importers_data[[
                        'importer_name_clean', 'importer_id', 'eta_days', 
                        'pick_up_location', 'freight_forwarder', 
                        'order_frequency', 'notes'
                    ]],
                    left_on='importer_clean',
                    right_on='importer_name_clean',
                    how='left'
                )
                
                # Drop the temporary matching column
                recommendations = recommendations.drop(columns=['importer_name_clean', 'importer_clean'], errors='ignore')
                
                # Calculate ETA fields
                today = datetime.now()
                
                # eta_weeks = eta_days / 7
                recommendations['eta_weeks'] = recommendations['eta_days'].apply(
                    lambda x: round(x / 7, 2) if pd.notna(x) else None
                )
                
                # projected_arrival_date = today + eta_days
                recommendations['projected_arrival_date'] = recommendations['eta_days'].apply(
                    lambda x: (today + timedelta(days=int(x))).strftime('%Y-%m-%d') if pd.notna(x) and x > 0 else None
                )
                
                # Calculate order_timing_risk
                def calculate_order_timing_risk(row):
                    weeks_on_hand = row.get('weeks_on_hand_with_on_order', None)
                    eta_weeks = row.get('eta_weeks', None)
                    
                    if pd.isna(weeks_on_hand) or weeks_on_hand == 999:
                        return 'Unknown'
                    if pd.isna(eta_weeks):
                        return 'Missing ETA'
                    if weeks_on_hand < eta_weeks:
                        return 'High Risk'
                    if weeks_on_hand < eta_weeks + 2:
                        return 'Medium Risk'
                    return 'Safe'
                
                recommendations['order_timing_risk'] = recommendations.apply(calculate_order_timing_risk, axis=1)
        
        # Display results with premium styling
        st.markdown("""
        <div class="premium-card">
            <h2 style="margin: 0 0 1rem 0; color: var(--soft-black);">Reorder Recommendations</h2>
            <p style="margin: 0; color: var(--charcoal); opacity: 0.8; font-size: 0.95rem;">Strategic inventory insights based on your uploaded data</p>
        </div>
        """, unsafe_allow_html=True)
        
        # Display table - Full operational columns including importer logistics
        display_columns = [
            # Core identity
            'planning_sku',
            'Name',
            'product_code',
            'vintage',
            'wine_category',
            'product_type',
            
            # Operational flags
            'brand_manager',
            'is_btg',
            'is_core',
            'importer',
            
            # Inventory
            'true_available',
            'on_order',
            'fob',
            
            # Sales velocity (RADs + RB6)
            'last_30_day_sales',
            'next_60_days_ly_sales',
            'last_30_day_sales_qty_across_all_accounts',
            'last_60_day_sales_qty_across_all_accounts',
            'last_90_day_sales_qty_across_all_accounts',
            'average_qty_sold_interval',
            
            # Calculated metrics
            'weekly_velocity',
            'weeks_on_hand',
            'weeks_on_hand_with_on_order',
            
            # Importer logistics
            'eta_days',
            'eta_weeks',
            'projected_arrival_date',
            'order_timing_risk',
            'pickup_location',
            'pick_up_location',
            'freight_forwarder',
            'order_frequency',
            'notes',
            
            # Recommendations
            'recommended_qty_raw',
            'recommended_qty_rounded',
            'order_cost',
            'reorder_status'
        ]
        
        # Only show columns that exist in the result
        available_display_cols = [col for col in display_columns if col in recommendations.columns]
        
        # Create raw_df: clean numeric data for backend logic and future agent use
        # This preserves numeric types for calculations, queries, and AI agent interactions
        raw_df = recommendations[available_display_cols].copy()
        
        # Create display_df: formatted for UI rendering only
        # String formatting is applied here without affecting the underlying raw data
        display_df = raw_df.copy()
        
        # Format bottle-based columns as whole numbers (0 decimals)
        bottle_columns = [
            'true_available', 'on_order', 'last_30_day_sales', 'next_60_days_ly_sales',
            'recommended_qty_raw', 'recommended_qty_rounded'
        ]
        for col in bottle_columns:
            if col in display_df.columns:
                display_df[col] = display_df[col].fillna(0).astype(int)
        
        # Format velocity columns to 2 decimals
        velocity_columns = ['weekly_velocity', 'weeks_on_hand', 'weeks_on_hand_with_on_order', 'fob']
        for col in velocity_columns:
            if col in display_df.columns:
                display_df[col] = display_df[col].apply(lambda x: f"{x:.2f}" if pd.notna(x) else "")
        
        # Format money columns with $ and commas, 2 decimals
        if 'order_cost' in display_df.columns:
            display_df['order_cost'] = display_df['order_cost'].apply(
                lambda x: f"${x:,.2f}" if pd.notna(x) else "$0.00"
            )
        
        # Format vintage as plain year string (prevents Streamlit rendering 2024 as 2,024)
        if 'vintage' in display_df.columns:
            display_df['vintage'] = (
                display_df['vintage']
                .fillna('')
                .astype(str)
                .str.replace(',', '', regex=False)
                .str.replace('.0', '', regex=False)
            )
        
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
            
            if importers_loaded and 'importer' in recommendations.columns:
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
