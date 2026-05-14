"""Requests workflow view."""

import pandas as pd
import streamlit as st

from models.wine_request import PLACEMENT_TYPES
from services.request_workflow_service import approve_request, create_request, is_approver


def render_requests(wines: list[dict], requests: list[dict]) -> None:
    st.subheader("Create Request")
    wine_options = ["Net new wine"] + [wine.get("display_name", "") for wine in wines if wine.get("display_name")]
    form_cols = st.columns([2, 1, 1, 1.2])
    wine_display_name = form_cols[0].selectbox("Wine", wine_options)
    account_customer = form_cols[1].text_input("Account / customer")
    requested_quantity = form_cols[2].number_input("Qty", min_value=1, value=12, step=1)
    needed_by_date = form_cols[3].date_input("Needed by")

    placement_cols = st.columns([1, 2, 1])
    placement_type = placement_cols[0].selectbox("Placement", PLACEMENT_TYPES)
    notes = placement_cols[1].text_input("Notes / comments")
    requester_name = placement_cols[2].text_input("Requester")

    if st.button("Submit Request", type="primary"):
        try:
            selected_wine = next((wine for wine in wines if wine.get("display_name") == wine_display_name), {})
            request = create_request(
                {
                    "account_customer": account_customer,
                    "requested_quantity": requested_quantity,
                    "needed_by_date": needed_by_date.isoformat(),
                    "placement_type": placement_type,
                    "source_type": "net_new_wine" if wine_display_name == "Net new wine" else "supplier_available_wine",
                    "wine_display_name": wine_display_name,
                    "supplier_name": selected_wine.get("supplier_name", ""),
                    "requester_name": requester_name,
                    "notes": notes,
                }
            )
            requests.append(request.to_dict())
            st.success("Request submitted for review.")
            st.rerun()
        except Exception as exc:
            st.error(str(exc))

    st.subheader("Request Queue")
    if not requests:
        st.info("No requests have been submitted yet.")
        return

    df = pd.DataFrame(requests)
    st.dataframe(
        df[
            [
                "request_id",
                "wine_display_name",
                "supplier_name",
                "account_customer",
                "requested_quantity",
                "needed_by_date",
                "placement_type",
                "request_status",
                "fulfillment_status",
            ]
        ],
        use_container_width=True,
        hide_index=True,
        height=280,
    )

    ordering_payloads = [
        request.get("ordering_workflow_payload")
        for request in requests
        if request.get("request_status") == "approved" and request.get("ordering_workflow_payload")
    ]
    if ordering_payloads:
        st.subheader("Importer Ordering Queue")
        st.dataframe(
            pd.DataFrame(ordering_payloads),
            use_container_width=True,
            hide_index=True,
            height=180,
        )

    st.subheader("Approvals")
    approval_cols = st.columns([1.2, 1, 1])
    request_ids = [request["request_id"] for request in requests]
    selected_request_id = approval_cols[0].selectbox("Request", request_ids)
    approver_name = approval_cols[1].text_input("Approver")
    decision = approval_cols[2].selectbox(
        "Decision",
        ["approve", "reject", "hold", "approve_as_special_order", "approve_as_new_stem_product"],
    )
    if not is_approver(approver_name) and approver_name:
        st.caption("MVP approvers: Mark, Ryan, John.")

    if st.button("Apply Decision"):
        selected = next(request for request in requests if request["request_id"] == selected_request_id)
        try:
            updated = approve_request(selected, approver_name=approver_name, decision=decision)
            requests[requests.index(selected)] = updated.to_dict()
            st.success("Request workflow updated.")
            st.rerun()
        except Exception as exc:
            st.error(str(exc))
