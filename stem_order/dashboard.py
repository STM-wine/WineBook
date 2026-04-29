"""Dashboard data shaping for ordering decisions."""

from dataclasses import dataclass

import pandas as pd


DASHBOARD_COLUMNS = [
    "supplier_name",
    "product_name",
    "is_btg",
    "is_core",
    "true_available",
    "on_order",
    "last_30_day_sales",
    "next_30_day_forecast",
    "weekly_velocity",
    "velocity_trend_pct",
    "risk_level",
    "recommended_qty_rounded",
    "recommendation_status",
    "order_cost",
    "landed_cost",
    "product_code",
    "planning_sku",
]


PO_COLUMNS = [
    "supplier_name",
    "product_name",
    "product_code",
    "planning_sku",
    "recommended_qty_rounded",
    "order_cost",
]


@dataclass
class DashboardMetrics:
    rows: int
    urgent_skus: int
    low_skus: int
    recommended_bottles: int
    estimated_order_cost: float
    suppliers_with_orders: int


def recommendations_to_dataframe(recommendations: list[dict]) -> pd.DataFrame:
    df = pd.DataFrame(recommendations)
    if df.empty:
        return pd.DataFrame(columns=DASHBOARD_COLUMNS)

    for col in [
        "recommended_qty_rounded",
        "approved_qty",
        "true_available",
        "on_order",
        "last_30_day_sales",
        "last_60_day_sales",
        "last_90_day_sales",
        "next_30_day_forecast",
        "next_60_day_forecast",
        "next_90_day_forecast",
        "weekly_velocity",
        "velocity_trend_pct",
        "weeks_on_hand_with_on_order",
        "order_cost",
        "landed_cost",
        "trucking_cost_per_bottle",
    ]:
        if col in df.columns:
            df[col] = pd.to_numeric(df[col], errors="coerce").fillna(0)

    for col in [
        "supplier_name",
        "product_name",
        "product_code",
        "planning_sku",
        "reorder_status",
        "recommendation_status",
        "risk_level",
        "pickup_location",
    ]:
        if col in df.columns:
            df[col] = df[col].fillna("")

    for col in ["is_btg", "is_core"]:
        if col not in df.columns:
            df[col] = False
        df[col] = df[col].fillna(False).astype(bool)

    return df


def dashboard_metrics(df: pd.DataFrame) -> DashboardMetrics:
    if df.empty:
        return DashboardMetrics(0, 0, 0, 0, 0.0, 0)

    order_df = df[df.get("recommended_qty_rounded", 0) > 0]
    return DashboardMetrics(
        rows=len(df),
        urgent_skus=int((df["reorder_status"] == "URGENT").sum()) if "reorder_status" in df else 0,
        low_skus=int((df["reorder_status"] == "LOW").sum()) if "reorder_status" in df else 0,
        recommended_bottles=int(df["recommended_qty_rounded"].sum())
        if "recommended_qty_rounded" in df
        else 0,
        estimated_order_cost=float(df["order_cost"].sum()) if "order_cost" in df else 0.0,
        suppliers_with_orders=order_df["supplier_name"].nunique()
        if "supplier_name" in order_df
        else 0,
    )


def filter_recommendations(
    df: pd.DataFrame,
    supplier: str = "All",
    statuses: list[str] | None = None,
    search: str = "",
    only_order_qty: bool = True,
) -> pd.DataFrame:
    filtered = df.copy()

    if supplier != "All" and "supplier_name" in filtered:
        filtered = filtered[filtered["supplier_name"] == supplier]

    if statuses and "reorder_status" in filtered:
        filtered = filtered[filtered["reorder_status"].isin(statuses)]

    if only_order_qty and "recommended_qty_rounded" in filtered:
        filtered = filtered[filtered["recommended_qty_rounded"] > 0]

    if search:
        needle = search.strip().lower()
        if needle:
            haystack = (
                filtered.get("product_name", "").astype(str)
                + " "
                + filtered.get("product_code", "").astype(str)
                + " "
                + filtered.get("planning_sku", "").astype(str)
            ).str.lower()
            filtered = filtered[haystack.str.contains(needle, na=False)]

    sort_cols = [col for col in ["reorder_status", "last_30_day_sales"] if col in filtered.columns]
    if "last_30_day_sales" in sort_cols:
        filtered = filtered.sort_values("last_30_day_sales", ascending=False)
    return filtered


