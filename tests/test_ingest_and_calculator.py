import unittest

import pandas as pd

from scripts.process_daily_vinosmith_email import (
    AttachmentCandidate,
    classify_attachments,
    safe_filename,
    storage_path,
)
from stem_order.core import calculate_reorder_recommendations, normalize_planning_sku
from stem_order.ingest import (
    clean_importer_name,
    load_importers_csv,
    map_rads_columns,
    map_rb6_columns,
    normalize_columns,
)
from stem_order.pipeline import format_display_dataframe, select_raw_output
from stem_order.dashboard import (
    approval_editor_dataframe,
    approval_metrics,
    approval_updates_from_editor,
    california_truck_summary,
    dashboard_metrics,
    filter_recommendations,
    location_summary,
    po_export_dataframe,
    recommendations_to_dataframe,
    risk_counts,
)
from stem_order.supabase_repository import SupabaseRepository


class IngestTests(unittest.TestCase):
    def test_normalize_columns_handles_duplicates_and_punctuation(self):
        df = pd.DataFrame(columns=[" Wine: External ID (1) ", "Available Inventory", "Available Inventory"])

        normalized = normalize_columns(df)

        self.assertEqual(
            list(normalized.columns),
            ["wine_external_id_1", "available_inventory", "available_inventory_1"],
        )

    def test_column_mapping_matches_mark_exports(self):
        rb6 = normalize_columns(
            pd.DataFrame(
                columns=[
                    "Name",
                    "Code",
                    "Available Inventory",
                    "On Order",
                    "Importer",
                    "FOB",
                ]
            )
        )
        rads = normalize_columns(
            pd.DataFrame(
                columns=[
                    "Account Name",
                    "Wine Name",
                    "Quantity",
                    "Date (mm/dd/yyyy)",
                    "Product Code",
                ]
            )
        )

        self.assertEqual(map_rb6_columns(rb6)["description"], "name")
        self.assertEqual(map_rb6_columns(rb6)["available_inventory"], "available_inventory")
        self.assertEqual(map_rb6_columns(rb6)["on_order"], "on_order")
        self.assertEqual(map_rads_columns(rads)["product_name"], "wine_name")
        self.assertEqual(map_rads_columns(rads)["quantity"], "quantity")
        self.assertEqual(map_rads_columns(rads)["date"], "date_mm_dd_yyyy")

    def test_rb6_on_order_prefers_true_on_order_header(self):
        columns = [
            "Name",
            "Importer",
            "Available Inventory",
            'Estimated # of Intervals Supply Remaining with "On Order" Considered',
            "On Order",
        ]
        rb6 = normalize_columns(pd.DataFrame(columns=columns))

        self.assertEqual(map_rb6_columns(rb6)["on_order"], "on_order")

    def test_clean_importer_name_collapses_whitespace(self):
        self.assertEqual(clean_importer_name("  Barnard   Griffin "), "barnard griffin")

    def test_missing_importers_csv_degrades_to_empty_frame(self):
        data, loaded, warning = load_importers_csv("/tmp/does-not-exist/importers.csv")

        self.assertFalse(loaded)
        self.assertIn("not found", warning)
        self.assertIn("eta_days", data.columns)


