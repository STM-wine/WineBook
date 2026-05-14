"""Supplier Catalog available wine model.

Supplier Available Wine is intentionally separate from Stem active products and
requested wines. A supplier wine may never become a Stem product.
"""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any


AVAILABILITY_STATUSES = ["available", "limited", "sold_out", "unknown"]
CONVERSION_STATUSES = [
    "exact_existing_product",
    "new_vintage",
    "new_format",
    "possible_match_needs_review",
    "net_new_product",
]


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


@dataclass
class SupplierAvailableWine:
    supplier_name: str = ""
    wine_name: str = ""
    producer: str = ""
    vintage: str = "NV"
    pack_size: int = 12
    bottle_size: str = "750ml"
    pricing_basis: str = "bottle"
    fob_bottle: float = 0.0
    fob_case: float = 0.0
    laid_in_per_bottle: float = 0.0
    landed_bottle_cost: float = 0.0
    frontline_bottle_price: float = 0.0
    best_price: float | None = None
    gross_profit_margin: float = 0.0
    availability_status: str = "available"
    conversion_status: str = "net_new_product"
    planning_sku: str = ""
    display_name: str = ""
    diagnostics: dict[str, Any] = field(default_factory=dict)
    created_at: str = field(default_factory=utc_now_iso)
    updated_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)
