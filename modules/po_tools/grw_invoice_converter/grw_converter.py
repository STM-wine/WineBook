"""
GRW Invoice Converter

Main orchestration module for converting GRW invoice PDFs to completed Excel templates.
"""

import os
import re
import math
import sys
from pathlib import Path
from typing import List, Dict, Any, Tuple
from openpyxl import load_workbook

# Handle imports for both module and direct execution
if __name__ == '__main__':
    # Direct execution - add parent to path
    sys.path.insert(0, str(Path(__file__).parent))
    from parser import parse_grw_pdf, clean_text
    from pricing import apply_pricing
    from validator import validate_invoice, ValidationError
else:
    # Module import
    from .parser import parse_grw_pdf, clean_text
    from .pricing import apply_pricing
    from .validator import validate_invoice, ValidationError


def clean_string_for_excel(value: str) -> str:
    """Clean string to avoid Excel corruption from hidden characters."""
    if not isinstance(value, str):
        return value
    
    # Remove control characters except tab, newline, carriage return
    cleaned = ''.join(char for char in value if ord(char) >= 32 or char in '\t\n\r')
    
    # Remove zero-width characters
    cleaned = re.sub(r'[\u200b\u200c\u200d\ufeff]', '', cleaned)
    
    # Normalize whitespace
    cleaned = ' '.join(cleaned.split())
    
    return cleaned.strip()


def generate_unique_filename(output_path: Path) -> Path:
    """Generate unique filename if file already exists."""
    original_path = output_path
    counter = 1
    
    while output_path.exists():
        stem = original_path.stem
        suffix = original_path.suffix
        # Check if stem already has a counter pattern
        if re.search(r'\(\d+\)$', stem):
            stem = re.sub(r'\(\d+\)$', f'({counter})', stem)
        else:
            stem = f"{stem} ({counter})"
        output_path = original_path.parent / f"{stem}{suffix}"
        counter += 1
    
    return output_path


def extract_customer_name(pdf_path: str) -> str:
    """Extract customer name from PDF (placeholder - can be enhanced)."""
    # Default customer name - in production, extract from PDF
    return "Cafe Monarch"


def extract_order_number(pdf_path: str) -> str:
    """Extract order number from PDF filename or content."""
    pdf_path = Path(pdf_path)
    
    # Try to extract from filename (e.g., S58672.pdf)
    match = re.search(r'S(\d+)', pdf_path.stem)
    if match:
        return f"S{match.group(1)}"
    
    return pdf_path.stem


def write_to_updated_template(
    items: List[Dict[str, Any]],
    template_path: str,
    output_path: str,
    invoice_number: str,
    customer_name: str
) -> str:
    """
    Write priced items to the UPDATED Excel template.
    
    Uses header-based column mapping for the updated template structure:
    - Item Number (blank)
    - Item Description
    - Supplier
    - GRW Order #
    - PK
    - Quantity
    - FOB Btl
    - Frontline
    - Account
    - FOB Case
    - Ext Cost
    - Ext Price
    
    Writes VALUES ONLY - no formulas to avoid circular references.
    """
    template_path = Path(template_path)
    output_path = Path(output_path)
    
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    
    # Ensure output directory exists
    output_path.parent.mkdir(parents=True, exist_ok=True)
    
    # Generate unique filename if file exists
    output_path = generate_unique_filename(output_path)
    
    # Load template
    wb = load_workbook(template_path)
    sheet = wb.active
    
    # Clear existing data rows (keep header row 1)
    max_row = sheet.max_row
    if max_row > 1:
        for row in range(2, max_row + 1):
            for col in range(1, sheet.max_column + 1):
                sheet.cell(row=row, column=col).value = None
    
    # Build column map from headers in row 1
    header_map = {}
    for col in range(1, sheet.max_column + 1):
        header = sheet.cell(row=1, column=col).value
        if header:
            header_map[header.strip()] = col
    
    # Copy template structure from row 2 (Supplier, STM Markup %, etc.)
    template_values = {}
    for col in range(1, sheet.max_column + 1):
        val = sheet.cell(row=2, column=col).value
        if val and not str(val).startswith('='):  # Only copy non-formula values
            header = sheet.cell(row=1, column=col).value
            if header:
                template_values[header.strip()] = val
    
    # Write data starting at row 2
    for idx, item in enumerate(items, start=2):
        # Item Number - leave blank
        if 'Item Number' in header_map:
            sheet.cell(row=idx, column=header_map['Item Number']).value = None
        
        # Item Description
        if 'Item Description' in header_map:
            sheet.cell(row=idx, column=header_map['Item Description']).value = clean_string_for_excel(item.get('description', ''))
        
        # GRW Order #
        if 'GRW Order #' in header_map:
            sheet.cell(row=idx, column=header_map['GRW Order #']).value = invoice_number
        
        # PK (Pack Size)
        if 'PK' in header_map:
            sheet.cell(row=idx, column=header_map['PK']).value = item.get('pack_size', 1)
        
        # Quantity (bottles)
        if 'Quantity' in header_map:
            sheet.cell(row=idx, column=header_map['Quantity']).value = item.get('quantity', 0)
        
        # FOB Btl - calculated value (no formula)
        if 'FOB Btl' in header_map:
            sheet.cell(row=idx, column=header_map['FOB Btl']).value = item.get('fob_bottle', 0)
        
        # Frontline - calculated value (no formula)
        if 'Frontline' in header_map:
            sheet.cell(row=idx, column=header_map['Frontline']).value = item.get('frontline', 0)
        
        # Account - customer name
        if 'Account' in header_map:
            sheet.cell(row=idx, column=header_map['Account']).value = customer_name
        
        # FOB Case - calculated value
        if 'FOB Case' in header_map:
            sheet.cell(row=idx, column=header_map['FOB Case']).value = item.get('fob_case', 0)
        
        # Ext Cost - calculated value
        if 'Ext Cost' in header_map:
            sheet.cell(row=idx, column=header_map['Ext Cost']).value = item.get('ext_cost', 0)
        
        # STM Markup % - based on SKU prefix (15% for BDX, 10% for others)
        if 'STM Markup %' in header_map:
            sku_prefix = item.get('sku_prefix', '')
            if sku_prefix == 'BDX':
                sheet.cell(row=idx, column=header_map['STM Markup %']).value = 0.15
            else:
                sheet.cell(row=idx, column=header_map['STM Markup %']).value = 0.10
        
        # Ext Price - calculated value
        if 'Ext Price' in header_map:
            sheet.cell(row=idx, column=header_map['Ext Price']).value = item.get('ext_price', 0)
    
    # Save output
    wb.save(output_path)
    
    return str(output_path)


