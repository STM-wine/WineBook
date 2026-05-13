"""Foundational price change event model."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field

from models.supplier_available_wine import utc_now_iso


PRICE_CHANGE_STATUSES = ["draft", "pending_review", "approved", "communicated", "live"]


@dataclass
class PriceChangeEvent:
    supplier: str
    wine: str
    vintage: str
    old_fob: float
    new_fob: float
    old_frontline: float
    new_frontline: float
    old_best_price: float | None
    new_best_price: float | None
    margin_before: float
    margin_after: float
    effective_date: str
    reason: str = ""
    status: str = "draft"
    fob_increase: bool = False
    created_at: str = field(default_factory=utc_now_iso)

    def to_dict(self) -> dict:
        return asdict(self)
