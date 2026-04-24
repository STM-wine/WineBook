"""
GRW Invoice Converter Test Runner

Orchestrates the full conversion flow:
1. Parse PDF
2. Apply pricing
3. Validate
4. Export to Excel
"""

import sys
from pathlib import Path

# Add parent directory to path for imports
module_dir = Path(__file__).parent
project_root = module_dir.parent.parent.parent  # stem-order-mvp/
sys.path.insert(0, str(project_root))

from modules.po_tools.grw_invoice_converter.parser import parse_grw_pdf
from modules.po_tools.grw_invoice_converter.pricing import apply_pricing, get_pricing_summary
from modules.po_tools.grw_invoice_converter.validator import validate_invoice, ValidationError
from modules.po_tools.grw_invoice_converter.excel_exporter import export_to_excel


def get_invoice_number_from_pdf_path(pdf_path: str) -> str:
    """Extract invoice number from PDF filename."""
    path = Path(pdf_path)
    # Remove extension
    name = path.stem
    return name


def run_conversion(
    pdf_path: str = None,
    template_path: str = None,
    output_dir: str = None,
    expected_subtotal: float = 8736.75
) -> dict:
    """
    Run the full conversion flow.
    
    Args:
        pdf_path: Path to input PDF (relative to project root)
        template_path: Path to Excel template (relative to project root)
        output_dir: Output directory (relative to project root)
        expected_subtotal: Expected invoice subtotal for validation
        
    Returns:
        Dictionary with results summary
    """
    # Default paths relative to module
    if pdf_path is None:
        pdf_path = 'modules/po_tools/grw_invoice_converter/test_data/S58672.pdf'
    if template_path is None:
        template_path = 'modules/po_tools/grw_invoice_converter/templates/GRW_Template.xlsx'
    if output_dir is None:
        output_dir = 'modules/po_tools/grw_invoice_converter/output'
    
    # Resolve absolute paths
    pdf_path_abs = project_root / pdf_path
    template_path_abs = project_root / template_path
    output_dir_abs = project_root / output_dir
    
    # Generate output filename
    invoice_number = get_invoice_number_from_pdf_path(pdf_path)
    output_filename = f"Cafe Monarch GRW {invoice_number}.xlsx"
    output_path_abs = output_dir_abs / output_filename
    
    print(f"🚀 Starting GRW Invoice Conversion")
    print(f"   PDF: {pdf_path_abs}")
    print(f"   Template: {template_path_abs}")
    print(f"   Output: {output_path_abs}")
    print()
    
    # Step 1: Parse PDF
    print(f"📄 Step 1: Parsing PDF...")
    try:
        items = parse_grw_pdf(str(pdf_path_abs))
        print(f"   ✓ Parsed {len(items)} line items")
        
        # Debug output
        for i, item in enumerate(items, 1):
            print(f"   {i}. {item['clean_description'][:40]:<40} | "
                  f"SKU:{item['sku_prefix']:<4} | "
                  f"Vintage:{item['vintage']} | "
                  f"Pack:{item['pack_size']} | "
                  f"Qty:{item['quantity']} | "
                  f"Price:${item['unit_price']}")
    except Exception as e:
        print(f"   ✗ Parse failed: {e}")
        return {'success': False, 'error': f'Parse error: {e}'}
    
    print()
    
    # Step 2: Apply pricing
    print(f"💰 Step 2: Applying pricing rules...")
    try:
        priced_items = apply_pricing(items)
        summary = get_pricing_summary(priced_items)
        print(f"   ✓ Pricing applied to {summary['count']} items")
        print(f"     Total Ext Cost: ${summary['total_ext_cost']:.2f}")
        print(f"     Total Ext Price: ${summary['total_ext_price']:.2f}")
    except Exception as e:
        print(f"   ✗ Pricing failed: {e}")
        return {'success': False, 'error': f'Pricing error: {e}'}
    
    print()
    
    # Step 3: Validate
    print(f"✅ Step 3: Validating results...")
    try:
        validation_result = validate_invoice(priced_items, expected_subtotal=expected_subtotal)
        print(f"   ✓ Validation passed")
        print(f"     Checks: {', '.join(validation_result['checks_passed'])}")
        print(f"     Total Ext Cost: ${validation_result['total_ext_cost']:.2f}")
    except ValidationError as e:
        print(f"   ✗ Validation failed: {e}")
        return {'success': False, 'error': f'Validation error: {e}'}
    except Exception as e:
        print(f"   ✗ Validation error: {e}")
        return {'success': False, 'error': f'Validation error: {e}'}
    
    print()
    
    # Step 4: Export to Excel
    print(f"📊 Step 4: Exporting to Excel...")
    try:
        output_file = export_to_excel(
            priced_items,
            str(template_path_abs),
            str(output_path_abs),
            invoice_number=invoice_number
        )
        print(f"   ✓ Exported to: {output_file}")
    except Exception as e:
        print(f"   ✗ Export failed: {e}")
        return {'success': False, 'error': f'Export error: {e}'}
    
    print()
    print(f"🎉 Conversion complete!")
    
    return {
        'success': True,
        'line_count': len(priced_items),
        'total_ext_cost': summary['total_ext_cost'],
        'output_file': output_file,
        'invoice_number': invoice_number,
    }


def print_summary(results: dict):
    """Print a formatted summary of the conversion results."""
    print()
    print("=" * 50)
    print("CONVERSION SUMMARY")
    print("=" * 50)
    
    if results['success']:
        print(f"✓ Status: SUCCESS")
        print(f"  Line Items: {results['line_count']}")
        print(f"  Total Ext Cost: ${results['total_ext_cost']:.2f}")
        print(f"  Output File: {results['output_file']}")
        print()
        print(f"The converted invoice is ready for use!")
    else:
        print(f"✗ Status: FAILED")
        print(f"  Error: {results['error']}")
    
    print("=" * 50)


if __name__ == '__main__':
    import argparse
    
    parser = argparse.ArgumentParser(description='Convert GRW Invoice PDF to Excel')
    parser.add_argument('--pdf', help='Path to PDF file (relative to project root)')
    parser.add_argument('--template', help='Path to Excel template (relative to project root)')
    parser.add_argument('--output', help='Output directory (relative to project root)')
    parser.add_argument('--subtotal', type=float, default=8736.75, help='Expected subtotal')
    
    args = parser.parse_args()
    
    results = run_conversion(
        pdf_path=args.pdf,
        template_path=args.template,
        output_dir=args.output,
        expected_subtotal=args.subtotal
    )
    
    print_summary(results)
    
    # Exit with appropriate code
    sys.exit(0 if results['success'] else 1)
