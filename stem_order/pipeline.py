"""Ordering pipeline orchestration shared by Streamlit and future workers."""

from dataclasses import dataclass
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd

from stem_order.core import calculate_reorder_recommendations, normalize_planning_sku
from stem_order.ingest import (
    clean_importer_name,
    detect_rads_header,
    detect_rb6_header,
    load_importers_csv,
    map_rads_columns,
    map_rb6_columns,
    normalize_rads_dataframe,
    normalize_rb6_dataframe,
)


DISPLAY_COLUMNS = [
    "planning_sku",
    "Name",
    "product_code",
    "vintage",
    "wine_category",
    "product_type",
    "brand_manager",
    "is_btg",
    "is_core",
    "importer",
    "true_available",
    "on_order",
    "fob",
    "last_30_day_sales",
    "last_60_day_sales",
    "last_90_day_sales",
    "prior_30_day_sales",
    "next_30_day_forecast",
    "next_60_day_forecast",
    "next_90_day_forecast",
    "next_60_days_ly_sales",
    "last_30_day_sales_qty_across_all_accounts",
    "last_60_day_sales_qty_across_all_accounts",
    "last_90_day_sales_qty_across_all_accounts",
    "average_qty_sold_interval",
    "weekly_velocity",
    "velocity_trend_pct",
    "velocity_trend_label",
    "weeks_on_hand",
    "weeks_on_hand_with_on_order",
    "eta_days",
    "eta_weeks",
    "projected_arrival_date",
    "order_timing_risk",
    "pickup_location",
    "pick_up_location",
    "freight_forwarder",
    "order_frequency",
    "trucking_cost_per_bottle",
    "landed_cost",
    "notes",
    "recommended_qty_raw",
    "recommended_qty_rounded",
    "recommendation_status",
    "approved_qty",
    "high_volume_rounding_required",
    "order_cost",
    "reorder_status",
    "risk_level",
]


@dataclass
class SourceData:
    data: pd.DataFrame
    header_row: int
    original_columns: list[str]
    normalized_columns: list[str]
    column_map: dict[str, str]


@dataclass
class PipelineResult:
    rb6: SourceData
    rads: SourceData
    recommendations: pd.DataFrame
    raw_df: pd.DataFrame
    display_df: pd.DataFrame
    importers_loaded: bool
    importers_warning: str | None
    diagnostics: dict


def prepare_rb6_source(file_or_path) -> SourceData:
    header_row, rb6_data = detect_rb6_header(file_or_path)
    if rb6_data is None:
        raise ValueError("Could not detect header row in RB6 file. Please check the file format.")

    rb6_data, original_cols = normalize_rb6_dataframe(rb6_data)
    col_map = map_rb6_columns(rb6_data)

    missing = []
    for field in ["importer", "available_inventory", "description"]:
        if field not in col_map:
            missing.append(field)
    if missing:
        raise ValueError(f"Missing required RB6 columns: {missing}. Available: {list(rb6_data.columns)}")

    rb6_data["importer"] = rb6_data[col_map["importer"]]
    rb6_data["available_inventory"] = pd.to_numeric(
        rb6_data[col_map["available_inventory"]], errors="coerce"
    ).fillna(0)
    if "on_order" in col_map:
        rb6_data["on_order"] = pd.to_numeric(rb6_data[col_map["on_order"]], errors="coerce").fillna(0)
    else:
        rb6_data["on_order"] = 0
    rb6_data["name"] = rb6_data[col_map["description"]]

    return SourceData(
        data=rb6_data,
        header_row=header_row,
        original_columns=original_cols,
        normalized_columns=list(rb6_data.columns),
        column_map=col_map,
    )


def prepare_rads_source(file_or_path) -> SourceData:
    header_row, sales_data = detect_rads_header(file_or_path)
    if sales_data is None:
        raise ValueError("Could not detect header row in RADs file. Please check the file format.")

    sales_data, original_cols = normalize_rads_dataframe(sales_data)
    col_map = map_rads_columns(sales_data)

    missing = []
    for field in ["product_name", "quantity", "date"]:
        if field not in col_map:
            missing.append(field)
    if missing:
        raise ValueError(f"Missing required RADs columns: {missing}. Available: {list(sales_data.columns)}")

    sales_data["wine_name"] = sales_data[col_map["product_name"]]
    sales_data["quantity"] = pd.to_numeric(sales_data[col_map["quantity"]], errors="coerce").fillna(0)
    sales_data["date"] = sales_data[col_map["date"]]
    if "account" in col_map:
        sales_data["account"] = sales_data[col_map["account"]]

    return SourceData(
        data=sales_data,
        header_row=header_row,
        original_columns=original_cols,
        normalized_columns=list(sales_data.columns),
        column_map=col_map,
    )


