"""Supplier Hub module shell."""

import streamlit as st

from components.supplier_catalog.add_wine import render_add_wine
from components.supplier_catalog.pending_product_creation import render_pending_product_creation
from components.supplier_catalog.requests import render_requests
from components.supplier_catalog.search_wines import render_search_wines
from components.supplier_catalog.upcoming_price_changes import render_upcoming_price_changes


def _state_list(key: str) -> list[dict]:
    if key not in st.session_state:
        st.session_state[key] = []
    return st.session_state[key]


def render_supplier_catalog(importers_data) -> None:
    wines = _state_list("supplier_catalog_wines")
    requests = _state_list("supplier_catalog_requests")
    price_events = _state_list("supplier_catalog_price_events")

    st.markdown(
        """
        <div class="stem-hero">
            <div>
                <h2>Supplier Hub</h2>
                <p>Manual supplier wine catalog foundation for searchable availability, pricing, requests, and price changes.</p>
            </div>
            <div class="run-badge">
                <strong>MVP</strong>
                <span>Manual entry only</span>
            </div>
        </div>
        """,
        unsafe_allow_html=True,
    )

    metric_cols = st.columns(4)
    metric_cols[0].metric("Supplier Wines", f"{len(wines):,}")
    metric_cols[1].metric("Requests", f"{len(requests):,}")
    metric_cols[2].metric("Pending Products", f"{sum(1 for wine in wines if wine.get('conversion_status') != 'exact_existing_product'):,}")
    metric_cols[3].metric("Price Changes", f"{len(price_events):,}")

    tab_search, tab_add, tab_requests, tab_pending, tab_prices = st.tabs(
        [
            "Search Wines",
            "Add Wine",
            "Requests",
            "Pending Product Creation",
            "Upcoming Price Changes",
        ]
    )
    with tab_search:
        render_search_wines(wines)
    with tab_add:
        render_add_wine(importers_data, wines, price_events)
    with tab_requests:
        render_requests(wines, requests)
    with tab_pending:
        render_pending_product_creation(wines, requests)
    with tab_prices:
        render_upcoming_price_changes(price_events)
