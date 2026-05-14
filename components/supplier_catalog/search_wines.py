"""Search Wines view."""

import pandas as pd
import streamlit as st

from services.supplier_catalog_service import search_wines, supplier_filter_options


SEARCH_COLUMNS = [
    "supplier_name",
    "display_name",
    "producer",
    "vintage",
    "fob_bottle",
    "landed_bottle_cost",
    "frontline_bottle_price",
    "best_price",
    "gross_profit_margin",
    "availability_status",
    "conversion_status",
]


def render_search_wines(importers_data, wines: list[dict]) -> None:
    filter_cols = st.columns([2, 2.5, 2, 1])
    suppliers = supplier_filter_options(importers_data, wines)
    supplier = filter_cols[0].selectbox("Supplier", suppliers, key="catalog_search_supplier")
    wine_name = filter_cols[1].text_input("Wine name", key="catalog_search_wine_name")
    producer = filter_cols[2].text_input("Producer", key="catalog_search_producer")
    vintage = filter_cols[3].text_input("Vintage", key="catalog_search_vintage")

    rows = search_wines(
        wines,
        supplier=supplier,
        wine_name=wine_name,
        producer=producer,
        vintage=vintage,
    )
    df = pd.DataFrame(rows)
    if df.empty:
        st.info("No supplier wines match the current filters yet.")
        return

    visible = [col for col in SEARCH_COLUMNS if col in df.columns]
    display = df[visible].rename(
        columns={
            "supplier_name": "Supplier",
            "display_name": "Wine",
            "fob_bottle": "FOB Bottle",
            "landed_bottle_cost": "Landed Bottle",
            "frontline_bottle_price": "Frontline",
            "best_price": "Best Price",
            "gross_profit_margin": "GP Margin",
            "availability_status": "Availability",
            "conversion_status": "Conversion",
        }
    )
    if "GP Margin" in display:
        display["GP Margin"] = display["GP Margin"].apply(lambda x: f"{float(x or 0):.1%}")
    st.dataframe(display, use_container_width=True, hide_index=True, height=520)