def add_importer_logistics(
    recommendations: pd.DataFrame,
    rb6_data: pd.DataFrame,
    importers_data: pd.DataFrame,
    importers_loaded: bool,
    today: datetime | None = None,
) -> pd.DataFrame:
    recommendations = recommendations.copy()

    if "planning_sku_norm" not in rb6_data.columns:
        rb6_data = rb6_data.copy()
        rb6_data["planning_sku_norm"] = rb6_data["name"].apply(normalize_planning_sku)

    importer_map = rb6_data.drop_duplicates(subset=["planning_sku_norm"], keep="first")[
        ["planning_sku_norm", "importer"]
    ].copy()
    importer_map.columns = ["planning_sku", "importer"]
    recommendations = recommendations.merge(importer_map, on="planning_sku", how="left")

    importer_col = next(
        (
            col
            for col in ["importer", "importer_x", "importer_y", "rb6_importer", "supplier", "supplier_name"]
            if col in recommendations.columns
        ),
        None,
    )
    recommendations["importer"] = recommendations[importer_col] if importer_col else ""

    if importers_loaded:
        logistics_cols = [
            "importer_name_clean",
            "importer_id",
            "eta_days",
            "pick_up_location",
            "freight_forwarder",
            "order_frequency",
            "trucking_cost_per_bottle",
            "notes",
        ]
        recommendations["importer_clean"] = recommendations["importer"].fillna("").apply(clean_importer_name)
        recommendations = recommendations.merge(
            importers_data[[col for col in logistics_cols if col in importers_data.columns]],
            left_on="importer_clean",
            right_on="importer_name_clean",
            how="left",
        )
        recommendations = recommendations.drop(
            columns=["importer_name_clean", "importer_clean"], errors="ignore"
        )

    if "eta_days" not in recommendations.columns:
        recommendations["eta_days"] = None
    if "trucking_cost_per_bottle" not in recommendations.columns:
        recommendations["trucking_cost_per_bottle"] = 0

    recommendations["trucking_cost_per_bottle"] = pd.to_numeric(
        recommendations["trucking_cost_per_bottle"], errors="coerce"
    ).fillna(0)
    recommendations["landed_cost"] = (
        pd.to_numeric(recommendations.get("order_cost", 0), errors="coerce").fillna(0)
        + (
            pd.to_numeric(recommendations.get("recommended_qty_rounded", 0), errors="coerce").fillna(0)
            * recommendations["trucking_cost_per_bottle"]
        )
    )
    if "pick_up_location" in recommendations.columns:
        recommendations["pickup_location"] = recommendations["pick_up_location"]

    today = today or datetime.now()
    recommendations["eta_weeks"] = recommendations["eta_days"].apply(
        lambda x: round(x / 7, 2) if pd.notna(x) else None
    )
    recommendations["projected_arrival_date"] = recommendations["eta_days"].apply(
        lambda x: (today + timedelta(days=int(x))).strftime("%Y-%m-%d")
        if pd.notna(x) and x > 0
        else None
    )
    recommendations["order_timing_risk"] = recommendations.apply(calculate_order_timing_risk, axis=1)
    return recommendations


def calculate_order_timing_risk(row) -> str:
    weeks_on_hand = row.get("weeks_on_hand_with_on_order", None)
    eta_weeks = row.get("eta_weeks", None)

    if pd.isna(weeks_on_hand) or weeks_on_hand == 999:
        return "Unknown"
    if pd.isna(eta_weeks):
        return "Missing ETA"
    if weeks_on_hand < eta_weeks:
        return "High Risk"
    if weeks_on_hand < eta_weeks + 2:
        return "Medium Risk"
    return "Safe"


def select_raw_output(recommendations: pd.DataFrame) -> pd.DataFrame:
    available_display_cols = [col for col in DISPLAY_COLUMNS if col in recommendations.columns]
    return recommendations[available_display_cols].copy()


