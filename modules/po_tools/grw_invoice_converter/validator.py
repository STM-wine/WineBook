"""
GRW Invoice Validator

Validates parsed and priced invoice data.
"""

from typing import List, Dict, Any


class ValidationError(Exception):
    """Raised when invoice validation fails."""
    pass


def validate_required_fields(items: List[Dict[str, Any]]) -> None:
    """Validate that all required fields are populated."""
    required_fields = [
        'sku_prefix',
        'clean_description',
        'unit_price',
        'quantity',
        'pack_size',
        'fob_bottle',
        'fob_case',
        'frontline',
        'ext_cost',
        'ext_price',
    ]
    
    for i, item in enumerate(items, 1):
        for field in required_fields:
            if field not in item or item[field] is None:
                raise ValidationError(f"Line {i}: Missing required field '{field}'")
            
            # Check for empty strings
            if field in ['sku_prefix', 'clean_description'] and item[field] == '':
                raise ValidationError(f"Line {i}: Empty value for '{field}'")
            
            # Check numeric values are valid
            if field in ['unit_price', 'fob_bottle', 'fob_case', 'ext_cost', 'ext_price']:
                if item[field] < 0:
                    raise ValidationError(f"Line {i}: Negative value for '{field}': {item[field]}")
            
            if field in ['quantity', 'pack_size', 'frontline']:
                if item[field] < 0:
                    raise ValidationError(f"Line {i}: Negative value for '{field}': {item[field]}")


def validate_no_duplicate_skus(items: List[Dict[str, Any]]) -> None:
    """Validate no duplicate SKUs in the invoice."""
    seen = {}
    
    for i, item in enumerate(items, 1):
        # Create a unique key from description + vintage
        key = f"{item.get('clean_description', '')}_{item.get('vintage', 0)}"
        
        if key in seen:
            raise ValidationError(
                f"Line {i}: Duplicate item found. "
                f"First occurrence at line {seen[key]}. "
                f"Description: '{item.get('clean_description')}'"
            )
        
        seen[key] = i


def validate_pack_math(items: List[Dict[str, Any]]) -> None:
    """Validate pack size math is correct."""
    for i, item in enumerate(items, 1):
        pack_size = item.get('pack_size', 1)
        quantity = item.get('quantity', 0)
        ordered_qty = item.get('ordered_qty', 0)
        
        # Verify quantity = ordered_qty × pack_size
        expected_quantity = ordered_qty * pack_size
        if quantity != expected_quantity:
            raise ValidationError(
                f"Line {i}: Pack math error. "
                f"Expected quantity {expected_quantity} (={ordered_qty}×{pack_size}), "
                f"got {quantity}"
            )
        
        # Verify FOB math
        unit_price = item.get('unit_price', 0)
        fob_bottle = item.get('fob_bottle', 0)
        
        if pack_size > 1:
            expected_fob = unit_price / pack_size
        else:
            expected_fob = unit_price
        
        # Allow for small floating point differences
        if abs(fob_bottle - expected_fob) > 0.01:
            raise ValidationError(
                f"Line {i}: FOB Bottle math error. "
                f"Expected ${expected_fob:.2f}, got ${fob_bottle:.2f}"
            )


def validate_bordeaux_markup(items: List[Dict[str, Any]]) -> None:
    """Validate BDX markup is 15% and others have adjusted markup."""
    import math
    
    for i, item in enumerate(items, 1):
        sku_prefix = item.get('sku_prefix', '')
        fob_bottle = item.get('fob_bottle', 0)
        frontline = item.get('frontline', 0)
        
        base_markup = fob_bottle * 1.15
        
        if sku_prefix == 'BDX':
            expected_frontline = math.ceil(base_markup)
            if frontline != expected_frontline:
                raise ValidationError(
                    f"Line {i}: BDX frontline error. "
                    f"Expected ${expected_frontline} (ceil({fob_bottle}×1.15)), "
                    f"got ${frontline}"
                )
        else:
            expected_frontline = math.ceil(base_markup / 1.05)
            if frontline != expected_frontline:
                raise ValidationError(
                    f"Line {i}: Non-BDX frontline error. "
                    f"Expected ${expected_frontline} (ceil({fob_bottle}×1.15/1.05)), "
                    f"got ${frontline}"
                )


def validate_ext_cost_sum(items: List[Dict[str, Any]], expected_total: float = 8736.75) -> None:
    """Validate that sum of Ext Cost matches invoice subtotal."""
    total_ext_cost = sum(item.get('ext_cost', 0) for item in items)
    
    # Allow for small rounding differences
    if abs(total_ext_cost - expected_total) > 0.01:
        raise ValidationError(
            f"Total Ext Cost mismatch. "
            f"Expected ${expected_total:.2f}, got ${total_ext_cost:.2f}. "
            f"Difference: ${abs(total_ext_cost - expected_total):.2f}"
        )


def validate_invoice(items: List[Dict[str, Any]], expected_subtotal: float = 8736.75) -> Dict[str, Any]:
    """
    Validate all aspects of the priced invoice data.
    
    Args:
        items: List of priced line items
        expected_subtotal: Expected sum of Ext Cost (default: 8736.75)
        
    Returns:
        Dictionary with validation results
        
    Raises:
        ValidationError: If any validation fails
    """
    # Run all validations
    validate_required_fields(items)
    validate_no_duplicate_skus(items)
    validate_pack_math(items)
    validate_bordeaux_markup(items)
    validate_ext_cost_sum(items, expected_subtotal)
    
    return {
        'valid': True,
        'line_count': len(items),
        'total_ext_cost': round(sum(item.get('ext_cost', 0) for item in items), 2),
        'checks_passed': [
            'required_fields',
            'no_duplicates',
            'pack_math',
            'bordeaux_markup',
            'ext_cost_sum',
        ]
    }


if __name__ == '__main__':
    # Test validation
    test_items = [
        {
            'sku_prefix': 'BDX',
            'clean_description': 'Haut Brion',
            'vintage': 1998,
            'size': '750mL',
            'unit_price': 695.00,
            'pack_size': 1,
            'ordered_qty': 1,
            'quantity': 1,
            'fob_bottle': 695.00,
            'fob_case': 695.00,
            'frontline': 800,  # ceil(695 * 1.15) = 800
            'ext_cost': 695.00,
            'ext_price': 800.00,
        },
        {
            'sku_prefix': 'USR',
            'clean_description': 'MacDonald To-Kalon',
            'vintage': 2022,
            'size': '750mL',
            'unit_price': 2199.75,
            'pack_size': 3,
            'ordered_qty': 1,
            'quantity': 3,
            'fob_bottle': 733.25,  # 2199.75 / 3
            'fob_case': 2199.75,
            'frontline': 803,  # ceil(733.25 * 1.15 / 1.05) = 803
            'ext_cost': 2199.75,  # 733.25 * 3
            'ext_price': 2409.00,  # 803 * 3
        }
    ]
    
    try:
        result = validate_invoice(test_items, expected_subtotal=2894.75)
        print(f"Validation passed: {result}")
    except ValidationError as e:
        print(f"Validation failed: {e}")
