"""Supplier logistics management view."""

import pandas as pd
import streamlit as st


DISPLAY_COLUMNS = [
    "id",
    "name",
    "importer_id",
    "eta_days",
    "pick_up_location",
    "freight_forwarder",
    "order_frequency",
    "trucking_cost_per_bottle",
    "notes",
    "active",
]


def _rows_to_editor(rows: list[dict], fallback_data: pd.DataFrame) -> pd.DataFrame:
    if rows:
        df = pd.DataFrame(rows)
    else:
        df = fallback_data.rename(columns={"importer_name": "name"}).copy()
        if "active" not in df:
            df["active"] = True

    for column in DISPLAY_COLUMNS:
        if column not in df:
            df[column] = None
    df = df[DISPLAY_COLUMNS].copy()
    df["eta_days"] = pd.to_numeric(df["eta_days"], errors="coerce").fillna(0).astype(int)
    df["trucking_cost_per_bottle"] = pd.to_numeric(
        df["trucking_cost_per_bottle"], errors="coerce"
    ).fillna(0.0)
    df["active"] = df["active"].fillna(True).astype(bool)
    return df.sort_values("name", key=lambda series: series.fillna("").astype(str).str.lower()).reset_index(drop=True)


def _editor_to_payloads(editor: pd.DataFrame) -> list[dict]:
    def clean_number(value, default=0):
        parsed = pd.to_numeric(value, errors="coerce")
        return default if pd.isna(parsed) else parsed

    payloads = []
    for row in editor.to_dict(orient="records"):
        name = str(row.get("name") or "").strip()
        if not name:
            continue
        payloads.append(
            {
                "id": row.get("id") or None,
                "name": name,
                "importer_id": str(row.get("importer_id") or "").strip() or None,
                "eta_days": int(clean_number(row.get("eta_days"), 0)),
                "pick_up_location": str(row.get("pick_up_location") or "").strip() or None,
                "freight_forwarder": str(row.get("freight_forwarder") or "").strip() or None,
                "order_frequency": str(row.get("order_frequency") or "").strip() or None,
                "trucking_cost_per_bottle": float(clean_number(row.get("trucking_cost_per_bottle"), 0.0)),
                "notes": str(row.get("notes") or "").strip() or None,
                "active": bool(row.get("active", True)),
            }
        )
    return payloads


def render_supplier_logistics(repo, fallback_data: pd.DataFrame, source_label: str) -> None:
    st.caption(
        "Manage supplier/importer logistics used by Order Review, freight rollups, Supplier Hub defaults, and PO landed-cost math."
    )
    if repo is None:
        st.warning("Supabase is not connected, so supplier logistics are read-only from importers.csv.")
        st.dataframe(fallback_data, use_container_width=True, hide_index=True)
        return

    try:
        rows = repo.get_supplier_logistics(include_inactive=True)
    except Exception as exc:
        st.warning(f"Could not load Supabase supplier logistics. Current fallback source: {source_label}. Error: {exc}")
        st.dataframe(fallback_data, use_container_width=True, hide_index=True)
        return

    editor = _rows_to_editor(rows, fallback_data)
    edited = st.data_editor(
        editor,
        use_container_width=True,
        hide_index=True,
        num_rows="dynamic",
        key="supplier_logistics_editor",
        column_config={
            "id": None,
            "name": st.column_config.TextColumn("Supplier", required=True),
            "importer_id": st.column_config.TextColumn("Importer ID"),
            "eta_days": st.column_config.NumberColumn("ETA Days", min_value=0, step=1, format="%d"),
            "pick_up_location": st.column_config.TextColumn("Pickup Location"),
            "freight_forwarder": st.column_config.TextColumn("Freight Forwarder"),
            "order_frequency": st.column_config.TextColumn("Order Frequency"),
            "trucking_cost_per_bottle": st.column_config.NumberColumn(
                "Laid In / Bottle",
                min_value=0.0,
                step=0.01,
                format="$%.4f",
                help="Per-bottle freight/laid-in cost used in landed cost and PO exports.",
            ),
            "notes": st.column_config.TextColumn("Notes"),
            "active": st.column_config.CheckboxColumn("Active"),
        },
    )

    col_save, col_seed, col_meta = st.columns([1.1, 1.4, 4])
    if col_save.button("Save Supplier Logistics", type="primary"):
        payloads = _editor_to_payloads(edited)
        try:
            repo.upsert_supplier_logistics(payloads)
            st.success(f"Saved {len(payloads):,} supplier logistics record(s).")
            st.rerun()
        except Exception as exc:
            st.error(f"Could not save supplier logistics: {exc}")

    if col_seed.button("Load From importers.csv", disabled=fallback_data.empty):
        payloads = _editor_to_payloads(_rows_to_editor([], fallback_data))
        try:
            repo.upsert_supplier_logistics(payloads)
            st.success(f"Loaded {len(payloads):,} supplier records from importers.csv.")
            st.rerun()
        except Exception as exc:
            st.error(f"Could not load importers.csv into Supabase: {exc}")

    col_meta.caption(f"Current app source: {source_label}. Mark inactive records instead of deleting them.")
