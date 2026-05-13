"""Mock/local Supplier Catalog service.

This is intentionally repository-shaped without committing to a Supabase schema.
Streamlit stores the returned dictionaries in session state for the MVP.
"""

from __future__ import annotations

import pandas as pd

from models.supplier_available_wine import SupplierAvailableWine
from services.normalization_service import normalize_wine_identity
from services.price_change_service import detect_price_change
from services.pricing_engine import calculate_pricing


def importer_options(importers_data: pd.DataFrame) -> list[str]:
    if importers_data is None or importers_data.empty or "importer_name" not in importers_data:
        return []
    return sorted(importers_data["importer_name"].dropna().astype(str).unique())


def default_laid_in_for_supplier(importers_data: pd.DataFrame, supplier_name: str) -> float:
    if importers_data is None or importers_data.empty:
        return 0.0
    supplier = str(supplier_name or "").strip().lower()
    if "importer_name_clean" in importers_data:
        matches = importers_data[importers_data["importer_name_clean"] == " ".join(supplier.split())]
    else:
        matches = importers_data[importers_data.get("importer_name", "").astype(str).str.lower() == supplier]
    if matches.empty or "laid_in_per_bottle" not in matches:
        return 0.0
    return float(pd.to_numeric(matches.iloc[0]["laid_in_per_bottle"], errors="coerce") or 0)


def build_available_wine(payload: dict, previous: dict | None = None) -> tuple[SupplierAvailableWine, dict | None]:
    identity = normalize_wine_identity(
        producer=payload.get("producer", ""),
        wine_name=payload.get("wine_name", ""),
        vintage=payload.get("vintage") or "NV",
        pack_size=payload.get("pack_size") or 12,
        bottle_size=payload.get("bottle_size") or "750ml",
    )
    pricing = calculate_pricing(
        pack_size=payload.get("pack_size") or 12,
        fob_bottle=payload.get("fob_bottle"),
        fob_case=payload.get("fob_case"),
        laid_in_per_bottle=payload.get("laid_in_per_bottle") or 0,
        frontline_bottle_price=payload.get("frontline_bottle_price"),
        best_price=payload.get("best_price") if payload.get("best_price") not in ("", None) else None,
    )
    wine = SupplierAvailableWine(
        supplier_name=payload.get("supplier_name", ""),
        wine_name=payload.get("wine_name", ""),
        producer=payload.get("producer", ""),
        vintage=identity["normalized_vintage"],
        pack_size=pricing.pack_size,
        bottle_size=payload.get("bottle_size", "750ml"),
        pricing_basis=payload.get("pricing_basis", "bottle"),
        fob_bottle=pricing.fob_bottle,
        fob_case=pricing.fob_case,
        laid_in_per_bottle=pricing.laid_in_per_bottle,
        landed_bottle_cost=pricing.landed_bottle_cost,
        frontline_bottle_price=pricing.frontline_bottle_price,
        best_price=pricing.best_price,
        gross_profit_margin=pricing.gross_profit_margin,
        availability_status=payload.get("availability_status", "available"),
        conversion_status=payload.get("conversion_status", "net_new_product"),
        planning_sku=identity["planning_sku"],
        display_name=identity["display_name"],
        diagnostics=pricing.diagnostics,
    )
    event = detect_price_change(previous, wine.to_dict(), reason=payload.get("price_change_reason", "Manual catalog update"))
    return wine, event.to_dict() if event else None


def search_wines(wines: list[dict], *, supplier="All", wine_name="", producer="", vintage="") -> list[dict]:
    filtered = wines
    if supplier and supplier != "All":
        filtered = [wine for wine in filtered if wine.get("supplier_name") == supplier]
    for field, needle in [("display_name", wine_name), ("producer", producer), ("vintage", vintage)]:
        query = str(needle or "").strip().lower()
        if query:
            filtered = [wine for wine in filtered if query in str(wine.get(field, "")).lower()]
    return filtered

