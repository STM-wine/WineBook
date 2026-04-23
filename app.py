import streamlit as st
import pandas as pd
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

# File upload widgets - Phase 1: Only RB6 and RADs required
rb6_file = st.sidebar.file_uploader("Velocity Report RB6", type=['csv', 'xlsx'])
sales_file = st.sidebar.file_uploader("Sales History Vinosmith RADs File", type=['csv', 'xlsx'])

if rb6_file and sales_file:
    try:
        # Read files
        if rb6_file.name.endswith('.csv'):
            rb6_data = pd.read_csv(rb6_file)
        else:
            rb6_data = pd.read_excel(rb6_file)
            
        if sales_file.name.endswith('.csv'):
            sales_data = pd.read_csv(sales_file)
        else:
            sales_data = pd.read_excel(sales_file)
        
        st.success("Files loaded successfully!")
        
        # Import re at top level for normalization
        import re
        
        # Helper function to normalize wine names into planning_sku
        def normalize_wine_name(name: str) -> str:
            """
            Normalize wine name by removing vintage years and pack sizes.
            Example: "Frog's Leap Cabernet Sauvignon 2022 12/750ml"
            -> "Frog's Leap Cabernet Sauvignon"
            
            Rules:
            - remove 4-digit vintage years (2021-2026)
            - remove pack sizes (12/750ml, 6/750ml, 6/1.5L, 24/187ml)
            - keep NV
            - trim whitespace
            """
            if pd.isna(name):
                return name
            
            name = str(name)
            
            # Remove pack sizes: patterns like 12/750ml, 6/1.5L, 24/187ml, etc.
            name = re.sub(r'\d+/\d+(?:\.\d+)?[Ll][Mm]?|\d+/\d+\.\d+L|\d+[Ll][Mm]', '', name)
            
            # Remove 4-digit vintage years (2021-2026)
            name = re.sub(r'\b20[2-9][0-9]\b', '', name)
            
            # Clean up extra whitespace
            name = ' '.join(name.split())
            
            return name.strip()
        
        # --- RB6 PREPROCESSING ---
        # Create planning_sku from "Name" column
        if "Name" in rb6_data.columns:
            rb6_data['planning_sku'] = rb6_data["Name"].apply(normalize_wine_name)
        else:
            st.error("RB6 file missing 'Name' column")
            raise ValueError("RB6 file must contain 'Name' column")
        
        # Standardize product_code from "Code" column
        if "Code" in rb6_data.columns:
            rb6_data['product_code'] = rb6_data["Code"].astype(str).str.strip()
        
        # Map other required columns
        column_mapping_rb6 = {
            'true_available': 'Available Inventory',
            'on_order': 'On Order',
            'responsible_brand_manager': 'Wine: External ID (1)',
            'unit_cost': 'FOB',
            'is_core': 'Is Core',
            'is_btg': 'Is BTG',
            'unconfirmed_qty': 'Unconfirmed Line Item Qty'
        }
        
        for new_col, original_col in column_mapping_rb6.items():
            if original_col in rb6_data.columns:
                rb6_data[new_col] = rb6_data[original_col]
        
        # --- SALES PREPROCESSING ---
        # Create planning_sku from "Wine Name" column (NOT "Account Name")
        if "Wine Name" in sales_data.columns:
            sales_data['planning_sku'] = sales_data["Wine Name"].apply(normalize_wine_name)
        else:
            st.error("Sales file missing 'Wine Name' column")
            raise ValueError("Sales file must contain 'Wine Name' column")
        
        # Standardize product_code from "Product Code" column
        if "Product Code" in sales_data.columns:
            sales_data['product_code'] = sales_data["Product Code"].astype(str).str.strip()
        
        # Map other required columns
        column_mapping_sales = {
            'quantity_sold': 'Quantity',
            'date': 'Date (mm/dd/yyyy)',
            'account_name': 'Account Name',
            'pack_size': 'Pack Size'
        }
        
        for new_col, original_col in column_mapping_sales.items():
            if original_col in sales_data.columns:
                sales_data[new_col] = sales_data[original_col]
        
        # Calculate recommendations - Phase 1: RB6 + RADs only
        recommendations = calculate_reorder_recommendations(rb6_data, sales_data)
        
        # Display results with premium styling
        st.markdown("""
        <div class="premium-card">
            <h2 style="margin: 0 0 1rem 0; color: var(--soft-black);">Reorder Recommendations</h2>
            <p style="margin: 0; color: var(--charcoal); opacity: 0.8; font-size: 0.95rem;">Strategic inventory insights based on your uploaded data</p>
        </div>
        """, unsafe_allow_html=True)
        
        # Display table - Phase 1 columns
        display_columns = [
            'planning_sku',
            'product_code',
            'brand_manager',
            'is_btg',
            'is_core',
            'true_available',
            'on_order',
            'last_30_day_sales',
            'daily_run_rate',
            'weeks_on_hand',
            'weeks_on_hand_with_on_order',
            'target_days',
            'recommended_qty_raw',
            'recommended_qty_rounded',
            'fob',
            'order_cost',
            'expected_days_on_hand_after_order'
        ]
        
        # Only show columns that exist in the result
        available_display_cols = [col for col in display_columns if col in recommendations.columns]
        st.dataframe(recommendations[available_display_cols], use_container_width=True)
        
        # CSV export with premium styling
        csv = recommendations[available_display_cols].to_csv(index=False)
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
