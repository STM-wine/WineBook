"""
GRW Invoice Parser

Extracts structured line items from GRW invoice PDFs.
"""

import re
import os
import sys
import pdfplumber
from pathlib import Path
from typing import List, Dict, Any

try:
    from .ocr import extract_text_with_ocr
except ImportError:  # Support direct execution during local debugging.
    from ocr import extract_text_with_ocr


# GRW repeats the line-item table on continuation pages, but those pages do not
# always include the word "Sale".  Keep one definition of a row start so the
# block scanner and the item parser cannot silently disagree about valid rows.
ITEM_START_RE = re.compile(
    r'^\s*(?P<line_number>\d+)\s+'
    r'(?:(?:Sale)\s+)?'
    r'(?P<sku_prefix>[A-Z][A-Z0-9]{1,4}):'
    r'(?P<item_code>\S+)\s+',
    re.IGNORECASE,
)

CURRENCY_RE = re.compile(r'\$\s*([\d,]+\.\d{2})')
GRW_TRAILER_PATTERN = r'F[0O]L[0O]C[0O]?'


def parse_currency_value(value: str | None) -> float | None:
    """Convert a currency-like string into a float."""
    if not value:
        return None
    cleaned = value.replace(",", "").replace("$", "").replace(" ", "").strip()
    if not cleaned:
        return None
    try:
        return float(cleaned)
    except ValueError:
        return None


def extract_invoice_adjustments(text: str) -> list[Dict[str, Any]]:
    """Extract signed discount/credit rows that reduce the invoice subtotal."""
    compact_text = clean_text(text)
    adjustment_pattern = re.compile(
        r'\b(?P<line_number>\d+)\s+'
        r'(?P<type>Discount|Credit)\s+'
        r'(?P<label>.*?)'
        r'(?P<amount>(?:-\s*\$\s*|\$\s*-\s*|\(\s*\$\s*)[\d,]+\.\d{2}\s*\)?)'
        r'(?=\s|$)',
        re.IGNORECASE,
    )

    adjustments: list[Dict[str, Any]] = []
    for match in adjustment_pattern.finditer(compact_text):
        parsed_amount = parse_currency_value(match.group("amount").replace("(", "").replace(")", ""))
        if parsed_amount is None:
            continue
        adjustments.append(
            {
                "line_number": int(match.group("line_number")),
                "type": match.group("type").title(),
                "description": clean_text(match.group("label")),
                # Discount and credit rows reduce the merchandise total even
                # when a PDF extractor separates the printed minus from "$".
                "amount": -abs(parsed_amount),
            }
        )

    return adjustments


def clean_text(text: str) -> str:
    """Remove hidden unicode characters and normalize whitespace."""
    if not text:
        return ""
    # Remove zero-width and control characters
    text = re.sub(r'[\u200b\u200c\u200d\ufeff\x00-\x08\x0b-\x0c\x0e-\x1f]', '', text)
    # Normalize whitespace
    text = ' '.join(text.split())
    return text.strip()


def extract_pdf_text_pages(pdf_path: str | Path) -> tuple[list[str], bool]:
    """Extract PDF text, falling back to OCR when every page is image-only."""
    pdf_path_obj = Path(pdf_path)
    page_text: list[str] = []
    with pdfplumber.open(pdf_path_obj) as pdf:
        for page in pdf.pages:
            page_text.append(page.extract_text() or "")

    if any(text.strip() for text in page_text):
        return page_text, False

    ocr_text = extract_text_with_ocr(pdf_path_obj)
    ocr_pages = [text.strip() for text in ocr_text.split("\f")]
    return ocr_pages or [ocr_text], True


