"""
GRW Invoice Pricing Module

Applies pricing rules to parsed line items.
"""

import math
from typing import List, Dict, Any


def calculate_fob_bottle(unit_price: float, pack_size: int) -> float:
    """
    Calculate FOB Bottle price.
    
    If pack_size > 1: FOB Bottle = unit_price / pack_size
    Else: FOB Bottle = unit_price
    """
    if pack_size > 1:
        return unit_price / pack_size
    return unit_price


def calculate_fob_case(fob_bottle: float, pack_size: int) -> float:
    """
    Calculate FOB Case price.
    
    FOB Case = FOB Bottle × pack_size
    """
    return fob_bottle * pack_size


def calculate_frontline(fob_bottle: float, sku_prefix: str) -> int:
    """
    Calculate Frontline price (rounded up to whole dollar).
    
    If BDX: ceil(FOB Bottle × 1.15)
    Else: ceil((FOB Bottle × 1.15 / 1.05))
    """
    base_markup = fob_bottle * 1.15
    
    if sku_prefix == "BDX":
        return math.ceil(base_markup)
    else:
        return math.ceil(base_markup / 1.05)


def apply_pricing(items: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """
    Apply pricing calculations to parsed line items.
    
    Args:
        items: List of parsed line item dictionaries
        
    Returns:
        List of line items with pricing fields added:
        - fob_bottle
        - fob_case
        - frontline
        - ext_cost
        - ext_price
    """
    priced_items = []
    
    for item in items:
        # Extract values
        unit_price = item['unit_price']
        pack_size = item['pack_size']
        quantity = item['quantity']
        sku_prefix = item['sku_prefix']
        
        # Calculate pricing
        fob_bottle = calculate_fob_bottle(unit_price, pack_size)
        fob_case = calculate_fob_case(fob_bottle, pack_size)
        frontline = calculate_frontline(fob_bottle, sku_prefix)
        
        # Calculate extended values
        ext_cost = fob_bottle * quantity
        ext_price = frontline * quantity
        
        # Create priced item with all original fields plus pricing
        priced_item = {
            **item,
            'fob_bottle': round(fob_bottle, 2),
            'fob_case': round(fob_case, 2),
            'frontline': frontline,
            'ext_cost': round(ext_cost, 2),
            'ext_price': round(ext_price, 2),
        }
        
        priced_items.append(priced_item)
    
    return priced_items


def get_pricing_summary(items: List[Dict[str, Any]]) -> Dict[str, Any]:
    """
    Get summary statistics for priced items.
    
    Returns:
        Dictionary with total counts and sums
    """
    if not items:
        return {
            'count': 0,
            'total_ext_cost': 0.0,
            'total_ext_price': 0.0,
        }
    
    total_ext_cost = sum(item['ext_cost'] for item in items)
    total_ext_price = sum(item['ext_price'] for item in items)
    
    return {
        'count': len(items),
        'total_ext_cost': round(total_ext_cost, 2),
        'total_ext_price': round(total_ext_price, 2),
    }


if __name__ == '__main__':
    # Test pricing
    test_items = [
        {
            'sku_prefix': 'BDX',
            'clean_description': 'Haut Brion',
            'vintage': 1998,
            'size': '750mL',
            'unit_price': 695.00,
            'pack_size': 1,
            'quantity': 1,
        },
        {
            'sku_prefix': 'USR',
            'clean_description': 'MacDonald To-Kalon',
            'vintage': 2022,
            'size': '750mL',
            'unit_price': 2199.75,
            'pack_size': 3,
            'quantity': 3,
        }
    ]
    
    priced = apply_pricing(test_items)
    
    print("Pricing Test Results:")
    for item in priced:
        print(f"\n{item['clean_description']}")
        print(f"  SKU: {item['sku_prefix']}, Pack: {item['pack_size']}")
        print(f"  Unit Price: ${item['unit_price']}")
        print(f"  FOB Bottle: ${item['fob_bottle']}")
        print(f"  FOB Case: ${item['fob_case']}")
        print(f"  Frontline: ${item['frontline']}")
        print(f"  Ext Cost: ${item['ext_cost']}")
        print(f"  Ext Price: ${item['ext_price']}")
    
    summary = get_pricing_summary(priced)
    print(f"\nSummary: {summary}")
