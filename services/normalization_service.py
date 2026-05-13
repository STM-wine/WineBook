"""Deterministic wine name normalization for Supplier Catalog.

This module is the shared normalization foundation. Future supplier-specific
adapters should call these helpers rather than inventing separate name logic.
"""

from __future__ import annotations

import re


PACK_RE = re.compile(r"^\s*(\d+)\s*[/xX]\s*([0-9.]+)\s*(ml|mL|ML|l|L)\s*$")


def normalize_spaces(value: str) -> str:
    return " ".join(str(value or "").strip().split())


def normalize_vintage(vintage) -> str:
    value = normalize_spaces(str(vintage or ""))
    if not value or value.lower() in {"nan", "none", "nv", "n/v"}:
        return "NV"
    return value


def normalize_pack_format(pack_size=12, bottle_size="750ml") -> str:
    raw = normalize_spaces(f"{pack_size}/{bottle_size}")
    direct_match = PACK_RE.match(raw)
    if direct_match:
        count, size, unit = direct_match.groups()
        normalized_unit = "ml" if unit.lower() == "ml" else "L"
        return f"{int(float(count))}/{size}{normalized_unit}"

    size_text = normalize_spaces(str(bottle_size or "750ml")).replace(" ", "")
    size_match = re.match(r"^([0-9.]+)(ml|mL|ML|l|L)$", size_text)
    if size_match:
        size, unit = size_match.groups()
        normalized_unit = "ml" if unit.lower() == "ml" else "L"
        return f"{int(float(pack_size or 12))}/{size}{normalized_unit}"
    return f"{int(float(pack_size or 12))}/750ml"


def normalize_champagne_prefix(producer: str, wine_name: str) -> tuple[str, str]:
    producer_clean = normalize_spaces(producer)
    wine_clean = normalize_spaces(wine_name)
    combined = f"{producer_clean} {wine_clean}".strip().lower()
    if "champagne" not in combined:
        return producer_clean, wine_clean

    producer_clean = re.sub(r"^champagne\s+", "", producer_clean, flags=re.IGNORECASE).strip()
    wine_clean = re.sub(r"^champagne\s+", "", wine_clean, flags=re.IGNORECASE).strip()
    return "Champagne " + producer_clean if producer_clean else "Champagne", wine_clean


def build_display_name(
    *,
    producer: str,
    wine_name: str,
    vintage,
    pack_size=12,
    bottle_size="750ml",
) -> str:
    producer_clean, wine_clean = normalize_champagne_prefix(producer, wine_name)
    parts = [
        producer_clean,
        wine_clean,
        normalize_vintage(vintage),
        normalize_pack_format(pack_size, bottle_size),
    ]
    return normalize_spaces(" ".join(part for part in parts if part))


def build_planning_sku(
    display_name: str,
    *,
    remove_vintage: bool = False,
) -> str:
    value = normalize_spaces(display_name).lower()
    if remove_vintage:
        value = re.sub(r"\b(19|20)\d{2}\b", " ", value)
    value = value.replace("/", " / ")
    value = re.sub(r"[^\w\s/.]", " ", value)
    value = normalize_spaces(value)
    value = value.replace(" / ", "/")
    return value


def normalize_wine_identity(
    *,
    producer: str,
    wine_name: str,
    vintage,
    pack_size=12,
    bottle_size="750ml",
) -> dict:
    display_name = build_display_name(
        producer=producer,
        wine_name=wine_name,
        vintage=vintage,
        pack_size=pack_size,
        bottle_size=bottle_size,
    )
    return {
        "display_name": display_name,
        "planning_sku": build_planning_sku(display_name),
        "planning_sku_without_vintage": build_planning_sku(display_name, remove_vintage=True),
        "normalized_vintage": normalize_vintage(vintage),
        "pack_format": normalize_pack_format(pack_size, bottle_size),
    }