class CalculatorTests(unittest.TestCase):
    def test_normalize_planning_sku_removes_vintage_but_keeps_pack_size(self):
        self.assertEqual(
            normalize_planning_sku("Pavette Sauvignon Blanc 2025 12/750ml"),
            "pavette sauvignon blanc 12/750ml",
        )

    def test_btg_and_core_flags_drive_target_days(self):
        rb6 = pd.DataFrame(
            [
                {
                    "name": "BTG Wine 2025 12/750ml",
                    "available_inventory": 0,
                    "on_order": 0,
                    "fob": 10,
                    "pack_size": 12,
                    "is_btg": "Yes",
                    "is_core": "No",
                },
                {
                    "name": "Core Wine 2025 12/750ml",
                    "available_inventory": 0,
                    "on_order": 0,
                    "fob": 10,
                    "pack_size": 12,
                    "is_btg": "No",
                    "is_core": "Yes",
                },
                {
                    "name": "Standard Wine 2025 12/750ml",
                    "available_inventory": 0,
                    "on_order": 0,
                    "fob": 10,
                    "pack_size": 12,
                    "is_btg": "No",
                    "is_core": "No",
                },
            ]
        )
        sales = pd.DataFrame(
            [
                {"wine_name": "BTG Wine 2024 12/750ml", "quantity": 30, "date": "2026-04-01"},
                {"wine_name": "Core Wine 2024 12/750ml", "quantity": 30, "date": "2026-04-01"},
                {"wine_name": "Standard Wine 2024 12/750ml", "quantity": 30, "date": "2026-04-01"},
            ]
        )

        result = calculate_reorder_recommendations(rb6, sales).set_index("Name")

        self.assertEqual(result.loc["BTG Wine 2025 12/750ml", "target_days"], 45)
        self.assertEqual(result.loc["Core Wine 2025 12/750ml", "target_days"], 30)
        self.assertEqual(result.loc["Standard Wine 2025 12/750ml", "target_days"], 30)
        self.assertEqual(result.loc["BTG Wine 2025 12/750ml", "recommendation_status"], "rejected")
        self.assertEqual(result.loc["BTG Wine 2025 12/750ml", "approved_qty"], 0)

    def test_sales_windows_forecasts_and_velocity_trend_are_calculated(self):
        rb6 = pd.DataFrame(
            [
                {
                    "name": "Trend Wine 2025 12/750ml",
                    "available_inventory": 0,
                    "on_order": 0,
                    "fob": 10,
                    "pack_size": 12,
                }
            ]
        )
        sales = pd.DataFrame(
            [
                {"wine_name": "Trend Wine 2024 12/750ml", "quantity": 10, "date": "2026-04-01"},
                {"wine_name": "Trend Wine 2024 12/750ml", "quantity": 20, "date": "2026-03-10"},
                {"wine_name": "Trend Wine 2024 12/750ml", "quantity": 30, "date": "2026-02-01"},
                {"wine_name": "Trend Wine 2024 12/750ml", "quantity": 40, "date": "2025-05-15"},
            ]
        )

        result = calculate_reorder_recommendations(rb6, sales).iloc[0]

        self.assertEqual(result["last_30_day_sales"], 30)
        self.assertEqual(result["last_60_day_sales"], 60)
        self.assertEqual(result["last_90_day_sales"], 60)
        self.assertEqual(result["next_30_day_forecast"], 40)
        self.assertIn("velocity_trend_pct", result)
        self.assertIn(result["risk_level"], ["High", "Medium", "Low", "No Sales", "Unknown"])

    def test_pipeline_output_formatting_keeps_raw_numeric_values(self):
        recommendations = pd.DataFrame(
            [
                {
                    "planning_sku": "wine 12/750ml",
                    "Name": "Wine 2025 12/750ml",
                    "vintage": 2025.0,
                    "true_available": 1.0,
                    "weekly_velocity": 2.345,
                    "order_cost": 1234.5,
                    "recommended_qty_rounded": 12,
                }
            ]
        )

        raw_df = select_raw_output(recommendations)
        display_df = format_display_dataframe(raw_df)

        self.assertEqual(raw_df.loc[0, "order_cost"], 1234.5)
        self.assertEqual(display_df.loc[0, "order_cost"], "$1,234.50")
        self.assertEqual(display_df.loc[0, "vintage"], "2025")


