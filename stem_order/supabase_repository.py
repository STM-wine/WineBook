"""Optional Supabase repository layer.

This module is intentionally dormant until a Supabase project exists and the
Python Supabase client is installed. It gives workers and future app code one
place to write report-run state instead of spreading direct Supabase calls
through the codebase.
"""

from dataclasses import dataclass
from datetime import datetime, timezone
import math
import os
from pathlib import Path
from typing import Any

import pandas as pd


def load_dotenv(path: str | Path = ".env") -> None:
    path = Path(path)
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        os.environ.setdefault(key.strip(), value.strip().strip('"').strip("'"))


@dataclass(frozen=True)
class SupabaseConfig:
    url: str
    service_role_key: str

    @classmethod
    def from_env(cls) -> "SupabaseConfig":
        load_dotenv()
        url = os.getenv("SUPABASE_URL")
        service_role_key = os.getenv("SUPABASE_SERVICE_ROLE_KEY")
        missing = [
            name
            for name, value in [
                ("SUPABASE_URL", url),
                ("SUPABASE_SERVICE_ROLE_KEY", service_role_key),
            ]
            if not value
        ]
        if missing:
            raise RuntimeError(f"Missing Supabase environment variables: {', '.join(missing)}")
        return cls(url=url, service_role_key=service_role_key)