def format_dashboard_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    available = [col for col in DASHBOARD_COLUMNS if col in df.columns]
    display = df[available].copy()
    rename_map = {
        "supplier_name": "Supplier",
        "product_name": "Wine",
        "is_btg": "BTG",
        "is_core": "Core",
        "true_available": "True Available",
        "on_order": "On Order",
        "next_30_day_forecast": "Next 30d Forecast",
        "weekly_velocity": "Weekly Velocity",
        "velocity_trend_pct": "Velocity Trend",
        "risk_level": "Risk",
        "recommendation_status": "Approval",
        "product_code": "Code",
        "reorder_status": "Status",
        "recommended_qty_rounded": "Recommended Qty",
        "last_30_day_sales": "30d Sales",
        "weeks_on_hand_with_on_order": "Weeks w/ On Order",
        "order_timing_risk": "Timing Risk",
        "order_cost": "Est. Cost",
        "landed_cost": "Landed Cost",
        "planning_sku": "Planning SKU",
    }
    display = display.rename(columns=rename_map)

    for col in ["Recommended Qty", "30d Sales", "True Available", "On Order", "Next 30d Forecast"]:
        if col in display:
            display[col] = display[col].fillna(0).astype(int)

    for col in ["BTG", "Core"]:
        if col in display:
            display[col] = display[col].apply(lambda x: "Yes" if bool(x) else "")

    if "Velocity Trend" in display:
        display["Velocity Trend"] = display["Velocity Trend"].apply(
            lambda x: f"{x:+.0f}%" if pd.notna(x) else ""
        )

    if "Weekly Velocity" in display:
        display["Weekly Velocity"] = display["Weekly Velocity"].apply(
            lambda x: f"{x:.2f}" if pd.notna(x) else ""
        )

    if "Weeks w/ On Order" in display:
        display["Weeks w/ On Order"] = display["Weeks w/ On Order"].apply(
            lambda x: f"{x:.2f}" if pd.notna(x) else ""
        )

    for col in ["Est. Cost", "Landed Cost"]:
        if col in display:
            display[col] = display[col].apply(
                lambda x: f"${x:,.2f}" if pd.notna(x) else "$0.00"
            )

    return display


def supplier_summary(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty:
        return pd.DataFrame(columns=["Supplier", "SKUs", "Urgent", "Recommended Qty", "Est. Cost"])

    grouped = (
        df.groupby("supplier_name", dropna=False)
        .agg(
            skus=("product_name", "count"),
            urgent=("reorder_status", lambda s: int((s == "URGENT").sum())),
            recommended_qty=("recommended_qty_rounded", "sum"),
            order_cost=("order_cost", "sum"),
        )
        .reset_index()
        .sort_values(["urgent", "order_cost"], ascending=[False, False])
    )
    grouped = grouped.rename(
        columns={
            "supplier_name": "Supplier",
            "skus": "SKUs",
            "urgent": "Urgent",
            "recommended_qty": "Recommended Qty",
            "order_cost": "Est. Cost",
        }
    )
    grouped["Recommended Qty"] = grouped["Recommended Qty"].fillna(0).astype(int)
    grouped["Est. Cost"] = grouped["Est. Cost"].apply(lambda x: f"${x:,.2f}")
    return grouped


def location_summary(df: pd.DataFrame) -> pd.DataFrame:
    if df.empty or "pickup_location" not in df.columns:
        return pd.DataFrame(columns=["Pickup Location", "Suppliers", "SKUs", "Recommended Qty", "Landed Cost"])

    order_df = df[df.get("recommended_qty_rounded", 0) > 0].copy()
    if order_df.empty:
        return pd.DataFrame(columns=["Pickup Location", "Suppliers", "SKUs", "Recommended Qty", "Landed Cost"])

    grouped = (
        order_df.groupby("pickup_location", dropna=False)
        .agg(
            suppliers=("supplier_name", "nunique"),
            skus=("product_name", "count"),
            recommended_qty=("recommended_qty_rounded", "sum"),
            landed_cost=("landed_cost", "sum"),
        )
        .reset_index()
        .sort_values("recommended_qty", ascending=False)
    )
    grouped = grouped.rename(
        columns={
            "pickup_location": "Pickup Location",
            "suppliers": "Suppliers",
            "skus": "SKUs",
            "recommended_qty": "Recommended Qty",
            "landed_cost": "Landed Cost",
        }
    )
    grouped["Pickup Location"] = grouped["Pickup Location"].replace("", "Unassigned")
    grouped["Recommended Qty"] = grouped["Recommended Qty"].fillna(0).astype(int)
    grouped["Landed Cost"] = grouped["Landed Cost"].apply(lambda x: f"${x:,.2f}")
    return grouped


def california_truck_summary(df: pd.DataFrame) -> dict:
    if df.empty or "pickup_location" not in df.columns:
        bottles = 0
    else:
        location = df["pickup_location"].fillna("").astype(str).str.lower()
        bottles = int(df.loc[location == "california", "recommended_qty_rounded"].sum())
    ftl_bottles = 10200
    progress = bottles / ftl_bottles if ftl_bottles else 0
    bottles_needed = max(0, ftl_bottles - bottles)
    cases = bottles / 12
    estimated_savings = cases * 2 if bottles >= ftl_bottles else 0
    return {
        "bottles": bottles,
        "progress_pct": progress * 100,
        "bottles_needed": bottles_needed,
        "estimated_savings": estimated_savings,
    }


def po_export_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    available = [col for col in PO_COLUMNS if col in df.columns]
    po_df = df[df.get("recommended_qty_rounded", 0) > 0][available].copy()
    return po_df.rename(
        columns={
            "supplier_name": "Supplier",
            "product_name": "Wine",
            "product_code": "Code",
            "planning_sku": "Planning SKU",
            "recommended_qty_rounded": "Quantity",
            "order_cost": "Estimated Cost",
        }
    )


__all__ = [
    "DashboardMetrics",
    "dashboard_metrics",
    "filter_recommendations",
    "format_dashboard_dataframe",
    "california_truck_summary",
    "location_summary",
    "po_export_dataframe",
    "recommendations_to_dataframe",
    "supplier_summary",
]
