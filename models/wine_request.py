"""Wine request model and lightweight workflow constants."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from typing import Any

from models.supplier_available_wine import utc_now_iso


PLACEMENT_TYPES = ["BTG", "List", "Shelf", "Club", "Special Order", "Other"]
REQUEST_STATUSES = ["pending_review", "approved", "rejected", "on_hold"]
FULFILLMENT_STATUSES = [
    "waiting_for_next_order",
    "added_to_po",
    "ordered",
    "received",
    "cancelled",
]
APPROVER_NAMES = {"mark", "ryan", "john"}


@dataclass
class WineRequest:
    request_id: str
    account_customer: str
    requested_quantity: int
    needed_by_date: str
    placement_type: str
    source_type: str = "supplier_available_wine"
    wine_display_name: str = ""
    supplier_name: str = ""
    requester_name: str = ""
    notes: str = ""
    request_status: str = "pending_review"
    fulfillment_status: str = "waiting_for_next_order"
    approval_decision: str = ""
    approver_name: str = ""
    ordering_workflow_payload: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