def format_display_dataframe(raw_df: pd.DataFrame) -> pd.DataFrame:
    display_df = raw_df.copy()

    bottle_columns = [
        "true_available",
        "on_order",
        "last_30_day_sales",
        "last_60_day_sales",
        "last_90_day_sales",
        "prior_30_day_sales",
        "next_30_day_forecast",
        "next_60_day_forecast",
        "next_90_day_forecast",
        "next_60_days_ly_sales",
        "recommended_qty_raw",
        "recommended_qty_rounded",
        "approved_qty",
    ]
    for col in bottle_columns:
        if col in display_df.columns:
            display_df[col] = display_df[col].fillna(0).astype(int)

    velocity_columns = ["weekly_velocity", "weeks_on_hand", "weeks_on_hand_with_on_order", "fob", "velocity_trend_pct"]
    for col in velocity_columns:
        if col in display_df.columns:
            display_df[col] = display_df[col].apply(lambda x: f"{x:.2f}" if pd.notna(x) else "")

    for money_col in ["order_cost", "landed_cost", "trucking_cost_per_bottle"]:
        if money_col in display_df.columns:
            display_df[money_col] = display_df[money_col].apply(
                lambda x: f"${x:,.2f}" if pd.notna(x) else "$0.00"
            )

    if "vintage" in display_df.columns:
        display_df["vintage"] = (
            display_df["vintage"]
            .fillna("")
            .astype(str)
            .str.replace(",", "", regex=False)
            .str.replace(".0", "", regex=False)
        )

    return display_df


def build_ordering_pipeline(
    rb6_file_or_path,
    rads_file_or_path,
    importers_path: str | Path | None = None,
    importers_data: pd.DataFrame | None = None,
) -> PipelineResult:
    rb6 = prepare_rb6_source(rb6_file_or_path)
    rads = prepare_rads_source(rads_file_or_path)
    if importers_data is not None:
        importers_loaded = not importers_data.empty
        importers_warning = None if importers_loaded else "supplier logistics table is empty"
    elif importers_path:
        importers_data, importers_loaded, importers_warning = load_importers_csv(importers_path)
    else:
        importers_data, importers_loaded, importers_warning = (
            pd.DataFrame(),
            False,
            "importers.csv not configured",
        )

    recommendations = calculate_reorder_recommendations(rb6.data, rads.data)
    recommendations = add_importer_logistics(recommendations, rb6.data, importers_data, importers_loaded)
    raw_df = select_raw_output(recommendations)
    display_df = format_display_dataframe(raw_df)

    diagnostics = build_diagnostics(rb6, rads, recommendations, raw_df)
    return PipelineResult(
        rb6=rb6,
        rads=rads,
        recommendations=recommendations,
        raw_df=raw_df,
        display_df=display_df,
        importers_loaded=importers_loaded,
        importers_warning=importers_warning,
        diagnostics=diagnostics,
    )


def build_diagnostics(
    rb6: SourceData,
    rads: SourceData,
    recommendations: pd.DataFrame,
    raw_df: pd.DataFrame,
) -> dict:
    rb6_planning_skus = set()
    rads_planning_skus = set()

    if "name" in rb6.data.columns:
        rb6_planning_skus = set(rb6.data["name"].apply(normalize_planning_sku).dropna().unique())
    if "wine_name" in rads.data.columns:
        rads_planning_skus = set(rads.data["wine_name"].apply(normalize_planning_sku).dropna().unique())

    critical_fields = ["product_code", "Name", "importer", "true_available", "last_30_day_sales"]
    field_nulls = {}
    for field in critical_fields:
        if field in raw_df.columns:
            null_count = int(raw_df[field].isna().sum())
            total = len(raw_df)
            field_nulls[field] = {
                "null_count": null_count,
                "total": total,
                "null_pct": (null_count / total) * 100 if total else 0,
            }

    return {
        "rb6_rows": len(rb6.data),
        "rads_rows": len(rads.data),
        "rb6_unique_planning_skus": len(rb6_planning_skus),
        "rads_unique_planning_skus": len(rads_planning_skus),
        "matched_planning_skus": len(rb6_planning_skus & rads_planning_skus),
        "unmatched_rb6_planning_skus": len(rb6_planning_skus - rads_planning_skus),
        "recommendation_rows": len(recommendations),
        "urgent_skus": int((recommendations["reorder_status"] == "URGENT").sum())
        if "reorder_status" in recommendations.columns
        else 0,
        "recommended_bottles": int(recommendations["recommended_qty_rounded"].sum())
        if "recommended_qty_rounded" in recommendations.columns
        else 0,
        "estimated_order_cost": float(recommendations["order_cost"].sum())
        if "order_cost" in recommendations.columns
        else 0,
        "field_nulls": field_nulls,
    }


__all__ = [
    "DISPLAY_COLUMNS",
    "PipelineResult",
    "SourceData",
    "add_importer_logistics",
    "build_ordering_pipeline",
    "calculate_order_timing_risk",
    "format_display_dataframe",
    "prepare_rads_source",
    "prepare_rb6_source",
    "select_raw_output",
]