class SupabaseRepository:
    """Small repository wrapper around Supabase table writes."""

    def __init__(self, client):
        self.client = client

    @classmethod
    def from_env(cls) -> "SupabaseRepository":
        config = SupabaseConfig.from_env()
        try:
            from supabase import create_client
        except ImportError as exc:
            raise RuntimeError(
                "The Supabase Python client is not installed. Install it once a "
                "Supabase project is ready: pip install supabase"
            ) from exc

        return cls(create_client(config.url, config.service_role_key))

    def create_report_run(
        self,
        run_type: str = "manual_upload",
        source_file_ids: list[str] | None = None,
        diagnostics: dict[str, Any] | None = None,
        created_by: str | None = None,
    ) -> dict[str, Any]:
        payload = {
            "run_type": run_type,
            "status": "running",
            "source_file_ids": source_file_ids or [],
            "diagnostics": diagnostics or {},
            "created_by": created_by,
        }
        return self._insert_one("report_runs", payload)

    def complete_report_run(
        self,
        report_run_id: str,
        diagnostics: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        payload = {
            "status": "completed",
            "completed_at": datetime.now(timezone.utc).isoformat(),
        }
        if diagnostics is not None:
            payload["diagnostics"] = diagnostics
        return self._update_one("report_runs", report_run_id, payload)

    def fail_report_run(self, report_run_id: str, error_message: str) -> dict[str, Any]:
        return self._update_one(
            "report_runs",
            report_run_id,
            {
                "status": "failed",
                "completed_at": datetime.now(timezone.utc).isoformat(),
                "error_message": error_message,
            },
        )

    def save_recommendations(
        self,
        report_run_id: str,
        recommendations: pd.DataFrame,
    ) -> list[dict[str, Any]]:
        payloads = [
            self._recommendation_payload(report_run_id, row)
            for row in recommendations.to_dict(orient="records")
        ]
        if not payloads:
            return []

        result = self.client.table("reorder_recommendations").insert(payloads).execute()
        return result.data or []

    def create_purchase_order_draft(
        self,
        supplier_name: str,
        report_run_id: str,
        recommendations: pd.DataFrame,
        notes: str | None = None,
    ) -> dict[str, Any]:
        if "recommended_qty_rounded" in recommendations:
            qty = pd.to_numeric(recommendations["recommended_qty_rounded"], errors="coerce").fillna(0)
        else:
            qty = pd.Series([0] * len(recommendations), index=recommendations.index)
        order_rows = recommendations[qty > 0]
        if order_rows.empty:
            raise ValueError("Cannot create a PO draft with no recommended order quantities.")

        draft = self._insert_one(
            "purchase_order_drafts",
            {
                "supplier_name": clean_value(supplier_name),
                "report_run_id": report_run_id,
                "status": "draft",
                "notes": notes,
            },
        )

        line_payloads = [
            self._purchase_order_line_payload(draft["id"], row)
            for row in order_rows.to_dict(orient="records")
        ]
        lines_result = self.client.table("purchase_order_lines").insert(line_payloads).execute()
        draft["lines"] = lines_result.data or []
        return draft

    def get_latest_completed_report_run(self, limit: int = 1) -> dict[str, Any] | None:
        runs = self.get_completed_report_runs(limit=limit)
        return runs[0] if runs else None

    def get_completed_report_runs(self, limit: int = 10) -> list[dict[str, Any]]:
        result = (
            self.client.table("report_runs")
            .select("*")
            .eq("status", "completed")
            .order("completed_at", desc=True)
            .limit(limit)
            .execute()
        )
        return result.data or []

    def get_recommendations_for_run(
        self,
        report_run_id: str,
        limit: int = 5000,
    ) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        page_size = 1000
        while len(rows) < limit:
            start = len(rows)
            end = min(start + page_size, limit) - 1
            result = (
                self.client.table("reorder_recommendations")
                .select("*")
                .eq("report_run_id", report_run_id)
                .order("last_30_day_sales", desc=True)
                .range(start, end)
                .execute()
            )
            page = result.data or []
            rows.extend(page)
            if len(page) < page_size:
                break
        return rows

    def get_latest_recommendations(self, limit: int = 5000) -> tuple[dict[str, Any] | None, list[dict[str, Any]]]:
        for report_run in self.get_completed_report_runs(limit=25):
            recommendations = self.get_recommendations_for_run(report_run["id"], limit=limit)
            if recommendations:
                return report_run, recommendations
        return None, []

    def _insert_one(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.client.table(table).insert(payload).execute()
        if not result.data:
            raise RuntimeError(f"Supabase insert into {table} returned no data")
        return result.data[0]

    def _update_one(self, table: str, row_id: str, payload: dict[str, Any]) -> dict[str, Any]:
        result = self.client.table(table).update(payload).eq("id", row_id).execute()
        if not result.data:
            raise RuntimeError(f"Supabase update on {table}:{row_id} returned no data")
        return result.data[0]

    def _recommendation_payload(self, report_run_id: str, row: dict[str, Any]) -> dict[str, Any]:
        return {
            "report_run_id": report_run_id,
            "planning_sku": clean_value(row.get("planning_sku")),
            "product_name": clean_value(row.get("Name")),
            "product_code": clean_value(row.get("product_code")),
            "supplier_name": clean_value(row.get("importer")),
            "is_btg": bool_value(row.get("is_btg_bool", row.get("is_btg"))),
            "is_core": bool_value(row.get("is_core_bool", row.get("is_core"))),
            "last_30_day_sales": clean_value(row.get("last_30_day_sales"), 0),
            "last_60_day_sales": clean_value(row.get("last_60_day_sales"), 0),
            "last_90_day_sales": clean_value(row.get("last_90_day_sales"), 0),
            "next_30_day_forecast": clean_value(row.get("next_30_day_forecast"), 0),
            "next_60_day_forecast": clean_value(row.get("next_60_day_forecast"), 0),
            "next_90_day_forecast": clean_value(row.get("next_90_day_forecast"), 0),
            "next_60_days_ly_sales": clean_value(row.get("next_60_days_ly_sales"), 0),
            "weekly_velocity": clean_value(row.get("weekly_velocity")),
            "velocity_trend_pct": clean_value(row.get("velocity_trend_pct")),
            "weeks_on_hand": clean_value(row.get("weeks_on_hand")),
            "weeks_on_hand_with_on_order": clean_value(row.get("weeks_on_hand_with_on_order")),
            "target_days": int(clean_value(row.get("target_days"), 0) or 0),
            "target_qty": clean_value(row.get("target_qty"), 0),
            "recommended_qty_raw": clean_value(row.get("recommended_qty_raw"), 0),
            "recommended_qty_rounded": int(clean_value(row.get("recommended_qty_rounded"), 0) or 0),
            "recommendation_status": clean_value(row.get("recommendation_status"), "rejected"),
            "approved_qty": int(clean_value(row.get("approved_qty"), 0) or 0),
            "order_cost": clean_value(row.get("order_cost"), 0),
            "reorder_status": clean_value(row.get("reorder_status"), "NO SALES"),
            "risk_level": clean_value(row.get("risk_level"), "Unknown"),
            "order_timing_risk": clean_value(row.get("order_timing_risk")),
            "true_available": clean_value(row.get("true_available"), 0),
            "on_order": clean_value(row.get("on_order"), 0),
            "fob": clean_value(row.get("fob")),
            "pack_size": clean_value(row.get("pack_size")),
            "pickup_location": clean_value(row.get("pickup_location") or row.get("pick_up_location")),
            "trucking_cost_per_bottle": clean_value(row.get("trucking_cost_per_bottle"), 0),
            "landed_cost": clean_value(row.get("landed_cost"), row.get("order_cost", 0)),
            "diagnostics": {
                "true_available": clean_value(row.get("true_available")),
                "on_order": clean_value(row.get("on_order")),
                "fob": clean_value(row.get("fob")),
                "eta_days": clean_value(row.get("eta_days")),
                "eta_weeks": clean_value(row.get("eta_weeks")),
                "high_volume_rounding_required": clean_value(row.get("high_volume_rounding_required"), False),
            },
        }

    def _purchase_order_line_payload(self, purchase_order_draft_id: str, row: dict[str, Any]) -> dict[str, Any]:
        diagnostics = row.get("diagnostics") if isinstance(row.get("diagnostics"), dict) else {}
        recommended_qty = int(clean_value(row.get("recommended_qty_rounded"), 0) or 0)
        return {
            "purchase_order_draft_id": purchase_order_draft_id,
            "recommendation_id": clean_value(row.get("id")),
            "product_name": clean_value(row.get("product_name")),
            "product_code": clean_value(row.get("product_code")),
            "planning_sku": clean_value(row.get("planning_sku")),
            "recommended_qty": recommended_qty,
            "approved_qty": recommended_qty,
            "fob": clean_value(diagnostics.get("fob")),
            "line_cost": clean_value(row.get("order_cost"), 0),
        }


def clean_value(value, default=None):
    if value is None:
        return default
    try:
        if pd.isna(value):
            return default
    except (TypeError, ValueError):
        pass
    if isinstance(value, float) and math.isinf(value):
        return default
    return value


def bool_value(value) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return False
    try:
        if pd.isna(value):
            return False
    except (TypeError, ValueError):
        pass
    text = str(value).strip().lower()
    return text in {"1", "true", "yes", "y"}


__all__ = ["SupabaseConfig", "SupabaseRepository", "bool_value", "clean_value", "load_dotenv"]
