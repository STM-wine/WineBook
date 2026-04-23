import pandas as pd

def calculate_reorder_recommendations(rb6_data, sales_data, needs_data):
    """
    Calculate wine reorder recommendations based on inventory, sales, and needs data.
    
    Args:
        rb6_data: DataFrame with inventory information
        sales_data: DataFrame with sales history  
        needs_data: DataFrame with target days and cost information
        
    Returns:
        DataFrame with reorder recommendations
    """
    
    # Merge all data on planning_sku
    merged = rb6_data.merge(needs_data, on='planning_sku', how='left')
    
    # Calculate average daily sales from sales history
    if 'date' in sales_data.columns:
        sales_data['date'] = pd.to_datetime(sales_data['date'])
        sales_summary = sales_data.groupby('planning_sku').agg({
            'quantity_sold': 'sum',
            'date': ['min', 'max']
        }).reset_index()
        
        # Flatten column names
        sales_summary.columns = ['planning_sku', 'total_sold', 'min_date', 'max_date']
        
        # Calculate days covered and daily average
        sales_summary['days_covered'] = (sales_summary['max_date'] - sales_summary['min_date']).dt.days + 1
        sales_summary['avg_daily_sales'] = sales_summary['total_sold'] / sales_summary['days_covered']
        
        # Merge daily sales into main data
        merged = merged.merge(sales_summary[['planning_sku', 'avg_daily_sales']], on='planning_sku', how='left')
        merged['avg_daily_sales'] = merged['avg_daily_sales'].fillna(0)
    else:
        # If no date column, use simple average
        sales_summary = sales_data.groupby('planning_sku')['quantity_sold'].mean().reset_index()
        sales_summary.columns = ['planning_sku', 'avg_daily_sales']
        merged = merged.merge(sales_summary, on='planning_sku', how='left')
        merged['avg_daily_sales'] = merged['avg_daily_sales'].fillna(0)
    
    # Calculate reorder recommendations
    merged['target_inventory'] = merged['avg_daily_sales'] * merged['target_days']
    merged['current_coverage'] = merged['true_available'] / merged['avg_daily_sales'].replace(0, 1)
    
    # Calculate recommended order quantity
    merged['recommended_order_qty'] = (
        (merged['target_inventory'] - merged['true_available'] - merged['on_order'])
        .clip(lower=0)
        .round()
        .astype(int)
    )
    
    # Calculate order cost
    merged['order_cost'] = merged['recommended_order_qty'] * merged['unit_cost']
    
    # Calculate expected days on hand after order
    total_inventory_after_order = merged['true_available'] + merged['on_order'] + merged['recommended_order_qty']
    merged['expected_days_on_hand_after_order'] = (
        total_inventory_after_order / merged['avg_daily_sales'].replace(0, 1)
    ).round(1)
    
    # Select and order final columns
    final_columns = [
        'planning_sku',
        'recommended_order_qty',
        'order_cost', 
        'responsible_brand_manager',
        'true_available',
        'on_order',
        'target_days',
        'expected_days_on_hand_after_order',
        'avg_daily_sales',
        'target_inventory',
        'current_coverage'
    ]
    
    result = merged[final_columns].copy()
    
    # Sort by recommended order quantity descending
    result = result.sort_values('recommended_order_qty', ascending=False)
    
    return result

def validate_file_structure(df, file_type):
    """
    Validate that required columns exist in the uploaded files.
    """
    required_columns = {
        'rb6': ['planning_sku', 'true_available', 'on_order'],
        'sales': ['planning_sku', 'quantity_sold'],
        'needs': ['planning_sku', 'target_days', 'responsible_brand_manager', 'unit_cost']
    }
    
    missing_cols = set(required_columns[file_type]) - set(df.columns)
    if missing_cols:
        raise ValueError(f"Missing required columns in {file_type} file: {missing_cols}")
    
    return True