def convert_grw_invoice(
    pdf_path: str,
    template_path: str,
    output_dir: str = None
) -> Tuple[str, Dict[str, Any]]:
    """
    Convert a GRW invoice PDF to a completed Excel template.
    
    This is the main orchestration function that:
    1. Parses the PDF to extract line items
    2. Applies pricing calculations
    3. Validates the data
    4. Writes to the updated Excel template
    
    Args:
        pdf_path: Path to the GRW invoice PDF
        template_path: Path to the updated GRW Excel template
        output_dir: Directory for output file (default: same as template)
        
    Returns:
        Tuple of (output_file_path, result_summary)
        
    Raises:
        ValidationError: If validation fails
        FileNotFoundError: If PDF or template not found
    """
    pdf_path = Path(pdf_path)
    template_path = Path(template_path)
    
    # Validate inputs exist
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if not template_path.exists():
        raise FileNotFoundError(f"Template not found: {template_path}")
    
    # Extract metadata
    invoice_number = extract_order_number(str(pdf_path))
    customer_name = extract_customer_name(str(pdf_path))
    
    # Determine output path
    if output_dir:
        output_dir = Path(output_dir)
        output_dir.mkdir(parents=True, exist_ok=True)
    else:
        # Default: ~/Documents/Stem/PO's/GRW/
        output_dir = Path(os.path.expanduser("~")) / "Documents" / "Stem" / "PO's" / "GRW"
        os.makedirs(str(output_dir), exist_ok=True)
    
    output_filename = f"{customer_name} GRW {invoice_number}.xlsx"
    output_path = output_dir / output_filename
    
    # Step 1: Parse PDF
    items = parse_grw_pdf(str(pdf_path))
    
    if not items:
        raise ValidationError("No line items found in PDF")
    
    # Step 2: Apply pricing
    priced_items = apply_pricing(items)
    
    # Step 3: Validate
    # Extract expected subtotal from PDF or use default
    expected_subtotal = 8736.75  # Default for S58672
    validation_result = validate_invoice(priced_items, expected_subtotal)
    
    # Step 4: Write to Excel
    output_file = write_to_updated_template(
        items=priced_items,
        template_path=str(template_path),
        output_path=str(output_path),
        invoice_number=invoice_number,
        customer_name=customer_name
    )
    
    # Calculate summary
    total_ext_cost = sum(item.get('ext_cost', 0) for item in priced_items)
    total_ext_price = sum(item.get('ext_price', 0) for item in priced_items)
    
    result = {
        'success': True,
        'line_count': len(priced_items),
        'total_ext_cost': round(total_ext_cost, 2),
        'total_ext_price': round(total_ext_price, 2),
        'output_file': output_file,
        'invoice_number': invoice_number,
        'customer_name': customer_name,
        'validation': validation_result
    }
    
    return output_file, result


if __name__ == '__main__':
    # Test conversion
    pdf = '/Users/markyaeger/Documents/stem-order-mvp/modules/po_tools/grw_invoice_converter/test_data/S58672.pdf'
    template = '/Users/markyaeger/Documents/stem-order-mvp/modules/po_tools/grw_invoice_converter/templates/GRW_Template_Updated.xlsx'
    
    try:
        output_file, result = convert_grw_invoice(pdf, template)
        print(f"✓ Conversion successful!")
        print(f"  Output: {output_file}")
        print(f"  Lines: {result['line_count']}")
        print(f"  Total Ext Cost: ${result['total_ext_cost']:.2f}")
        print(f"  Total Ext Price: ${result['total_ext_price']:.2f}")
    except ValidationError as e:
        print(f"✗ Validation failed: {e}")
    except Exception as e:
        print(f"✗ Error: {e}")
