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


def _choose_live_rb6_rows(rb6_data: pd.DataFrame) -> pd.DataFrame:
    """Pick the current inventory row for each non-vintage planning SKU."""
    rb6_inventory = rb6_data.copy()
    rb6_inventory["_source_order"] = range(len(rb6_inventory))

    def numeric_series(column: str) -> pd.Series:
        if column not in rb6_inventory.columns:
            return pd.Series([0] * len(rb6_inventory), index=rb6_inventory.index)
        return pd.to_numeric(rb6_inventory[column], errors="coerce").fillna(0)

    available = numeric_series("available_inventory")
    unconfirmed = numeric_series("unconfirmed_line_item_qty")
    on_order = numeric_series("on_order")
    prearrival = numeric_series("pre_arrival_total_quantity")
    rb6_inventory["_stock_position"] = np.maximum(0, available - unconfirmed) + on_order + prearrival

    velocity_columns = [
        "last_30_day_sales_qty_across_all_accounts",
        "last_60_day_sales_qty_across_all_accounts",
        "last_90_day_sales_qty_across_all_accounts",
    ]
    rb6_inventory["_rb6_velocity_signal"] = 0
    for column in velocity_columns:
        if column in rb6_inventory.columns:
            rb6_inventory["_rb6_velocity_signal"] += pd.to_numeric(
                rb6_inventory[column], errors="coerce"
            ).fillna(0)

    rb6_inventory["_vintage_sort"] = pd.to_numeric(
        rb6_inventory["vintage"] if "vintage" in rb6_inventory.columns else pd.Series([0] * len(rb6_inventory)),
        errors="coerce",
    ).fillna(0)

    rb6_inventory = rb6_inventory.sort_values(
        [
            "planning_sku_norm",
            "_stock_position",
            "_rb6_velocity_signal",
            "_vintage_sort",
            "_source_order",
        ],
        ascending=[True, False, False, False, True],
    )
    rb6_inventory = rb6_inventory.drop_duplicates(subset=["planning_sku_norm"], keep="first").copy()
    return rb6_inventory.drop(
        columns=["_source_order", "_stock_position", "_rb6_velocity_signal", "_vintage_sort"],
        errors="ignore",
    )


def _large_weeks_on_hand_sentinel(true_available, weekly_velocity) -> float | None:
    true_available = pd.to_numeric(true_available, errors="coerce")
    weekly_velocity = pd.to_numeric(weekly_velocity, errors="coerce")
    if pd.isna(weekly_velocity) or weekly_velocity <= 0:
        return 9999.0 if pd.notna(true_available) and true_available > 0 else 0.0
    return round(float(true_available) / float(weekly_velocity), 2)


