import pandas as pd
import numpy as np
from datetime import datetime, timedelta

def calculate_reorder_recommendations(rb6_data, sales_data):
    """
    MVP Phase 1: Calculate wine reorder recommendations using RB6 inventory and RADs sales data.
    
    CRITICAL: Prevents duplicate rows by:
    1. Aggregating RADs sales data to one row per product_code BEFORE merging
    2. Deduplicating RB6 to one row per product_code
    3. Merging on product_code only (no fallback to prevent duplication)
    4. Validating uniqueness after merge
    
    Args:
        rb6_data: DataFrame with RB6 inventory information
        sales_data: DataFrame with RADs sales history
        
    Returns:
        DataFrame with reorder recommendations (one row per SKU)
    """
    
    # --- STEP 1: PREPARE AND DEDUPLICATE RB6 ---
    # Ensure we have product_code for merging
    if 'product_code' not in rb6_data.columns:
        raise ValueError("RB6 data must have 'product_code' column")
    
    # Deduplicate RB6 - keep only first occurrence per product_code
    # This prevents duplicate inventory rows from creating duplicate output rows
    rb6_unique = rb6_data.drop_duplicates(subset=['product_code'], keep='first').copy()
    
    if len(rb6_unique) < len(rb6_data):
        print(f"⚠️  Dropped {len(rb6_data) - len(rb6_unique)} duplicate RB6 rows")
    
    # --- STEP 2: AGGREGATE RADs SALES DATA ---
    # RADs has multiple rows per SKU (one per transaction). 
    # We must aggregate to one row per product_code BEFORE merging.
    
    if 'product_code' not in sales_data.columns:
        raise ValueError("Sales data must have 'product_code' column")
    
    # Parse date column
    date_col = None
    if 'Date (mm/dd/yyyy)' in sales_data.columns:
        sales_data['date_parsed'] = pd.to_datetime(sales_data['Date (mm/dd/yyyy)'], errors='coerce')
        date_col = 'date_parsed'
    elif 'date' in sales_data.columns:
        sales_data['date_parsed'] = pd.to_datetime(sales_data['date'], errors='coerce')
        date_col = 'date_parsed'
    
    # Calculate last 30 day sales per product
    if date_col and sales_data[date_col].notna().any():
        max_date = sales_data[date_col].max()
        thirty_days_ago = max_date - timedelta(days=30)
        
        # Filter to last 30 days only
        recent_sales = sales_data[sales_data[date_col] >= thirty_days_ago].copy()
        
        # Aggregate by product_code: sum Quantity
        sales_agg = recent_sales.groupby('product_code').agg({
            'Quantity': 'sum',
            'Pack Size': 'first'  # Use first pack size (should be consistent per SKU)
        }).reset_index()
        
        sales_agg.columns = ['product_code', 'last_30_day_sales', 'Pack Size']
    else:
        # No date column - aggregate all sales
        sales_agg = sales_data.groupby('product_code').agg({
            'Quantity': 'sum',
            'Pack Size': 'first'
        }).reset_index()
        
        sales_agg.columns = ['product_code', 'last_30_day_sales', 'Pack Size']
    
    # --- STEP 3: MERGE RB6 WITH AGGREGATED SALES ---
    # Use left join so all RB6 SKUs appear, even if no sales
    merged = rb6_unique.merge(sales_agg, on='product_code', how='left')
    
    # Fill missing sales with 0
    merged['last_30_day_sales'] = merged['last_30_day_sales'].fillna(0)
    if 'Pack Size' in merged.columns:
        merged['Pack Size'] = merged['Pack Size'].fillna(12)  # Default to 12 if missing
    else:
        merged['Pack Size'] = 12
    
    # --- STEP 4: VALIDATE UNIQUENESS ---
    # After merge, each product_code should appear exactly once
    duplicate_check = merged.groupby('product_code').size()
    duplicates = duplicate_check[duplicate_check > 1]
    
    if len(duplicates) > 0:
        duplicate_codes = duplicates.index.tolist()
        raise ValueError(
            f"Duplicate rows detected after merge for product codes: {duplicate_codes[:10]}... "
            f"Total duplicates: {len(duplicates)}"
        )
    
    # --- STEP 5: CALCULATE FIELDS ---
    
    # Calculate true_available = max(0, Available Inventory - Unconfirmed Line Item Qty)
    available_inventory = merged.get('Available Inventory', 0)
    unconfirmed_qty = merged.get('Unconfirmed Line Item Qty', 0)
    if isinstance(available_inventory, pd.Series):
        pass
    else:
        available_inventory = merged['Available Inventory'] if 'Available Inventory' in merged.columns else 0
    if isinstance(unconfirmed_qty, pd.Series):
        pass
    else:
        unconfirmed_qty = merged['Unconfirmed Line Item Qty'] if 'Unconfirmed Line Item Qty' in merged.columns else 0
    
    merged['true_available'] = np.maximum(0, available_inventory - unconfirmed_qty)
    
    # Get on_order value early (needed for weeks_on_hand calculation)
    on_order = merged.get('On Order', 0)
    if not isinstance(on_order, pd.Series):
        on_order = merged['On Order'] if 'On Order' in merged.columns else 0
    merged['on_order'] = on_order
    
    # Calculate target_days based on Is BTG and Is Core flags
    def get_target_days(row):
        btg_val = str(row.get('Is BTG', 'No')).lower()
        core_val = str(row.get('Is Core', 'No')).lower()
        
        if 'yes' in btg_val or 'true' in btg_val or btg_val == '1':
            return 60
        elif 'yes' in core_val or 'true' in core_val or core_val == '1':
            return 45
        else:
            return 30
    
    merged['target_days'] = merged.apply(get_target_days, axis=1)
    
    # Calculate daily_run_rate = last_30_day_sales / 30
    merged['daily_run_rate'] = merged['last_30_day_sales'] / 30
    
    # Calculate weeks_on_hand metrics
    # weekly_run_rate = daily_run_rate * 7
    # weeks_on_hand = true_available / weekly_run_rate
    # Handle divide-by-zero: if no sales, set to None
    weekly_run_rate = merged['daily_run_rate'] * 7
    merged['weeks_on_hand'] = np.where(
        weekly_run_rate > 0,
        (merged['true_available'] / weekly_run_rate).round(1),
        None
    )
    
    # weeks_on_hand_with_on_order = (true_available + on_order) / weekly_run_rate
    merged['weeks_on_hand_with_on_order'] = np.where(
        weekly_run_rate > 0,
        ((merged['true_available'] + merged['on_order']) / weekly_run_rate).round(1),
        None
    )
    
    # Calculate target_qty = daily_run_rate * target_days
    merged['target_qty'] = merged['daily_run_rate'] * merged['target_days']
    
    # Calculate recommended_qty_raw = max(0, target_qty - (true_available + On Order))
    # on_order was already set earlier in the pipeline
    merged['recommended_qty_raw'] = np.maximum(0, merged['target_qty'] - (merged['true_available'] + merged['on_order']))
    
    # Round UP to nearest full case using Pack Size
    def round_up_to_case(qty, pack_size):
        if pd.isna(qty) or qty <= 0:
            return 0
        if pd.isna(pack_size) or pack_size <= 0:
            return int(np.ceil(qty))
        return int(np.ceil(qty / pack_size) * pack_size)
    
    merged['recommended_qty_rounded'] = merged.apply(
        lambda row: round_up_to_case(row['recommended_qty_raw'], row['Pack Size']),
        axis=1
    )
    
    # Get FOB and calculate order_cost
    fob = merged.get('FOB', 0)
    if not isinstance(fob, pd.Series):
        fob = merged['FOB'] if 'FOB' in merged.columns else 0
    merged['fob'] = fob
    
    merged['order_cost'] = merged['recommended_qty_rounded'] * merged['fob']
    
    # Calculate expected_days_on_hand_after_order
    total_with_order = merged['true_available'] + merged['on_order'] + merged['recommended_qty_rounded']
    merged['expected_days_on_hand_after_order'] = np.where(
        merged['daily_run_rate'] > 0,
        (total_with_order / merged['daily_run_rate']).round(1),
        999  # If no sales, set high number
    )
    
    # Add brand_manager and flags
    merged['brand_manager'] = merged.get('Wine: External ID (1)', 'N/A')
    merged['is_btg'] = merged.get('Is BTG', 'No')
    merged['is_core'] = merged.get('Is Core', 'No')
    
    # Ensure planning_sku is present
    if 'planning_sku' not in merged.columns:
        merged['planning_sku'] = merged['product_code']
    
    # --- STEP 6: SELECT AND ORDER FINAL COLUMNS ---
    final_columns = [
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
    
    # Only include columns that exist
    available_columns = [col for col in final_columns if col in merged.columns]
    result = merged[available_columns].copy()
    
    # Sort by recommended_qty_rounded descending
    result = result.sort_values('recommended_qty_rounded', ascending=False)
    
    return result

def validate_file_structure(df, file_type):
    """
    MVP Phase 1: Validate RB6 and RADs file structure.
    """
    required_columns = {
        'rb6': ['planning_sku', 'product_code'],  # Both merge keys required
        'sales': ['planning_sku', 'product_code']  # Both merge keys required
    }
    
    # For Phase 1, we only validate 'rb6' and 'sales'
    if file_type not in required_columns:
        return True  # Skip validation for unknown types
    
    missing_cols = set(required_columns[file_type]) - set(df.columns)
    if missing_cols:
        raise ValueError(f"Missing required columns in {file_type} file: {missing_cols}")
    
    return True
