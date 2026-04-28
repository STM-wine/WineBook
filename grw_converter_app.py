"""
GRW Invoice Converter - Streamlit App

A simple web interface for converting GRW invoice PDFs to Excel templates.
"""

import streamlit as st
import pandas as pd
import os
import re
import sys
import tempfile
import traceback
from pathlib import Path

# Set page configuration
st.set_page_config(
    page_title="GRW Invoice Converter",
    page_icon="📄",
    layout="wide"
)

# Import converter modules using absolute package imports
from modules.po_tools.grw_invoice_converter.parser import parse_grw_pdf
from modules.po_tools.grw_invoice_converter.pricing import apply_pricing
from modules.po_tools.grw_invoice_converter.validator import validate_invoice, ValidationError
from modules.po_tools.grw_invoice_converter.grw_converter import (
    write_to_updated_template,
    extract_order_number,
    extract_customer_name,
)

# Verify which parser module is loaded (for debugging)
print(f"🔧 PARSER MODULE: {parse_grw_pdf.__module__}")
print(f"🔧 PARSER FUNCTION: {parse_grw_pdf.__code__.co_filename}")


def main():
    # Page header
    st.title("📄 GRW Invoice Converter")
    st.markdown("""
    Convert GRW invoice PDFs to completed Stem GRW Excel templates.
    
    **Features:**
    - Extracts line items from GRW PDFs
    - Applies correct pricing (BDX: 15% markup, Others: 10% markup)
    - Populates updated Excel template
    - Saves to `~/Documents/Stem/PO's/GRW/`
    """)
    
    st.divider()
    
    # File upload
    uploaded_pdf = st.file_uploader(
        "Upload GRW Invoice PDF",
        type=['pdf'],
        help="Select a GRW Wine Collection Sales Order PDF"
    )
    
    if uploaded_pdf is not None:
        st.success(f"✅ PDF uploaded: {uploaded_pdf.name}")
        
        # Parse account name and order number from filename
        # Format: "Account Name #InvoiceNumber.pdf"
        customer_name = None
        invoice_number = None
        
        # Try to parse from filename
        if '#' in uploaded_pdf.name:
            # Split on # to get account name and invoice number
            parts = uploaded_pdf.name.rsplit('#', 1)  # Split from right to handle # in account name
            if len(parts) == 2:
                account_part = parts[0].strip()
                number_part = parts[1].strip()
                
                # Remove .pdf extension from number part
                number_part = number_part.replace('.pdf', '').replace('.PDF', '').strip()
                
                # Clean up account name (remove trailing spaces, underscores)
                customer_name = account_part.rstrip(' _')
                
                # Extract just the number and add S prefix
                number_match = re.search(r'(\d+)', number_part)
                if number_match:
                    invoice_number = f"S{number_match.group(1)}"
        
        # Fallback: use PDF extraction if filename parsing failed
        if not customer_name or not invoice_number:
            st.warning("⚠️ Could not parse account/order from filename. Using PDF extraction as fallback.")
            
            # Save to temp file for extraction
            with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_pdf:
                tmp_pdf.write(uploaded_pdf.getvalue())
                pdf_path = tmp_pdf.name
            
            if not customer_name:
                customer_name = extract_customer_name(pdf_path)
            if not invoice_number:
                invoice_number = extract_order_number(pdf_path)
            
            os.unlink(pdf_path)
        
        # Show uploaded file info with parsed values
        st.success(f"✅ PDF uploaded: {uploaded_pdf.name}")
        
        # Debug display
        with st.expander("🔧 Debug: Filename Parsing", expanded=True):
            st.write(f"**Uploaded filename:** {uploaded_pdf.name}")
            st.write(f"**Parsed account name:** {customer_name}")
            st.write(f"**Parsed GRW order number:** {invoice_number}")
            st.write(f"**Final output filename:** {customer_name} GRW {invoice_number}.xlsx")
        
        # Convert button
        if st.button("🚀 Convert GRW Invoice", type="primary", use_container_width=True):
            with st.spinner("Processing invoice..."):
                try:
                    # Progress bar
                    progress_bar = st.progress(0)
                    status = st.empty()
                    
                    # Step 1: Save uploaded file to temp location
                    status.text("📄 Reading PDF...")
                    progress_bar.progress(10)
                    
                    with tempfile.NamedTemporaryFile(delete=False, suffix='.pdf') as tmp_pdf:
                        tmp_pdf.write(uploaded_pdf.getvalue())
                        pdf_path = tmp_pdf.name
                    
                    # Step 2: Parse PDF
                    status.text("🔍 Extracting line items...")
                    progress_bar.progress(30)
                    
                    # Parse with debug info
                    parse_result = parse_grw_pdf(pdf_path, debug=True)
                    
                    # Debug the parse result structure
                    print(f"🔍 APP PARSED RESULT TYPE: {type(parse_result)}")
                    print(f"🔍 APP PARSED RESULT LEN: {len(parse_result) if isinstance(parse_result, tuple) else 'N/A'}")
                    
                    items, pages_parsed, debug_info = parse_result
                    
                    # Immediate debug output
                    print(f"📝 APP PARSED ITEMS COUNT: {len(items)}")
                    print(f"📝 APP PAGES PARSED: {pages_parsed}")
                    print(f"📝 APP DEBUG INFO: {debug_info}")
                    
                    # Debug display for parsing
                    st.write(f"**APP PARSED ITEMS COUNT:** {len(items)}")
                    st.write(f"**PDF page count:** {debug_info.get('pdf_page_count', 'N/A')}")
                    st.write(f"**Pages parsed:** {pages_parsed}")
                    st.write(f"**Items per page:** {debug_info.get('items_per_page', {})}")
                    st.write(f"**Parsed line item count:** {len(items)}")
                    st.write(f"**First item number:** {debug_info.get('first_item_number', 'N/A')}")
                    st.write(f"**Last item number:** {debug_info.get('last_item_number', 'N/A')}")
                    
                    # Check for missing item numbers
                    missing = debug_info.get('missing_item_numbers', [])
                    if missing:
                        st.warning(f"⚠️ Missing item numbers: {missing}")
                    
                    if not items:
                        st.error("❌ No line items found in PDF. Please check the file format.")
                        os.unlink(pdf_path)
                        return
                    
                    st.info(f"📋 Found {len(items)} line items")
                    
                    # Step 3: Apply pricing
                    status.text("💰 Calculating pricing...")
                    progress_bar.progress(50)
                    
                    priced_items = apply_pricing(items)
                    
                    # Show preview table
                    preview_data = []
                    for item in priced_items:
                        preview_data.append({
                            'Description': item.get('description', '')[:50],
                            'SKU': item.get('sku_prefix', ''),
                            'PK': item.get('pack_size', 1),
                            'Qty': item.get('quantity', 0),
                            'FOB Bottle': f"${item.get('fob_bottle', 0):.2f}",
                            'Frontline': f"${item.get('frontline', 0)}",
                            'Ext Cost': f"${item.get('ext_cost', 0):.2f}",
                            'Markup': '15%' if item.get('sku_prefix') == 'BDX' else '10%'
                        })
                    
                    preview_df = pd.DataFrame(preview_data)
                    st.markdown("### 📊 Extracted Line Items Preview")
                    st.dataframe(preview_df, use_container_width=True, hide_index=True)
                    
                    # Step 4: Validate
                    status.text("✅ Validating data...")
                    progress_bar.progress(70)
                    
                    expected_subtotal = sum(item.get('ext_cost', 0) for item in priced_items)
                    validation_result = validate_invoice(priced_items, expected_subtotal)
                    
                    # Step 5: Determine output path
                    status.text("💾 Preparing output...")
                    progress_bar.progress(85)
                    
                    output_dir = Path(os.path.expanduser("~")) / "Documents" / "Stem" / "PO's" / "GRW"
                    os.makedirs(str(output_dir), exist_ok=True)
                    
                    output_filename = f"{customer_name} GRW {invoice_number}.xlsx"
                    output_path = output_dir / output_filename
                    
                    # Handle file collision with (1), (2), (3) suffix format
                    counter = 1
                    original_path = output_path
                    while output_path.exists():
                        output_path = original_path.parent / f"{original_path.stem} ({counter}){original_path.suffix}"
                        counter += 1
                    
                    # Template path
                    template_path = Path(__file__).parent / "modules" / "po_tools" / "grw_invoice_converter" / "templates" / "GRW_Template_Updated.xlsx"
                    
                    # Step 6: Write to Excel
                    status.text("📝 Writing Excel file...")
                    progress_bar.progress(95)
                    
                    output_file = write_to_updated_template(
                        items=priced_items,
                        template_path=str(template_path),
                        output_path=str(output_path),
                        invoice_number=invoice_number,
                        customer_name=customer_name
                    )
                    
                    # Clean up temp file
                    os.unlink(pdf_path)
                    
                    progress_bar.progress(100)
                    status.empty()
                    
                    # Success message
                    st.success("✅ Conversion complete!")
                    
                    # Debug display
                    with st.expander("🔧 Debug: Extracted Values", expanded=True):
                        st.write(f"**Extracted customer:** {customer_name}")
                        st.write(f"**Extracted order number:** {invoice_number}")
                        st.write(f"**Output filename:** {Path(output_file).name}")
                    
                    # File saved info
                    st.markdown(f"""
                    **File saved to:**
                    ```
                    {output_file}
                    ```
                    """)
                    
                    # Summary metrics
                    total_ext_cost = sum(item.get('ext_cost', 0) for item in priced_items)
                    total_ext_price = sum(item.get('ext_price', 0) for item in priced_items)
                    
                    col1, col2, col3, col4 = st.columns(4)
                    with col1:
                        st.metric("Line Items", len(priced_items))
                    with col2:
                        st.metric("Total Ext Cost", f"${total_ext_cost:,.2f}")
                    with col3:
                        st.metric("Total Ext Price", f"${total_ext_price:,.2f}")
                    with col4:
                        bdx_count = sum(1 for item in priced_items if item.get('sku_prefix') == 'BDX')
                        st.metric("BDX Items", bdx_count)
                    
                    # Download button
                    with open(output_file, 'rb') as f:
                        excel_data = f.read()
                    
                    st.download_button(
                        label="📥 Download Excel File",
                        data=excel_data,
                        file_name=Path(output_file).name,
                        mime="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
                        use_container_width=True
                    )
                    
                    # Validation details expander
                    with st.expander("🔍 Validation Details"):
                        st.write("**Checks Passed:**")
                        for check in validation_result.get('checks_passed', []):
                            st.success(f"✅ {check}")
                        
                        col1, col2 = st.columns(2)
                        with col1:
                            st.metric("Total Ext Cost", f"${validation_result.get('total_ext_cost', 0):.2f}")
                        with col2:
                            st.metric("Line Count", validation_result.get('line_count', 0))
                    
                except ValidationError as e:
                    st.error(f"❌ Validation failed: {str(e)}")
                    st.warning("Please check the PDF format and try again.")
                except Exception as e:
                    st.error(f"❌ Error: {str(e)}")
                    with st.expander("Technical Details"):
                        st.code(traceback.format_exc())
    
    else:
        # Show expected format info
        st.info("👆 Upload a GRW invoice PDF to begin.")
        
        with st.expander("📋 Expected PDF Format"):
            st.markdown("""
            **Supported PDF Format:**
            - GRW Wine Collection Sales Order PDFs
            - Items with SKU prefixes (BDX, BUR, ITY, USR, etc.)
            - Pack sizes: PK03, 3-Pack, 6-Pack, etc.
            - Vintage years (e.g., 1998, 2022)
            - Bottle sizes (default 750ml)
            
            **Pricing Logic:**
            - **BDX (Bordeaux):** Frontline = CEILING(FOB Bottle × 1.15, 1)
            - **All Others:** Frontline = CEILING((FOB Bottle × 1.15 / 1.05), 1)
            
            **Output Location:**
            ```
            ~/Documents/Stem/PO's/GRW/
            ```
            
            **Output File Naming:**
            ```
            [Customer Name] GRW [Order Number].xlsx
            ```
            """)
        
        with st.expander("📝 Template Columns"):
            st.markdown("""
            The updated Excel template includes:
            - **Item Number** - Left blank
            - **Item Description** - Full wine name with vintage and pack/size
            - **GRW Order #** - Invoice number
            - **PK** - Pack size
            - **Quantity** - Total bottles
            - **FOB Btl** - Price per bottle
            - **Frontline** - Selling price (whole dollars)
            - **Account** - Customer name
            - **FOB Case** - Case price
            - **Ext Cost** - Extended cost
            - **STM Markup %** - 15% for BDX, 10% for others
            - **Ext Price** - Extended price
            """)


if __name__ == "__main__":
    main()
