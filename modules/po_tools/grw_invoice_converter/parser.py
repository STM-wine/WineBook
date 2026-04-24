"""
GRW Invoice Parser

Extracts structured line items from GRW invoice PDFs.
"""

import re
import pdfplumber
from pathlib import Path
from typing import List, Dict, Any


def clean_text(text: str) -> str:
    """Remove hidden unicode characters and normalize whitespace."""
    if not text:
        return ""
    # Remove zero-width and control characters
    text = re.sub(r'[\u200b\u200c\u200d\ufeff\x00-\x08\x0b-\x0c\x0e-\x1f]', '', text)
    # Normalize whitespace
    text = ' '.join(text.split())
    return text.strip()


def extract_sku_prefix(description: str) -> str:
    """Extract SKU prefix (BDX, BUR, ITY, USR) from description."""
    match = re.search(r'\b(BDX|BUR|ITY|USR):', description, re.IGNORECASE)
    if match:
        return match.group(1).upper()
    return ""


def extract_pack_size(description: str) -> int:
    """Extract pack size from description (PK03, 3-Pack, etc.)."""
    # Look for PK## pattern
    pk_match = re.search(r'PK(\d+)', description, re.IGNORECASE)
    if pk_match:
        return int(pk_match.group(1))
    # Look for #-Pack pattern
    pack_match = re.search(r'(\d+)-Pack', description, re.IGNORECASE)
    if pack_match:
        return int(pack_match.group(1))
    return 1


def extract_vintage(description: str) -> int:
    """Extract vintage year from description."""
    # Look for 4-digit year (1900-2030)
    years = re.findall(r'\b(19\d{2}|20\d{2})\b', description)
    if years:
        year = int(years[0])
        if 1900 <= year <= 2030:
            return year
    return 0


def extract_size(description: str) -> str:
    """Extract bottle size, default to 750mL."""
    # Look for size patterns
    size_match = re.search(r'(750mL|750ml|750 ML|375mL|1\.5L|1\.5L|3L|6L|Magnum|Double Magnum)', description, re.IGNORECASE)
    if size_match:
        size = size_match.group(1).lower()
        if size in ['750ml', '750 ml']:
            return '750mL'
        return size_match.group(1)
    return '750mL'


