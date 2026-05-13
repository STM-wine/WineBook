"""Price change tracking foundations for Supplier Catalog."""

from __future__ import annotations

from datetime import date

from models.price_change_event import PriceChangeEvent


def detect_price_change(
    previous: dict | None,
    current: dict,
    *,
    effective_date: str | None = None,
    reason: str = "",
) -> PriceChangeEvent | None:
    if not previous:
        return None

    old_fob = float(previous.get("fob_bottle") or 0)
    new_fob = float(current.get("fob_bottle") or 0)
    old_frontline = float(previous.get("frontline_bottle_price") or 0)
    new_frontline = float(current.get("frontline_bottle_price") or 0)

    if old_fob == new_fob and old_frontline == new_frontline:
        return None

    return PriceChangeEvent(
        supplier=current.get("supplier_name", ""),
        wine=current.get("display_name") or current.get("wine_name", ""),
        vintage=str(current.get("vintage") or "NV"),
        old_fob=old_fob,
        new_fob=new_fob,
        old_frontline=old_frontline,
        new_frontline=new_frontline,
        old_best_price=previous.get("best_price"),
        new_best_price=current.get("best_price"),
        margin_before=float(previous.get("gross_profit_margin") or 0),
        margin_after=float(current.get("gross_profit_margin") or 0),
        effective_date=effective_date or date.today().isoformat(),
        reason=reason,
        fob_increase=new_fob > old_fob,
    )


def price_change_summary(event: PriceChangeEvent | dict) -> str:
    data = event.to_dict() if hasattr(event, "to_dict") else dict(event)
    direction = "FOB increase" if data.get("fob_increase") else "price change"
    return (
        f"{data.get('supplier', '')}: {data.get('wine', '')} "
        f"{data.get('old_fob', 0):.2f} -> {data.get('new_fob', 0):.2f}; "
        f"frontline {data.get('old_frontline', 0):.2f} -> {data.get('new_frontline', 0):.2f} "
        f"({direction}, effective {data.get('effective_date', '')})."
    )