def _inventory_risk(row) -> tuple[str, str]:
    """Operational inventory risk based on RB6 stock value and RADs movement."""
    inventory_value = pd.to_numeric(row.get("inventory_value", 0), errors="coerce")
    weekly_velocity = pd.to_numeric(row.get("weekly_velocity", 0), errors="coerce")
    weeks_on_hand = pd.to_numeric(row.get("weeks_on_hand", 0), errors="coerce")
    days_since_last_sale = pd.to_numeric(row.get("days_since_last_sale"), errors="coerce")
    last_90_day_sales = pd.to_numeric(row.get("last_90_day_sales", 0), errors="coerce")
    is_core_or_btg = bool(row.get("is_core_bool", False)) or bool(row.get("is_btg_bool", False))

    inventory_value = 0 if pd.isna(inventory_value) else float(inventory_value)
    weekly_velocity = 0 if pd.isna(weekly_velocity) else float(weekly_velocity)
    weeks_on_hand = 0 if pd.isna(weeks_on_hand) else float(weeks_on_hand)
    last_90_day_sales = 0 if pd.isna(last_90_day_sales) else float(last_90_day_sales)
    has_last_sale_gap = pd.notna(days_since_last_sale)
    days_value = float(days_since_last_sale) if has_last_sale_gap else None

    if last_90_day_sales <= 0 and inventory_value > 500:
        return "FREEZE", "No sales in the last 90 days with more than $500 of inventory on hand."

    if weeks_on_hand > 26:
        if is_core_or_btg:
            return "HIGH RISK", "Core/BTG item with high weeks on hand; review before freezing."
        return "FREEZE", "More than 26 weeks of inventory on hand."

    if has_last_sale_gap and days_value > 60:
        return "HIGH RISK", "No RADs sale in more than 60 days."
    if weeks_on_hand > 16:
        return "HIGH RISK", "More than 16 weeks of inventory on hand."
    if inventory_value > 5000 and weekly_velocity < 12:
        return "HIGH RISK", "More than $5,000 of inventory with less than one case per week of velocity."

    if has_last_sale_gap and days_value > 30:
        return "WATCH", "No RADs sale in more than 30 days."
    if weeks_on_hand > 8:
        return "WATCH", "More than 8 weeks of inventory on hand."

    return "LOW", "Inventory level is aligned with recent RADs movement."


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
    rb6_inventory = _choose_live_rb6_rows(rb6_data)
    
    # Rename planning_sku_norm to planning_sku for final output
    rb6_inventory['planning_sku'] = rb6_inventory['planning_sku_norm']
    
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
    
    qty_col = 'quantity' if 'quantity' in sales_data.columns else 'Quantity'

    if date_col and sales_data[date_col].notna().any():
        reference_date = sales_data[date_col].max()
    else:
        reference_date = datetime.now()

    def aggregate_sales_since(days):
        if date_col and sales_data[date_col].notna().any():
            start_date = reference_date - timedelta(days=days)
            period_sales = sales_data[sales_data[date_col] >= start_date].copy()
        else:
            period_sales = sales_data.copy()
        grouped = period_sales.groupby('planning_sku_norm').agg({qty_col: 'sum'}).reset_index()
        grouped.columns = ['planning_sku_norm', f'last_{days}_day_sales']
        return grouped

    def aggregate_sales_window(start_days_ago, end_days_ago, column_name):
        if not (date_col and sales_data[date_col].notna().any()):
            return pd.DataFrame(columns=['planning_sku_norm', column_name])

        start_date = reference_date - timedelta(days=start_days_ago)
        end_date = reference_date - timedelta(days=end_days_ago)
        period_sales = sales_data[
            (sales_data[date_col] >= start_date) &
            (sales_data[date_col] < end_date)
        ].copy()
        grouped = period_sales.groupby('planning_sku_norm').agg({qty_col: 'sum'}).reset_index()
        grouped.columns = ['planning_sku_norm', column_name]
        return grouped

    def aggregate_same_period_last_year(days):
        column_name = f'next_{days}_day_forecast'
        if not (date_col and sales_data[date_col].notna().any()):
            return pd.DataFrame(columns=['planning_sku_norm', column_name])

        future_start = reference_date
        future_end = reference_date + timedelta(days=days)
        historical_start = future_start - timedelta(days=365)
        historical_end = future_end - timedelta(days=365)
        period_sales = sales_data[
            (sales_data[date_col] >= historical_start) &
            (sales_data[date_col] <= historical_end)
        ].copy()
        grouped = period_sales.groupby('planning_sku_norm').agg({qty_col: 'sum'}).reset_index()
        grouped.columns = ['planning_sku_norm', column_name]
        return grouped

    # Calculate trailing sales by planning_sku
    if date_col and sales_data[date_col].notna().any():
        sales_30d = aggregate_sales_since(30)
    else:
        # No date data - aggregate all sales
        sales_30d = sales_data.groupby('planning_sku_norm').agg({
            qty_col: 'sum'
        }).reset_index()
        sales_30d.columns = ['planning_sku_norm', 'last_30_day_sales']

    sales_60d = aggregate_sales_since(60)
    sales_90d = aggregate_sales_since(90)
    prior_30d = aggregate_sales_window(60, 30, 'prior_30_day_sales')
    forecast_30d = aggregate_same_period_last_year(30)
    forecast_60d = aggregate_same_period_last_year(60)
    forecast_90d = aggregate_same_period_last_year(90)
    if date_col and sales_data[date_col].notna().any():
        last_sale_dates = (
            sales_data.dropna(subset=[date_col])
            .groupby('planning_sku_norm')[date_col]
            .max()
            .reset_index()
        )
        last_sale_dates.columns = ['planning_sku_norm', 'last_sale_date']
    else:
        last_sale_dates = pd.DataFrame(columns=['planning_sku_norm', 'last_sale_date'])
    
    # --- STEP 5: MERGE RB6 WITH AGGREGATED SALES ---
    # RB6 inventory is the base table - merge sales onto it (left join)
    # This preserves all RB6 inventory fields
    recommendations = rb6_inventory.merge(sales_30d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(sales_60d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(sales_90d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(prior_30d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(forecast_30d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(forecast_60d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(forecast_90d, on='planning_sku_norm', how='left')
    recommendations = recommendations.merge(last_sale_dates, on='planning_sku_norm', how='left')
    
    # Fill missing sales with 0
    recommendations['last_30_day_sales'] = recommendations['last_30_day_sales'].fillna(0)
    for col in [
        'last_60_day_sales',
        'last_90_day_sales',
        'prior_30_day_sales',
        'next_30_day_forecast',
        'next_60_day_forecast',
        'next_90_day_forecast',
    ]:
        recommendations[col] = recommendations[col].fillna(0)
    recommendations['next_60_days_ly_sales'] = recommendations['next_60_day_forecast']
    
    # --- STEP 6: CALCULATE INVENTORY FIELDS ---
    # True Available = Available Inventory - Unconfirmed Line Item Qty
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
            break
    
    if on_order is None:
        on_order = 0
    
    recommendations['on_order'] = on_order
    
    # Get Pack Size for rounding (default to 12)
    pack_size = recommendations.get('pack_size', recommendations.get('Pack Size', 12))
    if not isinstance(pack_size, pd.Series):
        pack_size = recommendations['Pack Size'] if 'Pack Size' in recommendations.columns else 12
    recommendations['pack_size'] = pack_size.fillna(12) if isinstance(pack_size, pd.Series) else 12
    
    # DEFENSIVE: Find FOB/cost column (may have various names)
    possible_fob_cols = [
        'fob',
        'FOB',
        'fob_x',
        'fob_y',
        'unit_cost',
        'bottle_cost',
        'cost',
        'price',
        'unit_price'
    ]
    
    fob_col = None
    for col in possible_fob_cols:
        if col in recommendations.columns:
            fob_col = col
            break
    
    if fob_col:
        recommendations['fob'] = pd.to_numeric(recommendations[fob_col], errors='coerce').fillna(0)
    else:
        recommendations['fob'] = 0
    recommendations['inventory_value'] = recommendations['true_available'] * recommendations['fob']
    if 'last_sale_date' in recommendations.columns:
        recommendations['last_sale_date'] = pd.to_datetime(recommendations['last_sale_date'], errors='coerce')
        recommendations['days_since_last_sale'] = (
            reference_date - recommendations['last_sale_date']
        ).dt.days
    else:
        recommendations['days_since_last_sale'] = None
    
    # --- STEP 7: CALCULATE VELOCITY METRICS ---
    # weekly_velocity = last_30_day_sales / 4.345 (weeks in 30 days)
    recommendations['weekly_velocity'] = recommendations['last_30_day_sales'] / 4.345
    
    # weeks_on_hand = true_available / weekly_velocity
    # If there is inventory but no velocity, use a large sentinel for risk scoring.
    recommendations['weeks_on_hand'] = recommendations.apply(
        lambda row: _large_weeks_on_hand_sentinel(row['true_available'], row['weekly_velocity']),
        axis=1,
    )
    
    # weeks_on_hand_with_on_order = (true_available + on_order) / weekly_velocity
    recommendations['weeks_on_hand_with_on_order'] = recommendations.apply(
        lambda row: _large_weeks_on_hand_sentinel(
            row['true_available'] + row['on_order'],
            row['weekly_velocity'],
        ),
        axis=1,
    )
    
    # Optional seasonal velocity reference
    recommendations['seasonal_velocity_reference'] = recommendations['next_60_day_forecast'] / 8.6  # 8.6 weeks in 60 days
    recommendations['avg_weekly_velocity_90d'] = recommendations['last_90_day_sales'] / 12.86
    prior_30 = pd.to_numeric(recommendations['prior_30_day_sales'], errors='coerce').fillna(0)
    last_30 = pd.to_numeric(recommendations['last_30_day_sales'], errors='coerce').fillna(0)
    recommendations['velocity_trend_pct'] = np.where(
        prior_30 > 0,
        ((last_30 - prior_30) / prior_30) * 100,
        None
    )
    recommendations['velocity_trend_label'] = np.where(
        prior_30 > 0,
        None,
        np.where(last_30 > 0, 'New', '')
    )
    
    # --- STEP 7b: CALCULATE RECOMMENDED ORDER QUANTITIES ---
    # Calculate target_days based on Is BTG and Is Core flags
    def row_has_truthy_flag(row, columns):
        for col in columns:
            val = str(row.get(col, 'No')).lower()
            if 'yes' in val or 'true' in val or val == '1':
                return True
        return False

    def get_target_days(row):
        if row_has_truthy_flag(row, ['Is BTG', 'is_btg', 'is_btg_', 'btg', 'btg_flag']):
            return 45
        elif row_has_truthy_flag(row, ['Is Core', 'is_core', 'is_core_', 'core', 'core_flag']):
            return 30
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
    recommendations['high_volume_rounding_required'] = recommendations['last_30_day_sales'] > 480
    
    # Calculate order_cost = recommended_qty_rounded * FOB
    recommendations['order_cost'] = recommendations['recommended_qty_rounded'] * recommendations['fob']
    recommendations['recommendation_status'] = 'rejected'
    recommendations['approved_qty'] = 0
    
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

    def flag_to_bool(value):
        val = str(value).lower()
        return 'yes' in val or 'true' in val or val == '1'

    recommendations['is_btg_bool'] = recommendations['is_btg'].apply(flag_to_bool)
    recommendations['is_core_bool'] = recommendations['is_core'].apply(flag_to_bool)
    risk_results = recommendations.apply(_inventory_risk, axis=1)
    recommendations['inventory_risk_label'] = risk_results.apply(lambda result: result[0])
    recommendations['inventory_risk_reason'] = risk_results.apply(lambda result: result[1])
    
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

    def get_risk_level(row):
        weekly_velocity = row.get('weekly_velocity', 0)
        target_days = row.get('target_days', 30)
        available_plus_order = row.get('true_available', 0) + row.get('on_order', 0)
        if weekly_velocity <= 0:
            return 'No Sales'
        target_qty = weekly_velocity * (target_days / 7)
        if target_qty <= 0:
            return 'Unknown'
        coverage_ratio = available_plus_order / target_qty
        if coverage_ratio < 0.5:
            return 'High'
        if coverage_ratio < 1:
            return 'Medium'
        return 'Low'

    recommendations['risk_level'] = recommendations.apply(get_risk_level, axis=1)
    
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
        'is_btg_bool',
        'is_core_bool',
        
        # Inventory
        'true_available',
        'on_order',
        'fob',
        'pack_size',
        'inventory_value',
        'days_since_last_sale',
        
        # Sales velocity (from RADs aggregation)
        'last_30_day_sales',
        'last_60_day_sales',
        'last_90_day_sales',
        'prior_30_day_sales',
        'next_30_day_forecast',
        'next_60_day_forecast',
        'next_90_day_forecast',
        'next_60_days_ly_sales',
        
        # Sales velocity (from RB6 if available)
        'last_30_day_sales_qty_across_all_accounts',
        'last_60_day_sales_qty_across_all_accounts', 
        'last_90_day_sales_qty_across_all_accounts',
        'average_qty_sold_interval',
        
        # Calculated metrics
        'weekly_velocity',
        'velocity_trend_pct',
        'velocity_trend_label',
        'weeks_on_hand',
        'weeks_on_hand_with_on_order',
        'inventory_risk_label',
        'inventory_risk_reason',
        
        # Recommendations
        'target_days',
        'target_qty',
        'recommended_qty_raw',
        'recommended_qty_rounded',
        'recommendation_status',
        'approved_qty',
        'high_volume_rounding_required',
        'order_cost',
        'reorder_status',
        'risk_level',
        
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
