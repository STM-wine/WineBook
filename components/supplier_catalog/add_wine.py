"""Add Wine workflow view."""

import streamlit as st

from models.supplier_available_wine import AVAILABILITY_STATUSES, CONVERSION_STATUSES
from services.pricing_engine import calculate_pricing
from services.supplier_catalog_service import (
    build_available_wine,
    default_laid_in_for_supplier,
    importer_options,
)


def render_add_wine(importers_data, wines: list[dict], price_events: list[dict]) -> None:
    suppliers = importer_options(importers_data)
    if not suppliers:
        st.warning("Supplier list is unavailable. Add importers.csv to use supplier defaults.")
        suppliers = ["Manual Supplier"]

    supplier_name = st.selectbox("Supplier / importer", suppliers, key="catalog_add_supplier")
    default_laid_in = default_laid_in_for_supplier(importers_data, supplier_name)

    identity_cols = st.columns([1.4, 1.8, 0.7, 0.7, 0.8])
    producer = identity_cols[0].text_input("Producer", key="catalog_add_producer")
    wine_name = identity_cols[1].text_input("Wine / fantasy name", key="catalog_add_wine_name")
    vintage = identity_cols[2].text_input("Vintage", value="NV", key="catalog_add_vintage")
    pack_size = identity_cols[3].number_input("Pack", min_value=1, value=12, step=1, key="catalog_add_pack")
    bottle_size = identity_cols[4].text_input("Bottle size", value="750ml", key="catalog_add_bottle_size")

    price_cols = st.columns(5)
    fob_bottle = price_cols[0].number_input("Bottle FOB", min_value=0.0, step=0.5, format="%.2f", key="catalog_add_fob_bottle")
    fob_case = price_cols[1].number_input("Case FOB", min_value=0.0, step=1.0, format="%.2f", key="catalog_add_fob_case")
    laid_in = price_cols[2].number_input(
        "Laid-in / bottle",
        min_value=0.0,
        value=float(default_laid_in),
        step=0.25,
        format="%.2f",
        key=f"catalog_add_laid_in_{supplier_name}",
    )
    frontline_override = price_cols[3].number_input("Frontline override", min_value=0.0, step=1.0, format="%.2f")
    best_price_override = price_cols[4].number_input("Best price override", min_value=0.0, step=1.0, format="%.2f")

    state_cols = st.columns([1, 1, 2])
    availability_status = state_cols[0].selectbox("Availability", AVAILABILITY_STATUSES)
    conversion_status = state_cols[1].selectbox("Match state", CONVERSION_STATUSES, index=4)
    price_change_reason = state_cols[2].text_input("Price change reason", value="Manual catalog update")

    pricing = calculate_pricing(
        pack_size=pack_size,
        fob_bottle=fob_bottle,
        fob_case=fob_case,
        laid_in_per_bottle=laid_in,
        frontline_bottle_price=frontline_override if frontline_override else None,
        best_price=best_price_override if best_price_override else None,
    )

    metric_cols = st.columns(4)
    metric_cols[0].metric("Landed Bottle", f"${pricing.landed_bottle_cost:,.2f}")
    metric_cols[1].metric("Frontline", f"${pricing.frontline_bottle_price:,.2f}")
    metric_cols[2].metric("Best Price", "Frontline only" if pricing.best_price is None else f"${pricing.best_price:,.2f}")
    metric_cols[3].metric("GP Margin", f"{pricing.gross_profit_margin:.1%}")
    for warning in pricing.warnings:
        st.warning(warning)

    payload = {
        "supplier_name": supplier_name,
        "producer": producer,
        "wine_name": wine_name,
        "vintage": vintage,
        "pack_size": pack_size,
        "bottle_size": bottle_size,
        "pricing_basis": "bottle" if fob_bottle else "case",
        "fob_bottle": fob_bottle,
        "fob_case": fob_case,
        "laid_in_per_bottle": laid_in,
        "frontline_bottle_price": frontline_override if frontline_override else None,
        "best_price": best_price_override if best_price_override else None,
        "availability_status": availability_status,
        "conversion_status": conversion_status,
        "price_change_reason": price_change_reason,
    }
    preview_wine, _ = build_available_wine(payload)
    st.caption(f"QuickBooks item name preview: {preview_wine.display_name}")
    st.caption(f"Planning SKU: {preview_wine.planning_sku}")

    existing = next((wine for wine in wines if wine.get("planning_sku") == preview_wine.planning_sku), None)
    if existing:
        st.info("Existing planning SKU found. Saving will treat this as a manual update and create a price-change event when FOB or frontline changes.")

    if st.button("Save Supplier Wine", type="primary"):
        if not producer or not wine_name:
            st.error("Producer and wine name are required.")
            return
        wine, event = build_available_wine(payload, previous=existing)
        if existing:
            wines.remove(existing)
        wines.append(wine.to_dict())
        if event:
            price_events.append(event)
        st.success("Supplier wine saved.")
        st.rerun()

