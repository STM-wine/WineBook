"""Bottle-level pricing engine for Supplier Catalog."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from math import ceil, isfinite


GP_WARNING_THRESHOLD = 0.28
FRONTLINE_TARGET_MARGIN = 0.32
BEST_TARGET_MARGIN = 0.30
VALID_SOLVE_FOR = {"price", "da", "gp"}


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


def _pack_size(value) -> int:
    try:
        parsed = float(value)
    except (TypeError, ValueError):
        raise ValueError("Pack size is required and must be a positive whole number.") from None
    if not isfinite(parsed) or parsed <= 0 or not parsed.is_integer():
        raise ValueError("Pack size is required and must be a positive whole number.")
    return int(parsed)


def normalize_fob_costs(
    *,
    pack_size: int | None,
    fob_bottle: float | None = None,
    fob_case: float | None = None,
    pricing_basis: str | None = None,
) -> tuple[int, float, float, str]:
    """Normalize exactly once from the declared or inferable source unit."""
    pack = _pack_size(pack_size)
    bottle = _money(fob_bottle)
    case = _money(fob_case)
    if bottle < 0 or case < 0:
        raise ValueError("FOB cost cannot be negative.")
    basis = (pricing_basis or "").strip().lower()
    if basis not in {"", "bottle", "case"}:
        raise ValueError("Pricing basis must be bottle or case.")
    if basis == "case" or (not basis and case > 0 and bottle <= 0):
        return pack, _money(case / pack), case, "case"
    if basis == "bottle" or (not basis and bottle > 0 and case <= 0):
        return pack, bottle, _money(bottle * pack), "bottle"
    if bottle > 0 and case > 0:
        if abs(case - bottle * pack) > 0.02:
            raise ValueError("Bottle and case FOB conflict; choose the source pricing basis.")
        return pack, bottle, _money(bottle * pack), "bottle"
    return pack, 0.0, 0.0, basis or "bottle"


def calculate_best_price(frontline_bottle_price: float) -> float | None:
    frontline = _money(frontline_bottle_price)
    if frontline >= 50:
        return None
    if 20 <= frontline < 50:
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


def _best_discount(frontline: float) -> float | None:
    if 0 < frontline < 20:
        return 1.0
    if 20 <= frontline < 50:
        return 2.0
    return None


def required_depletion_allowance_for_target_margin(
    *,
    bottle_price: float | None = None,
    landed_bottle_cost: float | None = None,
    target_gp_margin: float | None = None,
) -> float:
    price = _money(bottle_price)
    landed = _money(landed_bottle_cost)
    target = float(target_gp_margin or 0)
    if not isfinite(target) or target < 0 or target >= 1:
        raise ValueError("Target GP must be at least 0% and below 100%.")
    if price <= 0 or landed <= 0 or target <= 0:
        return 0.0
    return _money(max(0.0, landed - price * (1 - target)))


def required_bottle_price_for_target_margin(
    *,
    landed_bottle_cost: float | None = None,
    depletion_allowance: float | None = None,
    target_gp_margin: float | None = None,
) -> float:
    target = float(target_gp_margin or 0)
    if not isfinite(target) or target < 0 or target >= 1:
        raise ValueError("Target GP must be at least 0% and below 100%.")
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
    solve_for: str = "gp",
) -> dict:
    """Calculate only the field selected by an explicit solve mode."""
    mode = str(solve_for or "").strip().lower()
    if mode not in VALID_SOLVE_FOR:
        raise ValueError("Solve for must be Price, DA, or GP.")
    has_price = bottle_price is not None
    has_target = target_gp_margin is not None
    target = float(target_gp_margin or 0) if has_target else None
    if target is not None and (not isfinite(target) or target < 0 or target >= 1):
        raise ValueError("Target GP must be at least 0% and below 100%.")
    landed = _money(landed_bottle_cost)
    resolved_price = _money(bottle_price) if has_price else _money(fallback_bottle_price)
    resolved_da = _money(depletion_allowance)
    no_da_required = False

    if mode == "price":
        if target is None:
            raise ValueError("Target GP is required when solving for Price.")
        resolved_price = required_bottle_price_for_target_margin(
            landed_bottle_cost=landed,
            depletion_allowance=resolved_da,
            target_gp_margin=target,
        )
    elif mode == "da":
        if target is None or not has_price:
            raise ValueError("Target GP and selling price are required when solving for DA.")
        raw_da = landed - resolved_price * (1 - target)
        no_da_required = raw_da <= 0
        resolved_da = _money(max(0.0, raw_da))

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
        "calculated_field": mode,
        "solve_for": mode,
        "no_da_required": no_da_required,
        "da_exceeds_landed_cost": resolved_da > landed,
        "below_minimum_gp": resolved_price > 0 and calculated_gp < GP_WARNING_THRESHOLD,
    }


def calculate_pricing(
    *,
    pack_size: int | None = None,
    fob_bottle: float | None = None,
    fob_case: float | None = None,
    laid_in_per_bottle: float = 0.0,
    frontline_bottle_price: float | None = None,
    best_price: float | None = None,
    best_depletion_allowance: float | None = None,
    pricing_basis: str | None = None,
    grw_broker_model: bool = False,
) -> PricingResult:
    """Calculate bottle-level pricing while preserving editable outputs."""
    pack, bottle_fob, case_fob, resolved_basis = normalize_fob_costs(
        pack_size=pack_size,
        fob_bottle=fob_bottle,
        fob_case=fob_case,
        pricing_basis=pricing_basis,
    )
    laid_in = _money(laid_in_per_bottle)
    if laid_in < 0:
        raise ValueError("Laid-in cost cannot be negative.")

    landed = _money(bottle_fob + laid_in)
    unrounded_frontline = landed / (1 - FRONTLINE_TARGET_MARGIN) if landed else 0.0
    base_frontline = ceil(unrounded_frontline * 4) / 4 if 0 < unrounded_frontline < 20 else float(ceil(unrounded_frontline))
    existing_frontline = _money(frontline_bottle_price)
    existing_best = _money(best_price) if best_price is not None else None
    frontline = max(base_frontline, existing_frontline)

    # A retained Best controls the lower bound of its associated Frontline ladder.
    if existing_best is not None and frontline < 50:
        while frontline < 50:
            discount = _best_discount(frontline)
            if discount is None or frontline >= existing_best + discount:
                break
            frontline += 1

    resolved_best = existing_best if frontline >= 50 else max(calculate_best_price(frontline) or 0, existing_best or 0)
    if frontline >= 50 and existing_best is None:
        resolved_best = None
    if grw_broker_model:
        frontline = existing_frontline
        resolved_best = existing_best
    best_margin = calculate_gp_margin(
        bottle_price=resolved_best,
        landed_bottle_cost=landed,
        depletion_allowance=best_depletion_allowance,
    ) if resolved_best else None
    best_target_conflict = not grw_broker_model and best_margin is not None and best_margin < BEST_TARGET_MARGIN
    margin = round((frontline - landed) / frontline, 4) if frontline else 0.0

    warnings = []
    if not grw_broker_model and frontline and margin < GP_WARNING_THRESHOLD:
        warnings.append("Gross profit margin is below 28%.")
    if _money(best_depletion_allowance) > landed:
        warnings.append("Best depletion allowance exceeds landed cost.")
    if best_target_conflict:
        warnings.append("Best ladder price is below the 30% target GP.")

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
            "basis": resolved_basis,
            "frontline_target_margin": FRONTLINE_TARGET_MARGIN,
            "best_target_margin": BEST_TARGET_MARGIN,
            "gp_warning_threshold": GP_WARNING_THRESHOLD,
            "frontline_formula": "CEILING(landed_bottle_cost / 0.68)",
            "best_price_rule": "frontline >= 50 none; 20-49 minus 2; under 20 minus 1",
            "best_gp_margin": best_margin,
            "best_target_conflict": best_target_conflict,
            "informational_only": grw_broker_model,
            "warnings": warnings,
        },
    )
