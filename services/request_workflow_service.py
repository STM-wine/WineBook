"""Lightweight request and approval workflow for Supplier Catalog."""

from __future__ import annotations

from uuid import uuid4

from models.wine_request import APPROVER_NAMES, PLACEMENT_TYPES, WineRequest


def is_approver(user_name: str) -> bool:
    return str(user_name or "").strip().lower() in APPROVER_NAMES


def create_request(payload: dict) -> WineRequest:
    placement_type = payload.get("placement_type", "")
    notes = str(payload.get("notes", "") or "").strip()
    if placement_type not in PLACEMENT_TYPES:
        raise ValueError("Select a valid placement type.")
    if placement_type == "Other" and not notes:
        raise ValueError("Notes are required when placement type is Other.")

    quantity = int(payload.get("requested_quantity") or 0)
    if quantity <= 0:
        raise ValueError("Requested quantity must be greater than zero.")

    return WineRequest(
        request_id=payload.get("request_id") or f"REQ-{uuid4().hex[:8].upper()}",
        account_customer=str(payload.get("account_customer", "")).strip(),
        requested_quantity=quantity,
        needed_by_date=str(payload.get("needed_by_date", "")),
        placement_type=placement_type,
        source_type=payload.get("source_type", "supplier_available_wine"),
        wine_display_name=payload.get("wine_display_name", ""),
        supplier_name=payload.get("supplier_name", ""),
        requester_name=payload.get("requester_name", ""),
        notes=notes,
    )


def approve_request(
    request: WineRequest | dict,
    *,
    approver_name: str,
    decision: str,
) -> WineRequest:
    if not is_approver(approver_name):
        raise PermissionError("Only Mark, Ryan, or John can approve Supplier Catalog requests in the MVP.")

    request_obj = request if isinstance(request, WineRequest) else WineRequest(**request)
    valid_decisions = {
        "approve": "approved",
        "reject": "rejected",
        "hold": "on_hold",
        "approve_as_special_order": "approved",
        "approve_as_new_stem_product": "approved",
    }
    if decision not in valid_decisions:
        raise ValueError("Unknown approval decision.")

    request_obj.request_status = valid_decisions[decision]
    request_obj.approval_decision = decision
    request_obj.approver_name = approver_name
    if request_obj.request_status == "approved":
        request_obj.fulfillment_status = "waiting_for_next_order"
        request_obj.ordering_workflow_payload = build_ordering_workflow_payload(request_obj)
    return request_obj


def build_ordering_workflow_payload(request: WineRequest) -> dict:
    return {
        "request_id": request.request_id,
        "supplier_name": request.supplier_name,
        "wine_display_name": request.wine_display_name,
        "requested_quantity": request.requested_quantity,
        "needed_by_date": request.needed_by_date,
        "fulfillment_status": request.fulfillment_status,
        "source": "supplier_catalog_request",
    }