def extract_invoice_summary_from_text(text: str) -> Dict[str, Any]:
    """Extract invoice-level payment/credit summary values from raw PDF text."""
    summary: Dict[str, Any] = {}
    if not text:
        return summary

    compact_text = clean_text(text)

    adjustments = extract_invoice_adjustments(text)
    if adjustments:
        summary["adjustments"] = adjustments
        summary["adjustment_total"] = round(
            sum(adjustment["amount"] for adjustment in adjustments),
            2,
        )

    credit_match = re.search(
        r'(\d{2}/\d{2}/\d{4})\s+Credit\s+\$\s*([\d,]+\.\d{2})',
        compact_text,
        re.IGNORECASE,
    )
    if credit_match:
        summary["credit_date"] = credit_match.group(1)
        summary["credit_amount"] = parse_currency_value(credit_match.group(2))

    currency_patterns = {
        "subtotal": r'Subtotal:\s*\$?\s*([\d,]+\.\d{2})',
        "sales_tax": r'Sales Tax:\s*\$?\s*([\d,]+\.\d{2})',
        "total": r'\bTotal:\s*\$?\s*([\d,]+\.\d{2})',
        "paid_amount": r'Paid:\s*\$?\s*([\d,]+\.\d{2})',
        "balance_due": r'Balance Due:\s*\$?\s*([\d,]+\.\d{2})',
        "shipping_amount": r'Shipping Charge\s*\$?\s*([\d,]+\.\d{2})',
    }
    for key, pattern in currency_patterns.items():
        match = re.search(pattern, compact_text, re.IGNORECASE)
        if match:
            summary[key] = parse_currency_value(match.group(1))

    return summary


def extract_invoice_summary(pdf_path: str) -> Dict[str, Any]:
    """Extract invoice-level payment/credit summary values from a GRW PDF."""
    pdf_path_obj = Path(pdf_path)
    if not pdf_path_obj.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path_obj}")

    page_text, _ = extract_pdf_text_pages(pdf_path_obj)

    return extract_invoice_summary_from_text("\n".join(page_text))


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
    size_match = re.search(r'(750mL|750ml|750 ML|375mL|1\.5L|3L|6L|Magnum|Double Magnum)', description, re.IGNORECASE)
    if size_match:
        size = size_match.group(1).lower()
        if size in ['750ml', '750 ml']:
            return '750mL'
        if size == '1.5l':
            return '1.5L'
        return size_match.group(1)
    return '750mL'


