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
    "approved_qty",
    "fob",
    "order_cost",
]

APPROVAL_STATUSES = ["rejected", "approved", "edited", "deferred"]
APPROVED_STATUSES = ["approved", "edited"]
IMPORTER_WORKFLOW_STATUSES = ["Not Started", "In Progress", "Approved", "PO Sent"]
BUYER_OPTIONAL_HISTORY_COLUMNS = [
    "last_60_day_sales",
    "last_90_day_sales",
]
BUYER_OPTIONAL_FORECAST_COLUMNS = [
    "next_60_day_forecast",
    "next_90_day_forecast",
]


def _clean_int(value, default: int = 0) -> int:
    parsed = pd.to_numeric(value, errors="coerce")
    if pd.isna(parsed):
        return default
    return int(parsed)


def _clean_float(value, default: float = 0.0) -> float:
    parsed = pd.to_numeric(value, errors="coerce")
    if pd.isna(parsed):
        return default
    return float(parsed)


def _round_up_to_pack(quantity: float, pack_size: float | int | None) -> int:
    if quantity <= 0:
        return 0
    pack = _clean_int(pack_size, 1)
    if pack <= 0:
        pack = 1
    return int(((int(quantity + pack - 1)) // pack) * pack)


def _rank_velocity_series(df: pd.DataFrame) -> pd.Series:
    for column in [
        "last_365_day_sales",
        "last_12_month_sales",
        "last_90_day_sales",
        "last_60_day_sales",
        "last_30_day_sales",
    ]:
        if column in df.columns:
            values = pd.to_numeric(df[column], errors="coerce").fillna(0)
            if float(values.sum()) > 0:
                return values
    return pd.Series([0] * len(df), index=df.index)


def _wine_display(row: pd.Series) -> str:
    flags = []
    if bool(row.get("is_core", False)):
        flags.append("⭐")
    if bool(row.get("is_btg", False)):
        flags.append("🍷")
    suffix = f" {' '.join(flags)}" if flags else ""
    return f"#{_clean_int(row.get('_importer_rank'), 0)} {row.get('product_name', '')}{suffix}"


def working_qty_from_weeks(row: dict | pd.Series) -> int:
    target_weeks = _clean_float(row.get("Weeks w/ Recommended"), 0.0)
    weekly_velocity = _clean_float(row.get("Weekly Velocity"), 0.0)
    true_available = _clean_float(row.get("True Available"), 0.0)
    on_order = _clean_float(row.get("On Order"), 0.0)
    pack_size = row.get("_Pack Size", 1)
    raw_qty = max(0.0, (target_weeks * weekly_velocity) - (true_available + on_order))
    return _round_up_to_pack(raw_qty, pack_size)


def working_weeks_from_qty(row: dict | pd.Series) -> float:
    weekly_velocity = _clean_float(row.get("Weekly Velocity"), 0.0)
    if weekly_velocity <= 0:
        return 0.0
    true_available = _clean_float(row.get("True Available"), 0.0)
    on_order = _clean_float(row.get("On Order"), 0.0)
    recommended_qty = _clean_float(row.get("Recommended Qty"), 0.0)
    return round((true_available + on_order + recommended_qty) / weekly_velocity, 1)


def recalculate_working_recommendation(df: pd.DataFrame) -> pd.DataFrame:
    display = df.copy()
    required = ["True Available", "On Order", "Recommended Qty", "Weekly Velocity"]
    if display.empty or not all(col in display.columns for col in required):
        return display

    display["Weeks w/ Recommended"] = display.apply(working_weeks_from_qty, axis=1)
    return display


@dataclass
class DashboardMetrics:
    rows: int
    urgent_skus: int
    low_skus: int
    recommended_bottles: int
    estimated_order_cost: float
    suppliers_with_orders: int


@dataclass
class ApprovalMetrics:
    approved_lines: int
    approved_bottles: int
    approved_cost: float
    pending_lines: int


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
        "fob",
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


def approval_metrics(df: pd.DataFrame) -> ApprovalMetrics:
    if df.empty:
        return ApprovalMetrics(0, 0, 0.0, 0)

    if "recommendation_status" in df:
        approved_status = df["recommendation_status"].isin(["approved", "edited"])
    else:
        approved_status = pd.Series([False] * len(df), index=df.index)
    approved_qty = pd.to_numeric(df.get("approved_qty", 0), errors="coerce").fillna(0)
    approved_df = df[approved_status & (approved_qty > 0)].copy()
    if "approved_qty" in approved_df:
        approved_df["approved_qty"] = pd.to_numeric(approved_df["approved_qty"], errors="coerce").fillna(0)

    if "fob" in approved_df:
        fob = pd.to_numeric(approved_df["fob"], errors="coerce")
        approved_cost = float((fob.fillna(0) * approved_df.get("approved_qty", 0)).sum())
    else:
        approved_cost = float(approved_df.get("order_cost", pd.Series(dtype=float)).sum())

    pending = int((df["recommendation_status"] == "rejected").sum()) if "recommendation_status" in df else 0
    return ApprovalMetrics(
        approved_lines=len(approved_df),
        approved_bottles=int(approved_df.get("approved_qty", pd.Series(dtype=float)).sum()),
        approved_cost=approved_cost,
        pending_lines=pending,
    )


def risk_counts(df: pd.DataFrame) -> dict[str, int]:
    if df.empty or "risk_level" not in df:
        return {"High": 0, "Medium": 0, "Low": 0}
    counts = df["risk_level"].fillna("").value_counts()
    return {
        "High": int(counts.get("High", 0)),
        "Medium": int(counts.get("Medium", 0)),
        "Low": int(counts.get("Low", 0)),
    }


def importer_workflow_status(df: pd.DataFrame, po_sent: bool = False) -> str:
    if po_sent:
        return "PO Sent"
    if df.empty:
        return "Not Started"

    actionable = df[pd.to_numeric(df.get("recommended_qty_rounded", 0), errors="coerce").fillna(0) > 0]
    if actionable.empty:
        return "Not Started"

    statuses = actionable.get("recommendation_status", pd.Series(["rejected"] * len(actionable), index=actionable.index))
    approved_qty = pd.to_numeric(actionable.get("approved_qty", 0), errors="coerce").fillna(0)
    approved_mask = statuses.isin(APPROVED_STATUSES) & (approved_qty > 0)

    if bool(approved_mask.all()):
        return "Approved"
    if bool(approved_mask.any()) or bool((statuses != "rejected").any()):
        return "In Progress"
    return "Not Started"


def importer_workbench_summary(df: pd.DataFrame, po_sent_suppliers: set[str] | None = None) -> pd.DataFrame:
    columns = [
        "Importer",
        "Status",
        "SKUs",
        "Urgent",
        "Suggested Qty",
        "Suggested Value",
        "Approved Qty",
        "Approved Value",
    ]
    if df.empty or "supplier_name" not in df:
        return pd.DataFrame(columns=columns)

    po_sent_suppliers = po_sent_suppliers or set()
    rows = []
    for supplier, group in df.groupby("supplier_name", dropna=False):
        supplier_name = "Unassigned" if pd.isna(supplier) or supplier == "" else supplier
        suggested_qty = int(pd.to_numeric(group.get("recommended_qty_rounded", 0), errors="coerce").fillna(0).sum())
        suggested_value = float(pd.to_numeric(group.get("order_cost", 0), errors="coerce").fillna(0).sum())
        approved_qty = pd.to_numeric(group.get("approved_qty", 0), errors="coerce").fillna(0)
        if "fob" in group:
            approved_value = float((pd.to_numeric(group["fob"], errors="coerce").fillna(0) * approved_qty).sum())
        else:
            approved_value = 0.0
        rows.append(
            {
                "Importer": supplier_name,
                "Status": importer_workflow_status(group, supplier_name in po_sent_suppliers),
                "SKUs": int(len(group)),
                "Urgent": int((group.get("reorder_status", "") == "URGENT").sum()),
                "Suggested Qty": suggested_qty,
                "Suggested Value": suggested_value,
                "Approved Qty": int(approved_qty.sum()),
                "Approved Value": approved_value,
            }
        )

    summary = pd.DataFrame(rows, columns=columns)
    if summary.empty:
        return summary
    return summary.sort_values("Suggested Value", ascending=False).reset_index(drop=True)


def importer_groups(df: pd.DataFrame, po_sent_suppliers: set[str] | None = None) -> list[dict]:
    summary = importer_workbench_summary(df, po_sent_suppliers=po_sent_suppliers)
    groups = []
    for row in summary.to_dict(orient="records"):
        importer = row["Importer"]
        group = df[df["supplier_name"].fillna("").replace("", "Unassigned") == importer].copy()
        if "order_cost" in group:
            group = group.sort_values("order_cost", ascending=False)
        elif "recommended_qty_rounded" in group:
            group = group.sort_values("recommended_qty_rounded", ascending=False)
        groups.append({"summary": row, "data": group})
    return groups


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


def approval_editor_dataframe(df: pd.DataFrame) -> pd.DataFrame:
    columns = [
        "id",
        "supplier_name",
        "product_name",
        "product_code",
        "reorder_status",
        "risk_level",
        "recommended_qty_rounded",
        "recommendation_status",
        "approved_qty",
        "order_cost",
    ]
    available = [col for col in columns if col in df.columns]
    editor = df[available].copy()

    if "approved_qty" not in editor.columns:
        editor["approved_qty"] = 0
    if "recommendation_status" not in editor.columns:
        editor["recommendation_status"] = "rejected"

    for col in ["recommended_qty_rounded", "approved_qty"]:
        if col in editor.columns:
            editor[col] = pd.to_numeric(editor[col], errors="coerce").fillna(0).astype(int)

    rename_map = {
        "supplier_name": "Supplier",
        "product_name": "Wine",
        "product_code": "Code",
        "reorder_status": "Status",
        "risk_level": "Risk",
        "recommended_qty_rounded": "Recommended Qty",
        "recommendation_status": "Approval",
        "approved_qty": "Approved Qty",
        "order_cost": "Est. Cost",
    }
    return editor.rename(columns=rename_map)


def approval_updates_from_editor(original: pd.DataFrame, edited: pd.DataFrame) -> list[dict]:
    if original.empty or edited.empty or "id" not in original.columns or "id" not in edited.columns:
        return []

    original_by_id = original.set_index("id")
    updates = []
    for row in edited.to_dict(orient="records"):
        recommendation_id = row.get("id")
        if recommendation_id not in original_by_id.index:
            continue

        status = row.get("Approval", row.get("recommendation_status", "rejected"))
        approved_qty = _clean_int(row.get("Approved Qty", row.get("approved_qty", 0)))
        if status not in APPROVAL_STATUSES:
            status = "rejected"
        if approved_qty < 0:
            approved_qty = 0

        original_row = original_by_id.loc[recommendation_id]
        original_status = original_row.get("recommendation_status", "rejected")
        original_qty = _clean_int(original_row.get("approved_qty", 0))

        if status != original_status or approved_qty != original_qty:
            updates.append(
                {
                    "id": recommendation_id,
                    "recommendation_status": status,
                    "approved_qty": approved_qty,
                }
            )
    return updates


def buyer_workbench_dataframe(
    df: pd.DataFrame,
    show_history: bool = False,
    show_forecast: bool = False,
) -> pd.DataFrame:
    columns = [
        "id",
        "product_name",
        "is_core",
        "is_btg",
        "true_available",
        "on_order",
        "last_30_day_sales",
        "next_30_day_forecast",
        "weekly_velocity",
        "velocity_trend_pct",
        "weeks_on_hand_with_on_order",
        "recommended_qty_rounded",
        "recommendation_status",
        "approved_qty",
        "order_cost",
        "fob",
        "pack_size",
    ]
    optional = []
    if show_history:
        optional.extend(BUYER_OPTIONAL_HISTORY_COLUMNS)
    if show_forecast:
        optional.extend(BUYER_OPTIONAL_FORECAST_COLUMNS)

    available = [col for col in columns + optional if col in df.columns]
    editor = df[available].copy()
    if editor.empty:
        return pd.DataFrame(
            columns=[
                "id",
                "Wine",
                "True Available",
                "On Order",
                "30d Sales",
                "Next 30d Forecast",
                "Weekly Velocity",
                "Velocity Trend",
                "Weeks w/ On Order",
                "Weeks w/ Recommended",
                "Recommended Qty",
                "Approval",
                "Est. Cost",
            ]
        )

    for col in [
        "true_available",
        "on_order",
        "last_30_day_sales",
        "next_30_day_forecast",
        "weekly_velocity",
        "velocity_trend_pct",
        "weeks_on_hand_with_on_order",
        "recommended_qty_rounded",
        "approved_qty",
        "order_cost",
        "fob",
        "pack_size",
        *optional,
    ]:
        if col in editor.columns:
            editor[col] = pd.to_numeric(editor[col], errors="coerce").fillna(0)

    for col in ["is_core", "is_btg"]:
        if col not in editor.columns:
            editor[col] = False
        editor[col] = editor[col].fillna(False).astype(bool)

    editor["_velocity_rank_basis"] = _rank_velocity_series(df).reindex(editor.index).fillna(0)
    editor["_importer_rank"] = editor["_velocity_rank_basis"].rank(method="dense", ascending=False).astype(int)
    editor["Wine"] = editor.apply(_wine_display, axis=1)
    statuses = (
        editor["recommendation_status"]
        if "recommendation_status" in editor.columns
        else pd.Series(["rejected"] * len(editor), index=editor.index)
    )
    editor["Approval"] = (
        statuses.isin(APPROVED_STATUSES)
        & (pd.to_numeric(editor.get("approved_qty", 0), errors="coerce").fillna(0) > 0)
    )
    approved_qty = pd.to_numeric(editor.get("approved_qty", 0), errors="coerce").fillna(0)
    working_qty = pd.to_numeric(editor.get("recommended_qty_rounded", 0), errors="coerce").fillna(0)
    editor["Working Recommended Qty"] = working_qty
    editor.loc[statuses.isin(APPROVED_STATUSES) & (approved_qty > 0), "Working Recommended Qty"] = approved_qty

    coverage_qty = editor["true_available"] + editor["on_order"] + editor["Working Recommended Qty"]
    weekly_velocity = editor["weekly_velocity"].replace(0, pd.NA)
    editor["Weeks w/ Recommended"] = (coverage_qty / weekly_velocity).fillna(0).round(1)
    if "pack_size" in editor.columns:
        editor["_Pack Size"] = pd.to_numeric(editor["pack_size"], errors="coerce").fillna(1)
    else:
        editor["_Pack Size"] = 1

    rename_map = {
        "true_available": "True Available",
        "on_order": "On Order",
        "last_30_day_sales": "30d Sales",
        "last_60_day_sales": "60d Sales",
        "last_90_day_sales": "90d Sales",
        "next_30_day_forecast": "Next 30d Forecast",
        "next_60_day_forecast": "LY Next 60d Forecast",
        "next_90_day_forecast": "LY Next 90d Forecast",
        "weekly_velocity": "Weekly Velocity",
        "velocity_trend_pct": "Velocity Trend",
        "weeks_on_hand_with_on_order": "Weeks w/ On Order",
        "Working Recommended Qty": "Recommended Qty",
        "order_cost": "Est. Cost",
    }
    editor = editor.rename(columns=rename_map)
    ordered = [
        "id",
        "Wine",
        "True Available",
        "On Order",
        "30d Sales",
        "60d Sales",
        "90d Sales",
        "Next 30d Forecast",
        "LY Next 60d Forecast",
        "LY Next 90d Forecast",
        "Weekly Velocity",
        "Velocity Trend",
        "Weeks w/ On Order",
        "Weeks w/ Recommended",
        "_Pack Size",
        "Recommended Qty",
        "Approval",
        "Est. Cost",
    ]
    display = editor[[col for col in ordered if col in editor.columns]].copy()
    if "Velocity Trend" in display:
        display["Velocity Trend"] = display["Velocity Trend"].apply(lambda x: f"{x:+.0f}%" if pd.notna(x) else "")
    if "Recommended Qty" in display:
        display = display.sort_values("Recommended Qty", ascending=False)
    return recalculate_working_recommendation(display.reset_index(drop=True))


def buyer_updates_from_editor(original: pd.DataFrame, edited: pd.DataFrame) -> list[dict]:
    if original.empty or edited.empty or "id" not in original.columns or "id" not in edited.columns:
        return []

    original_by_id = original.set_index("id")
    updates = []
    for row in edited.to_dict(orient="records"):
        recommendation_id = row.get("id")
        if recommendation_id not in original_by_id.index:
            continue

        original_row = original_by_id.loc[recommendation_id]
        approved = bool(row.get("Approval", False))
        suggested_qty = _clean_int(original_row.get("recommended_qty_rounded"), 0)

        if approved:
            approved_qty = _clean_int(row.get("Recommended Qty"), suggested_qty)
            if approved_qty < 0:
                approved_qty = 0
            status = "edited" if approved_qty != suggested_qty else "approved"
        else:
            approved_qty = 0
            status = "rejected"

        original_status = original_row.get("recommendation_status", "rejected")
        original_qty = _clean_int(original_row.get("approved_qty"), 0)
        if status != original_status or approved_qty != original_qty:
            updates.append(
                {
                    "id": recommendation_id,
                    "recommendation_status": status,
                    "approved_qty": approved_qty,
                }
            )
    return updates


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
    if "recommendation_status" in df:
        approved_status = df["recommendation_status"].isin(["approved", "edited"])
    else:
        approved_status = pd.Series([False] * len(df), index=df.index)
    approved_qty = pd.to_numeric(df.get("approved_qty", 0), errors="coerce").fillna(0)
    po_df = df[approved_status & (approved_qty > 0)][available].copy()
    if "approved_qty" in po_df.columns:
        po_df["approved_qty"] = pd.to_numeric(po_df["approved_qty"], errors="coerce").fillna(0).astype(int)
    if "fob" in po_df.columns:
        po_df["Estimated Cost"] = pd.to_numeric(po_df["fob"], errors="coerce").fillna(0) * po_df["approved_qty"]
        po_df = po_df.drop(columns=["fob"])
    return po_df.rename(
        columns={
            "supplier_name": "Supplier",
            "product_name": "Wine",
            "product_code": "Code",
            "planning_sku": "Planning SKU",
            "approved_qty": "Quantity",
            "order_cost": "Recommended Cost",
        }
    )


__all__ = [
    "ApprovalMetrics",
    "DashboardMetrics",
    "APPROVED_STATUSES",
    "approval_metrics",
    "dashboard_metrics",
    "filter_recommendations",
    "format_dashboard_dataframe",
    "approval_editor_dataframe",
    "approval_updates_from_editor",
    "buyer_workbench_dataframe",
    "buyer_updates_from_editor",
    "recalculate_working_recommendation",
    "APPROVAL_STATUSES",
    "IMPORTER_WORKFLOW_STATUSES",
    "california_truck_summary",
    "importer_groups",
    "importer_workbench_summary",
    "importer_workflow_status",
    "location_summary",
    "po_export_dataframe",
    "recommendations_to_dataframe",
    "risk_counts",
    "supplier_summary",
    "working_qty_from_weeks",
    "working_weeks_from_qty",
]