class DashboardTests(unittest.TestCase):
    def test_dashboard_filters_and_po_export(self):
        df = recommendations_to_dataframe(
            [
                {
                    "supplier_name": "Supplier A",
                    "product_name": "Wine A",
                    "product_code": "A1",
                    "planning_sku": "wine a",
                    "reorder_status": "URGENT",
                    "recommendation_status": "rejected",
                    "approved_qty": 12,
                    "risk_level": "High",
                    "recommended_qty_rounded": 12,
                    "last_30_day_sales": 50,
                    "order_cost": 120.0,
                    "landed_cost": 132.0,
                    "pickup_location": "California",
                },
                {
                    "supplier_name": "Supplier B",
                    "product_name": "Wine B",
                    "product_code": "B1",
                    "planning_sku": "wine b",
                    "reorder_status": "OK",
                    "recommendation_status": "rejected",
                    "approved_qty": 0,
                    "risk_level": "Low",
                    "recommended_qty_rounded": 0,
                    "last_30_day_sales": 5,
                    "order_cost": 0.0,
                    "landed_cost": 0.0,
                    "pickup_location": "Washington",
                },
            ]
        )

        metrics = dashboard_metrics(df)
        filtered = filter_recommendations(df, supplier="Supplier A", statuses=["URGENT"])
        approved = filtered.copy()
        approved["recommendation_status"] = "approved"
        po_df = po_export_dataframe(approved)

        self.assertEqual(metrics.urgent_skus, 1)
        self.assertEqual(metrics.recommended_bottles, 12)
        self.assertEqual(len(filtered), 1)
        self.assertEqual(po_df.loc[0, "Quantity"], 12)

    def test_approval_editor_extracts_changed_rows(self):
        original = recommendations_to_dataframe(
            [
                {
                    "id": "rec-1",
                    "supplier_name": "Supplier A",
                    "product_name": "Wine A",
                    "product_code": "A1",
                    "reorder_status": "URGENT",
                    "risk_level": "High",
                    "recommended_qty_rounded": 12,
                    "recommendation_status": "rejected",
                    "approved_qty": 0,
                    "order_cost": 120,
                }
            ]
        )
        edited = approval_editor_dataframe(original)
        edited.loc[0, "Approval"] = "approved"
        edited.loc[0, "Approved Qty"] = 12

        updates = approval_updates_from_editor(original, edited)

        self.assertEqual(
            updates,
            [{"id": "rec-1", "recommendation_status": "approved", "approved_qty": 12}],
        )

    def test_approval_and_risk_metrics(self):
        df = recommendations_to_dataframe(
            [
                {
                    "supplier_name": "Supplier A",
                    "recommendation_status": "approved",
                    "approved_qty": 12,
                    "fob": 10,
                    "risk_level": "High",
                },
                {
                    "supplier_name": "Supplier A",
                    "recommendation_status": "edited",
                    "approved_qty": 6,
                    "fob": 8,
                    "risk_level": "Medium",
                },
                {
                    "supplier_name": "Supplier B",
                    "recommendation_status": "rejected",
                    "approved_qty": 0,
                    "fob": 9,
                    "risk_level": "Low",
                },
            ]
        )

        approvals = approval_metrics(df)
        risks = risk_counts(df)

        self.assertEqual(approvals.approved_lines, 2)
        self.assertEqual(approvals.approved_bottles, 18)
        self.assertEqual(approvals.approved_cost, 168)
        self.assertEqual(approvals.pending_lines, 1)
        self.assertEqual(risks, {"High": 1, "Medium": 1, "Low": 1})

    def test_location_and_truck_summaries(self):
        df = recommendations_to_dataframe(
            [
                {
                    "supplier_name": "Supplier A",
                    "product_name": "Wine A",
                    "recommended_qty_rounded": 120,
                    "landed_cost": 1400,
                    "pickup_location": "California",
                }
            ]
        )

        summary = location_summary(df)
        truck = california_truck_summary(df)

        self.assertEqual(summary.loc[0, "Pickup Location"], "California")
        self.assertEqual(summary.loc[0, "Recommended Qty"], 120)
        self.assertEqual(truck["bottles_needed"], 10080)


class SupabaseRepositoryTests(unittest.TestCase):
    def test_purchase_order_line_payload_uses_transitional_product_fields(self):
        repo = SupabaseRepository(client=None)

        payload = repo._purchase_order_line_payload(
            "draft-1",
            {
                "id": "recommendation-1",
                "product_name": "Wine A",
                "product_code": "A1",
                "planning_sku": "wine a",
                "recommended_qty_rounded": 12,
                "approved_qty": 6,
                "order_cost": 120.0,
                "fob": "10.0",
                "diagnostics": {"fob": 10.0},
            },
        )

        self.assertEqual(payload["purchase_order_draft_id"], "draft-1")
        self.assertEqual(payload["recommendation_id"], "recommendation-1")
        self.assertEqual(payload["product_name"], "Wine A")
        self.assertEqual(payload["planning_sku"], "wine a")
        self.assertEqual(payload["recommended_qty"], 12)
        self.assertEqual(payload["approved_qty"], 6)
        self.assertEqual(payload["fob"], 10.0)
        self.assertEqual(payload["line_cost"], 60.0)


class DailyEmailIngestTests(unittest.TestCase):
    def test_classify_attachments_uses_filename_keywords(self):
        rb6, rads = classify_attachments(
            [
                AttachmentCandidate("inventory_velocity.xlsx", b"rb6", None, "m1", None),
                AttachmentCandidate("vinosmith_rads.xlsx", b"rads", None, "m2", None),
            ]
        )

        self.assertEqual(rb6.filename, "inventory_velocity.xlsx")
        self.assertEqual(rads.filename, "vinosmith_rads.xlsx")

    def test_storage_path_sanitizes_filename(self):
        self.assertEqual(safe_filename("../Inventory:Velocity.xlsx"), "Inventory_Velocity.xlsx")
        self.assertEqual(
            storage_path(pd.Timestamp("2026-04-30").date(), "rb6_inventory", "../Inventory:Velocity.xlsx"),
            "vinosmith/2026-04-30/rb6_inventory/Inventory_Velocity.xlsx",
        )


if __name__ == "__main__":
    unittest.main()
