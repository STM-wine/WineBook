import pandas as pd
import numpy as np
import re
from datetime import datetime, timedelta

def normalize_planning_sku(name: str) -> str:
    """
    Normalize wine name for matching by planning_sku.
    
    Rules:
    - lowercase
    - remove 4-digit vintage years (2021-2026)
    - keep pack size (12/750ml, 6/750ml, etc.)
    - keep NV
    - normalize whitespace
    - optionally remove commas/periods
    - preserve &, hyphens, apostrophes
    
    Example: "Pavette Sauvignon Blanc 2023 12/750ml" -> "pavette sauvignon blanc 12/750ml"
    """
    if pd.isna(name):
        return name
    
    name = str(name).lower()
    
    # Remove 4-digit vintage years (2021-2026)
    name = re.sub(r'\b20[2-9][0-9]\b', '', name)
    
    # Remove commas and periods (optional normalization)
    name = re.sub(r'[,.]', '', name)
    
    # Normalize whitespace
    name = ' '.join(name.split())
    
    return name.strip()


def calculate_reorder_recommendations(rb6_data, sales_data):
    """
    Calculate wine reorder recommendations using RB6 inventory and RADs sales data.
    
    ARCHITECTURE:
    1. Aggregate RADs sales by planning_sku (not product_code) because item codes change by vintage
    2. Keep one current RB6 row per planning_sku as the live row for UI
    3. Calculate velocity metrics for decision-making
    4. Add reorder_status for UI urgency indicator
    
    Args:
        rb6_data: DataFrame with RB6 inventory information
        sales_data: DataFrame with RADs sales history
        
    Returns:
        DataFrame with reorder recommendations (one row per planning_sku)
    """
    
    # --- STEP 1: NORMALIZE PLANNING_SKU FOR MATCHING ---
    # Create normalized planning_sku for consistent matching
    if 'Name' in rb6_data.columns:
        rb6_data['planning_sku_norm'] = rb6_data['Name'].apply(normalize_planning_sku)
    elif 'planning_sku' in rb6_data.columns:
        rb6_data['planning_sku_norm'] = rb6_data['planning_sku'].apply(normalize_planning_sku)
    else:
        raise ValueError("RB6 data must have 'Name' or 'planning_sku' column")
    
    if 'Wine Name' in sales_data.columns:
        sales_data['planning_sku_norm'] = sales_data['Wine Name'].apply(normalize_planning_sku)
    elif 'planning_sku' in sales_data.columns:
        sales_data['planning_sku_norm'] = sales_data['planning_sku'].apply(normalize_planning_sku)
    else:
        raise ValueError("Sales data must have 'Wine Name' or 'planning_sku' column")
    
    # --- STEP 2: SELECT LIVE RB6 ROW PER PLANNING_SKU ---
    # Strategy: Keep the first occurrence per planning_sku
    # This preserves the current live item code while showing historical demand
    rb6_live = rb6_data.drop_duplicates(subset=['planning_sku_norm'], keep='first').copy()
    
    # --- STEP 3: PARSE DATE COLUMN ---
    date_col = None
    if 'Date (mm/dd/yyyy)' in sales_data.columns:
        sales_data['date_parsed'] = pd.to_datetime(sales_data['Date (mm/dd/yyyy)'], errors='coerce')
        date_col = 'date_parsed'
    elif 'date' in sales_data.columns:
        sales_data['date_parsed'] = pd.to_datetime(sales_data['date'], errors='coerce')
        date_col = 'date_parsed'
    
    # --- STEP 4: AGGREGATE SALES BY PLANNING_SKU ---
    # Aggregate by planning_sku_norm because historical demand spans vintages
    
    today = datetime.now()
    
    # Calculate last 30 day sales by planning_sku
    if date_col and sales_data[date_col].notna().any():
        max_date = sales_data[date_col].max()
        thirty_days_ago = max_date - timedelta(days=30)
        recent_sales = sales_data[sales_data[date_col] >= thirty_days_ago].copy()
        
        sales_30d = recent_sales.groupby('planning_sku_norm').agg({
            'Quantity': 'sum'
        }).reset_index()
        sales_30d.columns = ['planning_sku_norm', 'last_30_day_sales']
    else:
        # No date data - aggregate all sales
        sales_30d = sales_data.groupby('planning_sku_norm').agg({
            'Quantity': 'sum'
        }).reset_index()
        sales_30d.columns = ['planning_sku_norm', 'last_30_day_sales']
    
    # Calculate next 60 days last year sales by planning_sku
    future_start = today
    future_end = today + timedelta(days=60)
    historical_start = future_start - timedelta(days=365)
    historical_end = future_end - timedelta(days=365)
    
    if date_col and sales_data[date_col].notna().any():
        ly_sales = sales_data[
            (sales_data[date_col] >= historical_start) & 
            (sales_data[date_col] <= historical_end)
        ].copy()
        
        sales_60d_ly = ly_sales.groupby('planning_sku_norm').agg({
            'Quantity': 'sum'
        }).reset_index()
        sales_60d_ly.columns = ['planning_sku_norm', 'next_60_days_ly_sales']
    else:
        sales_60d_ly = pd.DataFrame(columns=['planning_sku_norm', 'next_60_days_ly_sales'])
    
    # --- STEP 5: MERGE RB6 WITH AGGREGATED SALES ---
    # Merge by planning_sku_norm (the normalized matching key)
    merged = rb6_live.merge(sales_30d, on='planning_sku_norm', how='left')
    merged = merged.merge(sales_60d_ly, on='planning_sku_norm', how='left')
    
    # Fill missing sales with 0
    merged['last_30_day_sales'] = merged['last_30_day_sales'].fillna(0)
    merged['next_60_days_ly_sales'] = merged['next_60_days_ly_sales'].fillna(0)
    
    # --- STEP 6: CALCULATE INVENTORY FIELDS ---
    # Calculate true_available
    available_inventory = merged.get('Available Inventory', 0)
    unconfirmed_qty = merged.get('Unconfirmed Line Item Qty', 0)
    if not isinstance(available_inventory, pd.Series):
        available_inventory = merged['Available Inventory'] if 'Available Inventory' in merged.columns else 0
    if not isinstance(unconfirmed_qty, pd.Series):
        unconfirmed_qty = merged['Unconfirmed Line Item Qty'] if 'Unconfirmed Line Item Qty' in merged.columns else 0
    
    merged['true_available'] = np.maximum(0, available_inventory - unconfirmed_qty)
    
    # Get on_order
    on_order = merged.get('On Order', 0)
    if not isinstance(on_order, pd.Series):
        on_order = merged['On Order'] if 'On Order' in merged.columns else 0
    merged['on_order'] = on_order
    
    # Get Pack Size for rounding (default to 12)
    pack_size = merged.get('Pack Size', 12)
    if not isinstance(pack_size, pd.Series):
        pack_size = merged['Pack Size'] if 'Pack Size' in merged.columns else 12
    merged['pack_size'] = pack_size.fillna(12) if isinstance(pack_size, pd.Series) else 12
    
    # Get FOB
    fob = merged.get('FOB', 0)
    if not isinstance(fob, pd.Series):
        fob = merged['FOB'] if 'FOB' in merged.columns else 0
    merged['fob'] = fob
    
    # --- STEP 7: CALCULATE VELOCITY METRICS ---
    # weekly_velocity = last_30_day_sales / 4.3 (weeks in 30 days)
    merged['weekly_velocity'] = merged['last_30_day_sales'] / 4.3
    
    # weeks_on_hand = true_available / weekly_velocity
    # Handle divide-by-zero
    merged['weeks_on_hand'] = np.where(
        merged['weekly_velocity'] > 0,
        (merged['true_available'] / merged['weekly_velocity']).round(2),
        999  # No sales = high weeks on hand
    )
    
    # weeks_on_hand_with_on_order = (true_available + on_order) / weekly_velocity
    merged['weeks_on_hand_with_on_order'] = np.where(
        merged['weekly_velocity'] > 0,
        ((merged['true_available'] + merged['on_order']) / merged['weekly_velocity']).round(2),
        999
    )
    
    # Optional seasonal velocity reference
    merged['seasonal_velocity_reference'] = merged['next_60_days_ly_sales'] / 8.6  # 8.6 weeks in 60 days
    
    # --- STEP 7b: CALCULATE RECOMMENDED ORDER QUANTITIES ---
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
    
    # Calculate target_qty = weekly_velocity * (target_days / 7)
    merged['target_qty'] = merged['weekly_velocity'] * (merged['target_days'] / 7)
    
    # Calculate recommended_qty_raw = max(0, target_qty - (true_available + on_order))
    merged['recommended_qty_raw'] = np.maximum(
        0, 
        merged['target_qty'] - (merged['true_available'] + merged['on_order'])
    )
    
    # Round UP to nearest full case using Pack Size
    def round_up_to_case(qty, pack_size):
        if pd.isna(qty) or qty <= 0:
            return 0
        if pd.isna(pack_size) or pack_size <= 0:
            return int(np.ceil(qty))
        return int(np.ceil(qty / pack_size) * pack_size)
    
    merged['recommended_qty_rounded'] = merged.apply(
        lambda row: round_up_to_case(row['recommended_qty_raw'], row['pack_size']),
        axis=1
    )
    
    # Calculate order_cost = recommended_qty_rounded * FOB
    merged['order_cost'] = merged['recommended_qty_rounded'] * merged['fob']
    
    # --- STEP 8: ADD RB6 METADATA ---
    # Preserve these fields from the live RB6 row
    merged['Name'] = merged.get('Name', 'N/A')
    merged['product_code'] = merged.get('product_code', 'N/A')
    merged['brand_manager'] = merged.get('Wine: External ID (1)', 'N/A')
    merged['is_btg'] = merged.get('Is BTG', 'No')
    merged['is_core'] = merged.get('Is Core', 'No')
    
    # Use original planning_sku for display (not the normalized version)
    if 'planning_sku' not in merged.columns or merged['planning_sku'].isna().all():
        merged['planning_sku'] = merged['planning_sku_norm']
    
    # --- STEP 9: CALCULATE REORDER STATUS (UI ONLY) ---
    def get_reorder_status(row):
        """
        Decision logic for reorder urgency:
        - BTG + weeks_on_hand_with_on_order < 3 → "REORDER NOW"
        - Core + weeks_on_hand_with_on_order < 5 → "REORDER"
        - weeks_on_hand_with_on_order < 2 → "LOW"
        - Else → "OK"
        """
        weeks = row.get('weeks_on_hand_with_on_order', 999)
        is_btg = str(row.get('is_btg', 'No')).lower()
        is_core = str(row.get('is_core', 'No')).lower()
        
        if weeks == 999 or pd.isna(weeks):
            return "NO SALES"
        
        if 'yes' in is_btg or 'true' in is_btg or is_btg == '1':
            if weeks < 3:
                return "REORDER NOW"
        elif 'yes' in is_core or 'true' in is_core or is_core == '1':
            if weeks < 5:
                return "REORDER"
        
        if weeks < 2:
            return "LOW"
        
        return "OK"
    
    merged['reorder_status'] = merged.apply(get_reorder_status, axis=1)
    
    # --- STEP 10: SELECT FINAL COLUMNS ---
    final_columns = [
        'planning_sku',
        'Name',
        'product_code',
        'brand_manager',
        'is_btg',
        'is_core',
        'true_available',
        'on_order',
        'last_30_day_sales',
        'next_60_days_ly_sales',
        'weekly_velocity',
        'weeks_on_hand',
        'weeks_on_hand_with_on_order',
        'fob',
        'target_days',
        'recommended_qty_raw',
        'recommended_qty_rounded',
        'order_cost',
        'reorder_status'
    ]
    
    available_columns = [col for col in final_columns if col in merged.columns]
    result = merged[available_columns].copy()
    
    # --- STEP 11: SORT BY SALES ---
    # Sort by: last_30_day_sales descending (most selling first)
    result = result.sort_values('last_30_day_sales', ascending=False)
    
    return result


def validate_file_structure(df, file_type):
    """
    Validate RB6 and RADs file structure.
    """
    required_columns = {
        'rb6': ['Name', 'product_code'],  # Name for planning_sku, product_code for live item
        'sales': ['Wine Name', 'Quantity', 'Date (mm/dd/yyyy)']  # Historical matching fields
    }
    
    if file_type not in required_columns:
        return True
    
    missing_cols = set(required_columns[file_type]) - set(df.columns)
    if missing_cols:
        raise ValueError(f"Missing required columns in {file_type} file: {missing_cols}")
    
    return True