def clean_description(description: str, sku_prefix: str) -> str:
    """
    Clean and format wine description.
    
    Returns standardized format: [Full Wine Name] [Vintage] [Pack/Size]
    
    Examples:
        Input: "0750- Gaja Barbaresco 2009 750mL" → Output: "Gaja Barbaresco 2009 1/750ml"
        Input: "Chateau Haut Brion 1998 750mL" → Output: "Chateau Haut Brion 1998 1/750ml"
        Input: "MacDonald Vineyards To-Kalon Cabernet 2022 750mL" → Output: "MacDonald Vineyards To-Kalon Cabernet 2022 3/750ml"
    """
    # Remove prefix code like "BDX:HTB:HAUT-"
    cleaned = re.sub(r'^[A-Z]{3}:[A-Z]{3,}:[A-Z]+-?\s*', '', description, flags=re.IGNORECASE)
    
    # Remove leading bottle-size codes like ":0750-", "0750-", "750-", "1500-", "0375-", "1.5L-"
    # Handles optional leading punctuation (colon, semicolon, comma, dash)
    cleaned = re.sub(r'^\s*[:;,–-]*\s*(?:0?375|0?750|1500|3000|1\.5L)\s*[-–—]\s*', '', cleaned, flags=re.IGNORECASE)
    
    # Remove PDF footer/header contamination
    # Pattern: [Month] [day], [year] [time] AM/PM PDT Page X of Y
    # Example: April 22, 2026 12:10:34 PM PDT Page 1 of 2
    # Handle variations: Page 1 of2 (no space), different timezones
    cleaned = re.sub(
        r'\b(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+'
        r'\d{1,2},?\s+\d{4}\s+\d{1,2}:\d{2}:\d{2}\s+(?:AM|PM)?\s*(?:PDT|PST|GMT|UTC)?\s*'
        r'Page\s*\d+\s*of\s*\d+',
        '',
        cleaned,
        flags=re.IGNORECASE
    )
    
    # Remove simpler page number patterns with various spacing
    # Examples: Page 1 of 2, Page 1 of2, Page1 of 2
    cleaned = re.sub(r'Page\s*\d+\s*of\s*\d+', '', cleaned, flags=re.IGNORECASE)
    
    # Remove standalone page numbers at end or middle
    cleaned = re.sub(r'\bPage\s*\d+\b', '', cleaned, flags=re.IGNORECASE)
    
    # Remove company name that appears in headers
    cleaned = re.sub(r'GRW\s*Wine\s*Collection,?\s*Inc\.?', '', cleaned, flags=re.IGNORECASE)

    # Remove GRW code fragments that can leak into wrapped descriptions.
    cleaned = re.sub(rf'\b[A-Z0-9]{{2,}}-\d{{4}}-{GRW_TRAILER_PATTERN}\b', ' ', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(rf'\b(?:0?375|0?750|1500|3000)-\d{{4}}-{GRW_TRAILER_PATTERN}\b', ' ', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(rf'(?<![A-Z0-9])[-–—]*{GRW_TRAILER_PATTERN}\b', ' ', cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r'\s*--+\s*', ' ', cleaned)
    cleaned = re.sub(r'\s*[-–—]+\s*(?=\d{4}\b)', ' ', cleaned)
    
    # Remove Order # Date lines
    cleaned = re.sub(r'Order\s*#\s*Date\s*S\d+\s+\d{1,2}/\d{1,2}/\d{4}', '', cleaned, flags=re.IGNORECASE)
    
    # Clean up any leftover double spaces
    cleaned = re.sub(r'\s+', ' ', cleaned).strip()
    
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
        size_lower = bottle_size.lower()
        if size_lower in {'750ml', '750 ml'}:
            size_formatted = '750ml'
        elif size_lower == '375ml':
            size_formatted = '375ml'
        elif size_lower == '1.5l':
            size_formatted = '1500ml'
        elif size_lower == '3l':
            size_formatted = '3000ml'
        elif size_lower == '6l':
            size_formatted = '6000ml'
        else:
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
    """
    Check if line starts a new item.
    Matches patterns like:
    - '1 Sale BDX:' (standard format)
    - '17 BDX:' (page 2 continuation without 'Sale')
    - '25 ITY:' (page 2 continuation without 'Sale')
    """
    return ITEM_START_RE.match(line.strip()) is not None


def extract_item_number_from_start(line: str) -> int | None:
    """Extract the leading GRW item number when a line starts a new item."""
    match = ITEM_START_RE.match(line.strip())
    return int(match.group('line_number')) if match else None


def is_description_continuation_line(line: str) -> bool:
    """Return True when a wrapped PDF line should be appended to the current item description.

    GRW PDFs sometimes wrap long Burgundy/Bordeaux descriptions onto the next text line.
    Those wrapped lines should stay with the current item instead of being ignored or
    misread as a new row. We exclude code/price metadata lines so the description stays
    human-readable and duplicate validation compares the full wine name.
    """
    candidate = line.strip()
    if not candidate:
        return False
    if is_item_start(candidate):
        return False
    if re.match(r'^\s*\d+\s+(?:Shipping|Freight|Handling|Discount|Credit|Tax)\b', candidate, re.IGNORECASE):
        return False
    if re.match(r'^\s*Order\s*#', candidate, re.IGNORECASE):
        return False
    if re.match(r'^\s*Page\s+\d+', candidate, re.IGNORECASE):
        return False
    if re.match(r'^\s*Date\s+Payment\s+Amount\b', candidate, re.IGNORECASE):
        return False
    if re.match(r'^\s*\d{2}/\d{2}/\d{4}\s+Credit\b', candidate, re.IGNORECASE):
        return False
    if re.match(r'^\s*(Subtotal|Sales Tax|Total|Paid|Balance Due|Approval|Terms and Conditions)\b', candidate, re.IGNORECASE):
        return False
    return True


def extract_description_fragment_from_line(line: str) -> str:
    """Extract only the description-bearing portion of a wrapped continuation line.

    Real GRW PDFs can wrap a long wine name onto the next line while also carrying
    vintage, size, or even some repeated price/quantity fragments in that same line.
    We keep the meaningful descriptive text and strip row metadata so the parser
    preserves distinct wine names without weakening duplicate validation.
    """
    candidate = clean_text(line)
    if not candidate or not is_description_continuation_line(candidate):
        return ""

    # If a GRW code prefix appears at the start of the wrapped line, strip only that
    # prefix and keep any descriptive text that follows.
    candidate = re.sub(
        rf'^\s*(?:[A-Z0-9]{{2,}}|0?375|0?750|1500|3000)-\d{{4}}-{GRW_TRAILER_PATTERN}\b\s*',
        '',
        candidate,
        flags=re.IGNORECASE,
    )

    # Remove remaining PDF row metadata/code fragments that are not part of the wine name.
    candidate = re.sub(rf'\b(?:[A-Z0-9]{{2,}}|0?375|0?750|1500|3000)-\d{{4}}-{GRW_TRAILER_PATTERN}\b', ' ', candidate, flags=re.IGNORECASE)
    candidate = re.sub(rf'(?<![A-Z0-9])[-–—]*{GRW_TRAILER_PATTERN}\b', ' ', candidate, flags=re.IGNORECASE)
    candidate = re.sub(r'\$[\d,]+\.\d{2}', ' ', candidate)
    candidate = re.sub(r'\b\d+\s+(?=(?:750|375|1500|3000|1\.5L|PK\d|\d+-Pack)\b)', ' ', candidate, flags=re.IGNORECASE)
    candidate = re.sub(r'\b(?:PK\d+|\d+-Pack)\b', ' ', candidate, flags=re.IGNORECASE)
    candidate = re.sub(r'\s*--+\s*', ' ', candidate)
    candidate = re.sub(r'\s*[-–—]+\s*(?=\d{4}\b)', ' ', candidate)
    candidate = clean_text(candidate)

    # Ignore lines that are now just bottle size or other non-description leftovers.
    if not re.search(r'[A-Za-z]', candidate):
        return ""
    if re.match(r'^(Date\s+Payment\s+Amount|Credit|Subtotal|Sales Tax|Total|Paid|Balance Due|Approval|Terms and Conditions)\b', candidate, re.IGNORECASE):
        return ""
    if re.fullmatch(r'(?:750mL|750ml|375mL|1500|3000|1\.5L)', candidate, flags=re.IGNORECASE):
        return ""
    return candidate


def parse_item_block(block: str) -> Dict[str, Any]:
    """
    Parse a multiline item block with flexible format handling.
    
    Handles both formats:
    - Inline: "12 Sale RHN:RAY:RAYA- Chateau Rayas... $price qty..."
    - Wrapped: "12 Sale RHN:RAY:RAYA- Chateau Rayas... $price qty...\n0750-2001-F0L0C0 2001 750mL"
    """
    if not block:
        return None
    
    try:
        # Work with original block to preserve line structure
        lines = block.strip().split('\n')
        if not lines:
            return None
        
        # Check first line starts with valid item pattern
        first_line = lines[0].strip()
        if not is_item_start(first_line):
            return None
        
        # Extract the row metadata once. Continuation pages may omit "Sale".
        item_match = ITEM_START_RE.match(first_line)
        if not item_match:
            return None
        line_number = int(item_match.group('line_number'))
        sku_prefix = item_match.group('sku_prefix').upper()
        
        # Extract all dollar amounts from the entire block
        dollar_amounts = CURRENCY_RE.findall(block)
        if len(dollar_amounts) < 1:
            return None
        
        # First dollar amount is unit price, last is total
        unit_price = float(dollar_amounts[0].replace(',', ''))
        ext_cost = float(dollar_amounts[-1].replace(',', ''))
        
        # Extract quantity - the number between first price and bottle size or before last price
        # Pattern: $price qty 750 or similar
        qty_match = re.search(
            r'\$\s*[\d,]+\.\d{2}\s+(\d+)\s+'
            r'(?:0?750|0?375|1500|1\.5L|3000|PK\d+|\d+-Pack)',
            block,
            re.IGNORECASE,
        )
        if not qty_match:
            # OCR can collapse the ordered quantity and size columns ("1 750" -> "1750").
            qty_match = re.search(
                r'\$\s*[\d,]+\.\d{2}\s+(\d+?)(?:0?750|0?375|1500|3000)\s+\$\s*[\d,]+\.\d{2}',
                block,
                re.IGNORECASE,
            )
        if not qty_match:
            # Try alternative: number before bottle size marker
            qty_match = re.search(
                r'\$\s*[\d,]+\.\d{2}[^\n]*\n.*?(\d+)\s+'
                r'(?:0?750|0?375|1500|1\.5L|3000)m?L?',
                block,
                re.IGNORECASE | re.DOTALL,
            )
        ordered_qty = int(qty_match.group(1)) if qty_match else 1
        
        # Extract pack size (default 1 for single bottles)
        pack_match = re.search(r'PK(\d+)|(\d+)-Pack', block, re.IGNORECASE)
        pack_size = int(pack_match.group(1) or pack_match.group(2)) if pack_match else 1
        
        # Calculate total quantity
        quantity = ordered_qty * pack_size
        
        # Extract vintage from code line (e.g., "0750-2001-F0L0C0")
        vintage_match = re.search(
            rf'(?:PK\d+|0?375|0?750|1500|3000|[A-Z0-9]+)-(19\d{{2}}|20\d{{2}})-{GRW_TRAILER_PATTERN}',
            block,
            re.IGNORECASE,
        )
        vintage = int(vintage_match.group(1)) if vintage_match else extract_vintage(block)
        
        # Extract bottle size
        size_match = re.search(
            r'(?<!\d)(0?750|0?375|1500|3000|1\.5L)(?:mL)?(?!\d)',
            block,
            re.IGNORECASE,
        )
        size = size_match.group(1).lstrip('0') if size_match else '750'
        
        # The match ends immediately before the human-readable description.
        # Split on a currency token that permits both "$12.00" and "$ 12.00".
        description_and_prices = first_line[item_match.end():]
        raw_description = re.split(r'\$\s*[\d,]+\.\d{2}', description_and_prices, maxsplit=1)[0].strip()

        continuation_lines = []
        for line in lines[1:]:
            fragment = extract_description_fragment_from_line(line)
            if fragment:
                continuation_lines.append(fragment)
        if continuation_lines:
            raw_description = clean_text(" ".join([raw_description, *continuation_lines]))
        
        # Clean up description: remove qty/price fragments
        raw_description = re.sub(r'\$\s*[\d,]+\.\d{2}', '', raw_description).strip()
        raw_description = re.sub(r'\d+\s+(?:0?750|0?375|1500|3000|1\.5L)m?L?', '', raw_description, flags=re.IGNORECASE).strip()
        
        # If vintage is in code line but not in description, add it
        # Convert vintage to string for comparison
        vintage_str = str(vintage) if vintage else ''
        if vintage_str and vintage_str not in raw_description:
            raw_description = f"{raw_description} {vintage}"
        
        # Clean and format
        clean_name = clean_description(raw_description, sku_prefix)
        
        # Format description
        description = format_item_description(
            wine_name=clean_name,
            vintage=vintage,
            pack_size=pack_size,
            sku_prefix=sku_prefix,
            bottle_size=size
        )
        
        return {
            'line_number': line_number,
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
            'ext_cost': ext_cost,
        }
    
    except Exception as e:
        print(f"PARSE ITEM BLOCK ERROR: {e}", file=sys.stderr)
        print(f"BLOCK: {block[:200]}", file=sys.stderr)
        raise


def parse_grw_pdf(pdf_path: str, debug: bool = False) -> tuple[List[Dict[str, Any]], int, Dict]:
    """
    Parse a GRW invoice PDF and extract line items using block-based parsing.
    
    Handles multi-line wrapped items by splitting text into blocks using regex.
    
    Args:
        pdf_path: Path to the PDF file
        debug: If True, return detailed debug info
        
    Returns:
        Tuple of (items list, pages_parsed count, debug_info dict)
    """
    pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    
    items = []
    pages_parsed = 0
    all_item_numbers = []
    items_per_page = {}
    unparsed_blocks = []
    
    # Strict footer markers
    strict_footer_markers = [
        'Total:', 'Subtotal:', 'Sales Tax:', 'Balance Due:', 
        'Terms and Conditions:', 'Approval:', 'Grand Total:'
    ]
    
    # Header markers
    header_markers = ['Sales Order', 'GRW Wine Collection', 'Order # Date']
    
    trace_lines = debug and os.getenv("GRW_PDF_TRACE", "").strip() == "1"
    
    page_text, ocr_used = extract_pdf_text_pages(pdf_path)
    pdf_page_count = len(page_text)

    for page_num, text in enumerate(page_text, 1):
            pages_parsed += 1
            page_items = []
            
            if not text:
                items_per_page[page_num] = 0
                continue
            
            # Split text into lines for processing
            lines = text.split('\n')

            if trace_lines:
                print(f"GRW PAGE TRACE START page={page_num}", file=sys.stderr)
                for idx, raw_line in enumerate(lines, 1):
                    print(f"PDF TEXT LINE {idx:03d}: {raw_line}", file=sys.stderr)
                print(f"GRW PAGE TRACE END page={page_num}", file=sys.stderr)
            
            # First pass: identify item boundaries and extract blocks
            item_blocks = []
            current_block_lines = []
            current_block_start = None
            current_block_item_number = None
            traced_item_numbers = {5, 6, 7}
            
            for line_idx, line in enumerate(lines):
                line_stripped = line.strip()
                if not line_stripped:
                    if trace_lines and current_block_item_number in {5, 6}:
                        print(
                            f"TRACE page={page_num} line={line_idx + 1:03d} "
                            f"classified=ignored_blank current_item={current_block_item_number}",
                            file=sys.stderr,
                        )
                    continue
                
                line_item_number = extract_item_number_from_start(line_stripped)
                trace_current_context = trace_lines and (
                    line_item_number in traced_item_numbers or current_block_item_number in {5, 6}
                )

                # Check for footer markers - stop parsing this page
                line_lower = line_stripped.lower()
                if any(marker.lower() in line_lower for marker in strict_footer_markers):
                    if trace_current_context:
                        print(
                            f"TRACE page={page_num} line={line_idx + 1:03d} "
                            f"classified=footer current_item={current_block_item_number} text={line_stripped}",
                            file=sys.stderr,
                        )
                    # Save current block if exists
                    if current_block_lines:
                        block_text = '\n'.join(current_block_lines)
                        item_blocks.append((current_block_start, block_text))
                        current_block_lines = []
                        current_block_start = None
                        current_block_item_number = None
                    break
                
                # Skip header lines
                if any(skip in line_stripped for skip in header_markers):
                    if trace_current_context:
                        print(
                            f"TRACE page={page_num} line={line_idx + 1:03d} "
                            f"classified=header current_item={current_block_item_number} text={line_stripped}",
                            file=sys.stderr,
                        )
                    continue
                
                # Check if this line starts a new item
                if is_item_start(line_stripped):
                    if trace_lines and line_item_number in traced_item_numbers:
                        print(
                            f"TRACE ITEM START page={page_num} line={line_idx + 1:03d} "
                            f"item={line_item_number} text={line_stripped}",
                            file=sys.stderr,
                        )
                    # Save previous block if exists
                    if current_block_lines:
                        block_text = '\n'.join(current_block_lines)
                        item_blocks.append((current_block_start, block_text))
                    # Start new block
                    current_block_lines = [line_stripped]
                    current_block_start = line_idx
                    current_block_item_number = line_item_number
                elif re.match(
                    r'^\s*\d+\s+(?:Shipping|Freight|Handling|Discount|Credit|Tax)\b',
                    line_stripped,
                    re.IGNORECASE,
                ):
                    # Non-wine charges occupy the same table but must not be appended
                    # to the preceding wine's wrapped description.
                    if current_block_lines:
                        block_text = '\n'.join(current_block_lines)
                        item_blocks.append((current_block_start, block_text))
                    current_block_lines = []
                    current_block_start = None
                    current_block_item_number = None
                elif current_block_lines:
                    # Continue current block
                    current_block_lines.append(line_stripped)
                    if trace_current_context:
                        classification = (
                            "continuation_candidate"
                            if is_description_continuation_line(line_stripped)
                            else "metadata_candidate"
                        )
                        print(
                            f"TRACE page={page_num} line={line_idx + 1:03d} "
                            f"classified={classification} current_item={current_block_item_number} text={line_stripped}",
                            file=sys.stderr,
                        )
                elif trace_current_context:
                    print(
                        f"TRACE page={page_num} line={line_idx + 1:03d} "
                        f"classified=ignored_outside_block current_item={current_block_item_number} text={line_stripped}",
                        file=sys.stderr,
                    )
            
            # Don't forget the last block
            if current_block_lines:
                block_text = '\n'.join(current_block_lines)
                item_blocks.append((current_block_start, block_text))
            
            # Second pass: parse each block
            for block_start, block_text in item_blocks:
                block_item_number = extract_item_number_from_start(block_text.split('\n', 1)[0])
                if trace_lines and block_item_number in traced_item_numbers:
                    print(
                        f"TRACE BLOCK page={page_num} item={block_item_number} start_line={block_start + 1:03d}\n"
                        f"{block_text}\nEND TRACE BLOCK",
                        file=sys.stderr,
                    )
                # Try to parse as item
                item = parse_item_block(block_text)
                if item:
                    items.append(item)
                    page_items.append(item)
                    all_item_numbers.append(item.get('line_number', 0))
                else:
                    # Save for debug
                    unparsed_blocks.append(block_text[:200])  # First 200 chars
            
            items_per_page[page_num] = len(page_items)
    
    # Debug output for unparsed blocks
    if debug and unparsed_blocks:
        # stdout is a machine-readable JSON channel for the Next.js bridge.
        # Diagnostics must stay on stderr or one bad row breaks the whole upload.
        print(f"⚠️ UNPARSED BLOCKS: {len(unparsed_blocks)}", file=sys.stderr)
        for i, block in enumerate(unparsed_blocks[:3]):  # Show first 3
            print(f"UNPARSED BLOCK {i+1}:\n{block}\n", file=sys.stderr)
    
    # Build debug info
    debug_info = {
        'pdf_page_count': pdf_page_count,
        'pages_parsed': pages_parsed,
        'items_per_page': items_per_page,
        'total_items': len(items),
        'item_numbers': sorted(all_item_numbers) if all_item_numbers else [],
        'first_item_number': min(all_item_numbers) if all_item_numbers else None,
        'last_item_number': max(all_item_numbers) if all_item_numbers else None,
        'unparsed_blocks_count': len(unparsed_blocks),
        'ocr_used': ocr_used,
    }
    
    # Check for missing item numbers
    if all_item_numbers:
        expected = set(range(1, max(all_item_numbers) + 1))
        actual = set(all_item_numbers)
        missing = sorted(expected - actual)
        debug_info['missing_item_numbers'] = missing
    
    if debug:
        return items, pages_parsed, debug_info
    return items, pages_parsed, {}


if __name__ == '__main__':
    # Test parsing
    pdf_path = Path(__file__).resolve().parent / 'test_data' / 'S58672.pdf'
    items, _, _ = parse_grw_pdf(str(pdf_path))
    print(f"Parsed {len(items)} line items:")
    for i, item in enumerate(items, 1):
        print(f"\n{i}. {item['clean_description']}")
        print(f"   SKU: {item['sku_prefix']}, Vintage: {item['vintage']}, Size: {item['size']}")
        print(f"   Price: ${item['unit_price']}, Pack: {item['pack_size']}, Qty: {item['quantity']} bottles")
