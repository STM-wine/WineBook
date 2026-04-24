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
    if 'name' in rb6_data.columns:
        rb6_data['planning_sku_norm'] = rb6_data['name'].apply(normalize_planning_sku)
    elif 'Name' in rb6_data.columns:
        rb6_data['planning_sku_norm'] = rb6_data['Name'].apply(normalize_planning_sku)
    elif 'planning_sku' in rb6_data.columns:
        rb6_data['planning_sku_norm'] = rb6_data['planning_sku'].apply(normalize_planning_sku)
    else:
        raise ValueError("RB6 data must have 'name', 'Name', or 'planning_sku' column")
    
    # Handle both standardized and original RADs column names
    if 'wine_name' in sales_data.columns:
        sales_data['planning_sku_norm'] = sales_data['wine_name'].apply(normalize_planning_sku)
    elif 'Wine Name' in sales_data.columns:
        sales_data['planning_sku_norm'] = sales_data['Wine Name'].apply(normalize_planning_sku)
    elif 'planning_sku' in sales_data.columns:
        sales_data['planning_sku_norm'] = sales_data['planning_sku'].apply(normalize_planning_sku)
    else:
        raise ValueError("Sales data must have 'wine_name', 'Wine Name', or 'planning_sku' column")
    
    # --- STEP 2: CREATE CLEAN RB6 SKU INVENTORY FRAME ---
    # Ensure planning_sku is unique before any merge - RB6 is the source of truth for inventory
    rb6_inventory = rb6_data.copy()
    
    # Use planning_sku_norm as the unique key (already normalized)
    # Keep first occurrence to get live item code
    rb6_inventory = rb6_inventory.drop_duplicates(subset=['planning_sku_norm'], keep='first').copy()
    
    # Rename planning_sku_norm to planning_sku for final output
    rb6_inventory['planning_sku'] = rb6_inventory['planning_sku_norm']
    
    print(f"DEBUG: RB6 inventory frame created with {len(rb6_inventory)} unique SKUs")
    print(f"DEBUG: RB6 available_inventory populated: {rb6_inventory['available_inventory'].notna().sum()}/{len(rb6_inventory)}")
    
    # --- STEP 3: PARSE DATE COLUMN ---
    # Handle both standardized and original RADs date column names
    date_col = None
    date_source_col = None
    
    if 'date' in sales_data.columns:
        date_source_col = 'date'
    elif 'Date (mm/dd/yyyy)' in sales_data.columns:
        date_source_col = 'Date (mm/dd/yyyy)'
    elif 'invoice_date' in sales_data.columns:
        date_source_col = 'invoice_date'
    
    if date_source_col:
        sales_data['date_parsed'] = pd.to_datetime(sales_data[date_source_col], errors='coerce')
        date_col = 'date_parsed'
    
    # --- STEP 4: AGGREGATE SALES BY PLANNING_SKU ---
    # Aggregate by planning_sku_norm because historical demand spans vintages
    
    today = datetime.now()
    
    # Calculate last 30 day sales by planning_sku
    if date_col and sales_data[date_col].notna().any():
        max_date = sales_data[date_col].max()
        thirty_days_ago = max_date - timedelta(days=30)
        recent_sales = sales_data[sales_data[date_col] >= thirty_days_ago].copy()
        
        # Use standardized 'quantity' column, fallback to 'Quantity'
        qty_col = 'quantity' if 'quantity' in recent_sales.columns else 'Quantity'
        sales_30d = recent_sales.groupby('planning_sku_norm').agg({
            qty_col: 'sum'
        }).reset_index()
        sales_30d.columns = ['planning_sku_norm', 'last_30_day_sales']
    else:
        # No date data - aggregate all sales
        # Use standardized 'quantity' column, fallback to 'Quantity'
        qty_col = 'quantity' if 'quantity' in sales_data.columns else 'Quantity'
        sales_30d = sales_data.groupby('planning_sku_norm').agg({
            qty_col: 'sum'
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
        
        # Use standardized 'quantity' column, fallback to 'Quantity'
        qty_col = 'quantity' if 'quantity' in ly_sales.columns else 'Quantity'
        sales_60d_ly = ly_sales.groupby('planning_sku_norm').agg({
            qty_col: 'sum'
        }).reset_index()
        sales_60d_ly.columns = ['planning_sku_norm', 'next_60_days_ly_sales']
    else:
        sales_60d_ly = pd.DataFrame(columns=['planning_sku_norm', 'next_60_days_ly_sales'])
    
    # --- STEP 5: MERGE RB6 WITH AGGREGATED SALES ---
    # RB6 inventory is the base table - merge sales onto it (left join)
    # This preserves all RB6 inventory fields
    recommendations = rb6_inventory.merge(sales_30d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(sales_60d_ly, on='planning_sku_norm', how='left')
    
    # Fill missing sales with 0
    recommendations['last_30_day_sales'] = recommendations['last_30_day_sales'].fillna(0)
    recommendations['next_60_days_ly_sales'] = recommendations['next_60_days_ly_sales'].fillna(0)
    
    # --- STEP 6: CALCULATE INVENTORY FIELDS ---
    # available_inventory comes directly from RB6 - should be preserved after merge
    recommendations['true_available'] = pd.to_numeric(
        recommendations['available_inventory'], errors='coerce'
    ).fillna(0)
    
    # Handle unconfirmed_qty if present
    if 'unconfirmed_line_item_qty' in recommendations.columns:
        recommendations['true_available'] = np.maximum(
            0, 
            recommendations['true_available'] - pd.to_numeric(
                recommendations['unconfirmed_line_item_qty'], errors='coerce'
            ).fillna(0)
        )
    
    # Validation: Check inventory pipeline
    print("RB6 available_inventory populated:", rb6_inventory["available_inventory"].notna().sum(), "/", len(rb6_inventory))
    print("Final true_available populated:", recommendations["true_available"].notna().sum(), "/", len(recommendations))
    print(recommendations[["planning_sku", "name", "available_inventory", "true_available"]].head(20))
    
    # DEFENSIVE: Find on_order column (may have _x or _y suffix after merge)
    possible_on_order_cols = [
        'on_order',
        'on_order_x',
        'on_order_y',
        'On Order',
        'On_Order',
        'estimated_of_intervals_supply_remaining_with_on_order_considered'
    ]
    
    on_order = None
    for col in possible_on_order_cols:
        if col in recommendations.columns:
            on_order = recommendations[col]
            print(f"DEBUG: Found on_order in column: {col}")
            break
    
    if on_order is None:
        print(f"DEBUG: WARNING - No on_order column found, defaulting to 0")
        on_order = 0
    
    recommendations['on_order'] = on_order
    
    # Get Pack Size for rounding (default to 12)
    pack_size = recommendations.get('pack_size', recommendations.get('Pack Size', 12))
    if not isinstance(pack_size, pd.Series):
        pack_size = recommendations['Pack Size'] if 'Pack Size' in recommendations.columns else 12
    recommendations['pack_size'] = pack_size.fillna(12) if isinstance(pack_size, pd.Series) else 12
    
    # Get FOB
    fob = recommendations.get('FOB', 0)
    if not isinstance(fob, pd.Series):
        fob = recommendations['FOB'] if 'FOB' in recommendations.columns else 0
    recommendations['fob'] = fob
    
    # --- STEP 7: CALCULATE VELOCITY METRICS ---
    # weekly_velocity = last_30_day_sales / 4.345 (weeks in 30 days)
    recommendations['weekly_velocity'] = recommendations['last_30_day_sales'] / 4.345
    
    # weeks_on_hand = true_available / weekly_velocity
    # If no sales (velocity = 0), return blank/None instead of 0 or 999
    recommendations['weeks_on_hand'] = np.where(
        recommendations['weekly_velocity'] > 0,
        (recommendations['true_available'] / recommendations['weekly_velocity']).round(2),
        None  # No recent sales
    )
    
    # weeks_on_hand_with_on_order = (true_available + on_order) / weekly_velocity
    recommendations['weeks_on_hand_with_on_order'] = np.where(
        recommendations['weekly_velocity'] > 0,
        ((recommendations['true_available'] + recommendations['on_order']) / recommendations['weekly_velocity']).round(2),
        None  # No recent sales
    )
    
    # Optional seasonal velocity reference
    recommendations['seasonal_velocity_reference'] = recommendations['next_60_days_ly_sales'] / 8.6  # 8.6 weeks in 60 days
    
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
    
    recommendations['target_days'] = recommendations.apply(get_target_days, axis=1)
    
    # Calculate target_qty = weekly_velocity * (target_days / 7)
    recommendations['target_qty'] = recommendations['weekly_velocity'] * (recommendations['target_days'] / 7)
    
    # Calculate recommended_qty_raw = max(0, target_qty - (true_available + on_order))
    recommendations['recommended_qty_raw'] = np.maximum(
        0, 
        recommendations['target_qty'] - (recommendations['true_available'] + recommendations['on_order'])
    )
    
    # Round UP to nearest full case using Pack Size
    def round_up_to_case(qty, pack_size):
        if pd.isna(qty) or qty <= 0:
            return 0
        if pd.isna(pack_size) or pack_size <= 0:
            return int(np.ceil(qty))
        return int(np.ceil(qty / pack_size) * pack_size)
    
    recommendations['recommended_qty_rounded'] = recommendations.apply(
        lambda row: round_up_to_case(row['recommended_qty_raw'], row['pack_size']),
        axis=1
    )
    
    # Calculate order_cost = recommended_qty_rounded * FOB
    recommendations['order_cost'] = recommendations['recommended_qty_rounded'] * recommendations['fob']
    
    # --- STEP 8: ADD RB6 METADATA ---
    # Preserve key fields from the live RB6 row using normalized column names
    # Core identity fields
    recommendations['Name'] = recommendations.get('name', recommendations.get('Name', 'N/A'))
    recommendations['product_code'] = recommendations.get('code', recommendations.get('product_code', recommendations.get('sku', 'N/A')))
    recommendations['vintage'] = recommendations.get('vintage', 'N/A')
    
    # Category fields
    recommendations['wine_category'] = recommendations.get('wine_category', recommendations.get('category', 'N/A'))
    recommendations['product_type'] = recommendations.get('product_type', 'N/A')
    
    # Operational flags - use normalized column names
    # Try various possible normalized names
    is_btg_val = None
    for col in ['is_btg', 'is_btg_', 'btg', 'btg_flag']:
        if col in recommendations.columns:
            is_btg_val = recommendations[col]
            break
    recommendations['is_btg'] = is_btg_val if is_btg_val is not None else 'No'
    
    is_core_val = None
    for col in ['is_core', 'is_core_', 'core', 'core_flag']:
        if col in recommendations.columns:
            is_core_val = recommendations[col]
            break
    recommendations['is_core'] = is_core_val if is_core_val is not None else 'No'
    
    # Brand manager - try various possible column names
    brand_manager_val = None
    for col in ['brand_manager', 'wine_external_id_1', 'external_id', 'supplier', 'distributor']:
        if col in recommendations.columns:
            brand_manager_val = recommendations[col]
            break
    recommendations['brand_manager'] = brand_manager_val if brand_manager_val is not None else 'N/A'
    
    # Preserve sales velocity fields from RB6 if they exist
    for field in ['last_30_day_sales_qty_across_all_accounts', 
                  'last_60_day_sales_qty_across_all_accounts',
                  'last_90_day_sales_qty_across_all_accounts',
                  'average_qty_sold_interval']:
        if field in recommendations.columns:
            try:
                pass  # Already preserved in merge, just validate it exists
            except:
                pass
    
    # Use original planning_sku for display (not the normalized version)
    if 'planning_sku' not in recommendations.columns or recommendations['planning_sku'].isna().all():
        recommendations['planning_sku'] = recommendations['planning_sku_norm']
    
    # --- STEP 9: CALCULATE REORDER STATUS (UI ONLY) ---
    def get_reorder_status(row):
        true_available = row.get('true_available', 0)
        weekly_velocity = row.get('weekly_velocity', 0)
        on_order = row.get('on_order', 0)
        target_days = row.get('target_days', 30)
        
        # Calculate weeks remaining
        if weekly_velocity > 0:
            weeks_on_hand = (true_available + on_order) / weekly_velocity
        else:
            weeks_on_hand = float('inf') if true_available > 0 else 0
        
        weeks_needed = target_days / 7
        
        # No sales = NO SALES status
        if weekly_velocity == 0:
            return "NO SALES"
        
        # Critical: Less than 4 weeks on hand
        if weeks_on_hand < 4:
            return "URGENT"
        
        # Low: Less than weeks needed
        if weeks_on_hand < weeks_needed:
            return "LOW"
        
        return "OK"
    
    recommendations['reorder_status'] = recommendations.apply(get_reorder_status, axis=1)
    
    # --- STEP 10: SELECT FINAL COLUMNS ---
    # Comprehensive list of all fields to preserve
    final_columns = [
        # Core identity
        'planning_sku',
        'Name',
        'product_code',
        'vintage',
        
        # Category info
        'wine_category',
        'product_type',
        
        # Operational flags
        'brand_manager',
        'is_btg',
        'is_core',
        
        # Inventory
        'true_available',
        'on_order',
        'fob',
        'pack_size',
        
        # Sales velocity (from RADs aggregation)
        'last_30_day_sales',
        'next_60_days_ly_sales',
        
        # Sales velocity (from RB6 if available)
        'last_30_day_sales_qty_across_all_accounts',
        'last_60_day_sales_qty_across_all_accounts', 
        'last_90_day_sales_qty_across_all_accounts',
        'average_qty_sold_interval',
        
        # Calculated metrics
        'weekly_velocity',
        'weeks_on_hand',
        'weeks_on_hand_with_on_order',
        
        # Recommendations
        'target_days',
        'target_qty',
        'recommended_qty_raw',
        'recommended_qty_rounded',
        'order_cost',
        'reorder_status',
        
        # Importer logistics (if available)
        'importer',
        'importer_id',
        'eta_days',
        'eta_weeks',
        'projected_arrival_date',
        'pickup_location',
        'pick_up_location',
        'freight_forwarder',
        'order_frequency',
        'order_timing_risk',
        'notes'
    ]
    
    available_columns = [col for col in final_columns if col in recommendations.columns]
    result = recommendations[available_columns].copy()
    
    # --- STEP 11: SORT BY SALES ---
    # Sort by: last_30_day_sales descending (most selling first)
    result = result.sort_values('last_30_day_sales', ascending=False)
    
    return result


def validate_file_structure(df, file_type):
    """
    Validate RB6 and RADs file structure.
    Handles both original and normalized column names.
    """
    required_columns = {
        'rb6': [
            ['name', 'Name'],  # Name for planning_sku (either normalized or original)
            ['product_code']   # product_code for live item
        ],
        'sales': [
            ['wine_name', 'Wine Name'],           # Wine Name for matching (standardized or original)
            ['quantity', 'Quantity'],            # Sales quantity (standardized or original)
            ['date', 'Date (mm/dd/yyyy)', 'invoice_date']    # Date field (standardized or original)
        ]
    }
    
    if file_type not in required_columns:
        return True
    
    # Check each required column group (at least one from each group must exist)
    missing_groups = []
    for col_group in required_columns[file_type]:
        # Check if any column in this group exists
        if not any(col in df.columns for col in col_group):
            missing_groups.append(col_group[0])  # Report the first option as the expected name
    
    if missing_groups:
        available_cols = list(df.columns)[:20]  # Show first 20 columns
        raise ValueError(f"Missing required columns in {file_type} file. Expected one of: {missing_groups}. Available: {available_cols}")
    
    return True