def clean_description(description: str, sku_prefix: str) -> str:
    """
    Clean and format wine description.
    
    Returns standardized format: [Full Wine Name] [Vintage] [Pack/Size]
    Examples:
        Chateau Haut Brion 1998 1/750ml
        MacDonald Vineyards To-Kalon Cabernet 2022 3/750ml
    """
    # Remove prefix code like "BDX:HTB:HAUT-"
    cleaned = re.sub(r'^[A-Z]{3}:[A-Z]{3,}:[A-Z]+-?\s*', '', description, flags=re.IGNORECASE)
    
    # Remove pack indicators (will re-add in correct format later)
    cleaned = re.sub(r'\s*PK\d+[-\s]*', ' ', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*\d+-Pack\s*', ' ', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*OC\s*', ' ', cleaned, flags=re.IGNORECASE)
    
    # Remove size indicators (will use standardized format)
    cleaned = re.sub(r'\s*\d+mL\s*', ' ', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*\d+\.\d+L\s*', ' ', cleaned, flags=re.IGNORECASE)
    
    # Remove vintage years from the name portion (extracted separately)
    cleaned = re.sub(r'\b(19\d{2}|20\d{2})\b', '', cleaned)
    
    # Normalize whitespace
    cleaned = clean_text(cleaned)
    
    return cleaned


def format_item_description(
    wine_name: str,
    vintage: int,
    pack_size: int,
    sku_prefix: str,
    bottle_size: str = '750mL'
) -> str:
    """
    Format item description in standardized format.
    
    Format: [Full Wine Name] [Vintage] [Pack/Size]
    
    Args:
        wine_name: Cleaned wine name
        vintage: Vintage year
        pack_size: Pack size (1, 3, etc.)
        sku_prefix: SKU prefix (BDX, BUR, ITY, USR)
        bottle_size: Bottle size (default 750mL)
    
    Returns:
        Formatted description string
    """
    # Add "Chateau" prefix for specific Bordeaux wines that need it
    if sku_prefix == 'BDX':
        lower_name = wine_name.lower()
        # Don't add if already has Chateau
        if not any(prefix in lower_name for prefix in ['chateau ', 'château ']):
            # Apply specific known mappings
            lower_trimmed = wine_name.lower().strip()
            if lower_trimmed.startswith('haut brion'):
                wine_name = f"Chateau {wine_name}"
            elif lower_trimmed.startswith('mouton'):
                # Mouton → Chateau Mouton Rothschild
                wine_name = "Chateau Mouton Rothschild"
            elif lower_trimmed.startswith('troplong mondot'):
                wine_name = f"Chateau {wine_name}"
            # For all other BDX wines (La Mission Haut Brion, etc.), keep as-is
    
    # Normalize bottle size to lowercase ml format
    size_formatted = '750ml'
    if bottle_size:
        size_num = re.search(r'(\d+)', bottle_size)
        if size_num:
            size_val = size_num.group(1)
            size_formatted = f"{size_val}ml"
    
    # Format pack/size: PK/750ml
    pack_size_formatted = f"{pack_size}/{size_formatted}"
    
    # Build final description
    description = f"{wine_name} {vintage} {pack_size_formatted}"
    
    # Clean up any double spaces
    description = clean_text(description)
    
    return description


def is_item_start(line: str) -> bool:
    """Check if line starts a new item (begins with a number like '1 Sale', '2 Sale')."""
    return bool(re.match(r'^\d+\s+Sale\s+[A-Z]{3}:', line.strip()))


def parse_item_block(block: str) -> Dict[str, Any]:
    """
    Parse a multiline item block.
    
    A block starts with 'N Sale BDX:...' and ends before the next 'N Sale'
    """
    if not block:
        return None
    
    # Clean and normalize the block
    block = clean_text(block)
    if not block:
        return None
    
    # Check it starts with a valid item pattern
    if not is_item_start(block):
        return None
    
    # Extract SKU prefix
    sku_prefix = extract_sku_prefix(block)
    if not sku_prefix:
        return None
    
    # Extract pack size
    pack_size = extract_pack_size(block)
    
    # Extract vintage
    vintage = extract_vintage(block)
    
    # Extract size
    size = extract_size(block)
    
    # Extract unit price and ordered quantity
    # Format: $price qty [size/pack] $total
    price_match = re.search(r'\$([\d,]+\.\d{2})\s+(\d+)\s+(?:750|PK\d+|\d+-Pack)', block, re.IGNORECASE)
    if not price_match:
        return None
    
    price_str = price_match.group(1).replace(',', '')
    unit_price = float(price_str)
    ordered_qty = int(price_match.group(2))
    
    # Calculate bottle quantity
    quantity = ordered_qty * pack_size
    
    # Extract raw description from the block
    # Pattern: Sale PREFIX:CODE:DESC- wine_name year size...
    # Get everything after 'Sale ' and before the unit price
    desc_match = re.search(r'Sale\s+([A-Z]{3}:[A-Z:]+-[A-Za-z\s]+?)\s+\d{4}', block)
    if desc_match:
        raw_description = desc_match.group(1).rstrip()
    else:
        # Fallback: extract between Sale and first $
        fallback = re.search(r'Sale\s+(.+?)\s+\$', block)
        if fallback:
            raw_description = fallback.group(1).rstrip()
        else:
            raw_description = ""
    
    # Also look for additional wine name parts in continuation lines (after internal codes)
    # Examples: "Cabernet" for MacDonald, "Monfortino" for Conterno
    # Pattern: look for text after internal code like "XXXX-YYYY-F0L0C0 "
    continuation_match = re.search(r'\d{4}-F0L0C0\s+([A-Za-z]+(?:\s+\d{4})?)', block)
    if continuation_match:
        additional_text = continuation_match.group(1).strip()
        # Only add if it's not just a vintage year
        if additional_text and not re.match(r'^\d{4}$', additional_text):
            # Check if this text is already in the name
            if additional_text.lower() not in raw_description.lower():
                raw_description = f"{raw_description} {additional_text}"
    
    # Also capture variety names like "Cabernet" that appear after internal codes
    variety_match = re.search(r'F0L0C0\s+([A-Za-z]+)(?:\s+\d{4})?', block)
    if variety_match:
        variety = variety_match.group(1)
        if variety.lower() not in raw_description.lower():
            raw_description = f"{raw_description} {variety}"
    
    # Get base cleaned name
    clean_name = clean_description(raw_description, sku_prefix)
    
    # Format full standardized description
    description = format_item_description(
        wine_name=clean_name,
        vintage=vintage,
        pack_size=pack_size,
        sku_prefix=sku_prefix,
        bottle_size=size
    )
    
    return {
        'sku_prefix': sku_prefix,
        'raw_description': raw_description,
        'clean_description': clean_name,
        'description': description,
        'vintage': vintage,
        'size': size,
        'unit_price': unit_price,
        'ordered_qty': ordered_qty,
        'pack_size': pack_size,
        'quantity': quantity,
    }


def parse_grw_pdf(pdf_path: str) -> List[Dict[str, Any]]:
    """
    Parse a GRW invoice PDF and extract line items.
    
    Args:
        pdf_path: Path to the PDF file
        
    Returns:
        List of line item dictionaries
    """
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    
    items = []
    
    with pdfplumber.open(pdf_path) as pdf:
        for page in pdf.pages:
            text = page.extract_text()
            if not text:
                continue
            
            lines = text.split('\n')
            current_block = []
            
            for line in lines:
                line = line.strip()
                if not line:
                    continue
                
                # Skip header/footer lines
                if any(skip in line for skip in ['Sales Order', 'GRW Wine Collection', 'Order #', 'Subtotal:', 'Total:', 'Terms', 'Approval']):
                    continue
                
                # Check if this line starts a new item
                if is_item_start(line):
                    # Process previous block if exists
                    if current_block:
                        block_text = ' '.join(current_block)
                        item = parse_item_block(block_text)
                        if item:
                            items.append(item)
                    # Start new block
                    current_block = [line]
                elif current_block:
                    # Continue current block
                    current_block.append(line)
            
            # Process final block
            if current_block:
                block_text = ' '.join(current_block)
                item = parse_item_block(block_text)
                if item:
                    items.append(item)
    
    return items


if __name__ == '__main__':
    # Test parsing
    pdf_path = '/Users/markyaeger/Documents/stem-order-mvp/modules/po_tools/grw_invoice_converter/test_data/S58672.pdf'
    items = parse_grw_pdf(pdf_path)
    print(f"Parsed {len(items)} line items:")
    for i, item in enumerate(items, 1):
        print(f"\n{i}. {item['clean_description']}")
        print(f"   SKU: {item['sku_prefix']}, Vintage: {item['vintage']}, Size: {item['size']}")
        print(f"   Price: ${item['unit_price']}, Pack: {item['pack_size']}, Qty: {item['quantity']} bottles")
