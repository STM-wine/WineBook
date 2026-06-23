"""Bottle-level pricing engine for Supplier Catalog."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import ceil


GP_WARNING_THRESHOLD = 0.28


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


def calculate_gp_margin(
    *,
    bottle_price: float | None = None,
    landed_bottle_cost: float | None = None,
    depletion_allowance: float | None = None,
) -> float:
    price = _money(bottle_price)
    if price <= 0:
        return 0.0
    landed = _money(landed_bottle_cost)
    da = _money(depletion_allowance)
    net_cost = max(0.0, landed - da)
    return round((price - net_cost) / price, 4)


def required_depletion_allowance_for_target_margin(
    *,
    bottle_price: float | None = None,
    landed_bottle_cost: float | None = None,
    target_gp_margin: float | None = None,
) -> float:
    price = _money(bottle_price)
    landed = _money(landed_bottle_cost)
    target = max(0.0, min(0.99, float(target_gp_margin or 0)))
    if price <= 0 or landed <= 0 or target <= 0:
        return 0.0
    return _money(max(0.0, landed - price * (1 - target)))


def required_bottle_price_for_target_margin(
    *,
    landed_bottle_cost: float | None = None,
    depletion_allowance: float | None = None,
    target_gp_margin: float | None = None,
) -> float:
    target = max(0.0, min(0.99, float(target_gp_margin or 0)))
    net_cost = max(0.0, _money(landed_bottle_cost) - _money(depletion_allowance))
    if net_cost <= 0 or target <= 0:
        return 0.0
    return _money(net_cost / (1 - target))


def balance_price_level(
    *,
    bottle_price: float | None = None,
    depletion_allowance: float | None = None,
    target_gp_margin: float | None = None,
    landed_bottle_cost: float | None = None,
    fallback_bottle_price: float | None = None,
) -> dict:
    """Balance GP, DA, and bottle price using GP > DA > price precedence."""
    has_price = bottle_price is not None
    has_da = depletion_allowance is not None
    has_target = target_gp_margin is not None
    target = max(0.0, min(0.99, float(target_gp_margin or 0))) if has_target else None
    landed = _money(landed_bottle_cost)
    resolved_price = _money(bottle_price) if has_price else _money(fallback_bottle_price)
    resolved_da = _money(depletion_allowance) if has_da else 0.0
    calculated_field = "gp"

    if target is not None and has_da:
        resolved_price = required_bottle_price_for_target_margin(
            landed_bottle_cost=landed,
            depletion_allowance=resolved_da,
            target_gp_margin=target,
        )
        calculated_field = "frontline"
    elif target is not None and has_price:
        resolved_da = required_depletion_allowance_for_target_margin(
            bottle_price=resolved_price,
            landed_bottle_cost=landed,
            target_gp_margin=target,
        )
        calculated_field = "da"
    elif not has_price and resolved_price > 0:
        calculated_field = "fallback"

    calculated_gp = calculate_gp_margin(
        bottle_price=resolved_price,
        landed_bottle_cost=landed,
        depletion_allowance=resolved_da,
    )

    return {
        "bottle_price": resolved_price,
        "depletion_allowance": resolved_da,
        "target_gp_margin": target,
        "calculated_gp_margin": calculated_gp,
        "calculated_field": calculated_field,
        "below_minimum_gp": resolved_price > 0 and calculated_gp < GP_WARNING_THRESHOLD,
    }


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
        warnings.append("Gross profit margin is below 28%.")

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
