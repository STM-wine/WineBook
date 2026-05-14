"""Upcoming Price Changes view."""

import pandas as pd
import streamlit as st

from services.price_change_service import price_change_summary


PRICE_CHANGE_COLUMNS = [
    "supplier",
    "wine",
    "vintage",
    "old_fob",
    "new_fob",
    "old_frontline",
    "new_frontline",
    "old_best_price",
    "new_best_price",
    "margin_before",
    "margin_after",
    "effective_date",
    "reason",
    "status",
    "fob_increase",
]


def render_upcoming_price_changes(price_events: list[dict]) -> None:
    if not price_events:
        st.info("No price changes have been captured yet.")
        return

    df = pd.DataFrame(price_events)
    visible = [col for col in PRICE_CHANGE_COLUMNS if col in df.columns]
    st.dataframe(df[visible], use_container_width=True, hide_index=True, height=430)

    increases = [event for event in price_events if event.get("fob_increase")]
    if increases:
        st.warning(f"{len(increases):,} price change(s) are caused by FOB increases.")

    st.subheader("Email-Friendly Summary")
    summary = "\n".join(price_change_summary(event) for event in price_events)
    st.text_area("Summary", value=summary, height=160)
    st.download_button(
        "Download Price Change CSV",
        data=df[visible].to_csv(index=False),
        file_name="supplier_catalog_price_changes.csv",
        mime="text/csv",
    )

