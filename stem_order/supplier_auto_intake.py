"""Conservative matches for suppliers present in both QuickBooks and Vinosmith."""

from __future__ import annotations

from collections import defaultdict
import re
from typing import Any


def supplier_name_key(value: Any) -> str:
    return " ".join(re.findall(r"[a-z0-9]+", str(value or "").casefold()))


def plan_supplier_intake(
    quickbooks_vendors: list[dict[str, Any]],
    vinosmith_importers: list[dict[str, Any]],
    vinosmith_producers: list[dict[str, Any]],
    suppliers: list[dict[str, Any]],
    vendor_mappings: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """Return exact source matches and candidates that need manual review.

    A matching producer or importer alone is enough to prove Vinosmith setup;
    wines do not need to exist yet. Existing Stem names and QB vendor aliases
    take priority, and similar names are held for review to avoid duplicates.
    """
    vendors_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    importers_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    producers_by_name: dict[str, list[dict[str, Any]]] = defaultdict(list)
    suppliers_by_alias: dict[str, list[dict[str, Any]]] = defaultdict(list)
    mappings_by_vendor = {
        str(row.get("quickbooks_vendor_list_id")): row for row in vendor_mappings
    }

    for vendor in quickbooks_vendors:
        name = supplier_name_key(vendor.get("name") or vendor.get("full_name"))
        if name and vendor.get("is_active") is True:
            vendors_by_name[name].append(vendor)
    for importer in vinosmith_importers:
        name = supplier_name_key(importer.get("name"))
        if name and importer.get("active") is True:
            importers_by_name[name].append(importer)
    for producer in vinosmith_producers:
        name = supplier_name_key(producer.get("name"))
        if name and producer.get("active") is True:
            producers_by_name[name].append(producer)
    for supplier in suppliers:
        for field in ("name", "qb_vendor_name"):
            alias = supplier_name_key(supplier.get(field))
            if alias and supplier not in suppliers_by_alias[alias]:
                suppliers_by_alias[alias].append(supplier)

    matches: list[dict[str, Any]] = []
    review: list[dict[str, Any]] = []
    for key, vendors in sorted(vendors_by_name.items()):
        importers = importers_by_name[key]
        producers = producers_by_name[key]
        if not importers and not producers:
            continue
        if len(vendors) != 1 or len(importers) > 1 or len(producers) > 1:
            review.append({"name": key, "reason": "ambiguous_source_name"})
            continue
        vendor = vendors[0]
        name = str(vendor.get("name") or vendor.get("full_name") or "").strip()
        existing = suppliers_by_alias[key]
        if len(existing) > 1:
            review.append({"name": name, "reason": "multiple_stem_suppliers"})
            continue
        supplier = existing[0] if existing else None
        if supplier and supplier.get("qb_vendor_name") and supplier_name_key(supplier["qb_vendor_name"]) != key:
            review.append({"name": name, "reason": "supplier_has_different_qb_vendor"})
            continue
        if supplier is None and _similar_supplier_exists(key, suppliers):
            review.append({"name": name, "reason": "similar_stem_supplier"})
            continue
        mapping = mappings_by_vendor.get(str(vendor.get("list_id")))
        if mapping and mapping.get("supplier_id") and mapping["supplier_id"] != (supplier or {}).get("id"):
            review.append({"name": name, "reason": "vendor_already_mapped"})
            continue
        if mapping and mapping.get("vendor_classification") not in (None, "unclassified", "inventory_wine"):
            review.append({"name": name, "reason": "vendor_has_other_classification"})
            continue
        importer = importers[0] if importers else None
        producer = producers[0] if producers else None
        matches.append({
            "name": name,
            "quickbooks_vendor_list_id": str(vendor["list_id"]),
            "supplier_id": (supplier or {}).get("id"),
            "importer_id": str(importer["id"]) if importer else None,
            "importer_name": importer.get("name") if importer else None,
            "producer_id": str(producer["representation_producer_id"]) if producer else None,
            "existing_importer_id": (supplier or {}).get("importer_id"),
            "existing_importer_winery_name": (supplier or {}).get("importer_winery_name"),
            "existing_qb_vendor_name": (supplier or {}).get("qb_vendor_name"),
            "mapping_supplier_id": (mapping or {}).get("supplier_id"),
            "mapping_classification": (mapping or {}).get("vendor_classification"),
        })
    return matches, review


def _similar_supplier_exists(key: str, suppliers: list[dict[str, Any]]) -> bool:
    words = key.split()
    first = words[0] if words else ""
    for supplier in suppliers:
        candidate = supplier_name_key(supplier.get("name"))
        other = candidate.split()
        if not other:
            continue
        if candidate.startswith(key + " ") or key.startswith(candidate + " "):
            return True
        if len(first) >= 4 and first == other[0]:
            return True
    return False
