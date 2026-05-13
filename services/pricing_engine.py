"""Bottle-level pricing engine for Supplier Catalog."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import ceil


GP_WARNING_THRESHOLD = 0.27


@dataclass(frozen=True)
class PricingResult:
    pack_size: int
    fob_bottle: float
    fob_case: float
    laid_in_per_bottle: float
    landed_bottle_cost: float
    frontline_bottle_price: float
    best_price: float | None
    gross_profit_margin: float
    warnings: list[str]
    diagnostics: dict

    def to_dict(self) -> dict:
        return asdict(self)


def _money(value) -> float:
    try:
        return round(float(value or 0), 2)
    except (TypeError, ValueError):
        return 0.0


def calculate_best_price(frontline_bottle_price: float) -> float | None:
    frontline = _money(frontline_bottle_price)
    if frontline > 50:
        return None
    if 20 <= frontline <= 49:
        return _money(frontline - 2)
    if frontline < 20 and frontline > 0:
        return _money(frontline - 1)
    return None


def calculate_pricing(
    *,
    pack_size: int = 12,
    fob_bottle: float | None = None,
    fob_case: float | None = None,
    laid_in_per_bottle: float = 0.0,
    frontline_bottle_price: float | None = None,
    best_price: float | None = None,
) -> PricingResult:
    """Calculate bottle-level pricing while preserving editable outputs."""
    pack = max(int(pack_size or 12), 1)
    bottle_fob = _money(fob_bottle)
    case_fob = _money(fob_case)
    laid_in = _money(laid_in_per_bottle)

    if bottle_fob <= 0 and case_fob > 0:
        bottle_fob = _money(case_fob / pack)
    if case_fob <= 0 and bottle_fob > 0:
        case_fob = _money(bottle_fob * pack)

    landed = _money(bottle_fob + laid_in)
    frontline = _money(frontline_bottle_price) if frontline_bottle_price else float(ceil(landed / 0.68)) if landed else 0.0
    resolved_best = _money(best_price) if best_price is not None else calculate_best_price(frontline)
    margin = round((frontline - landed) / frontline, 4) if frontline else 0.0

    warnings = []
    if frontline and margin < GP_WARNING_THRESHOLD:
        warnings.append("Gross profit margin is below 27%.")

    return PricingResult(
        pack_size=pack,
        fob_bottle=bottle_fob,
        fob_case=case_fob,
        laid_in_per_bottle=laid_in,
        landed_bottle_cost=landed,
        frontline_bottle_price=frontline,
        best_price=resolved_best,
        gross_profit_margin=margin,
        warnings=warnings,
        diagnostics={
            "basis": "bottle",
            "gp_warning_threshold": GP_WARNING_THRESHOLD,
            "frontline_formula": "CEILING(landed_bottle_cost / 0.68)",
            "best_price_rule": "frontline >= 50 none; 20-49 minus 2; under 20 minus 1",
            "warnings": warnings,
        },
    )
