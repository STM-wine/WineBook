"""Pending Product Creation view."""

import pandas as pd
import streamlit as st


def render_pending_product_creation(wines: list[dict], requests: list[dict]) -> None:
    pending_wines = [
        wine for wine in wines
        if wine.get("conversion_status") in {"new_vintage", "new_format", "possible_match_needs_review", "net_new_product"}
    ]
    approved_new_product_requests = [
        request for request in requests
        if request.get("approval_decision") == "approve_as_new_stem_product"
    ]
    rows = pending_wines + approved_new_product_requests
    if not rows:
        st.info("No wines are pending Stem product creation yet.")
        return
    st.dataframe(pd.DataFrame(rows), use_container_width=True, hide_index=True, height=520)

