"""Add suppliers when an active QB vendor exactly matches Vinosmith source setup."""

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import sys
from typing import Any
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.supplier_auto_intake import plan_supplier_intake
from stem_order.supabase_repository import load_dotenv
from stem_order.vinosmith_api import VinosmithDistributorClient


class SourceDatabase:
    def __init__(self) -> None:
        self.base_url = os.environ["SUPABASE_URL"].rstrip("/") + "/rest/v1/"
        key = os.environ["SUPABASE_SERVICE_ROLE_KEY"]
        self.headers = {
            "apikey": key,
            "Authorization": f"Bearer {key}",
            "Content-Type": "application/json",
        }

    def request(self, path: str, method: str = "GET", body: Any = None) -> list[dict[str, Any]]:
        headers = dict(self.headers)
        if method != "GET":
            headers["Prefer"] = "return=representation"
        request = Request(
            self.base_url + path,
            method=method,
            headers=headers,
            data=json.dumps(body).encode() if body is not None else None,
        )
        with urlopen(request, timeout=30) as response:
            payload = response.read()
        return json.loads(payload) if payload else []

    def read_all(self, table: str, columns: str, order: str) -> list[dict[str, Any]]:
        rows: list[dict[str, Any]] = []
        for start in range(0, 100_000, 500):
            query = urlencode({"select": columns, "order": f"{order}.asc", "limit": 500, "offset": start})
            batch = self.request(f"{table}?{query}")
            rows.extend(batch)
            if len(batch) < 500:
                return rows
        raise RuntimeError(f"{table} exceeded the reconciliation read limit")


def fetch_vinosmith_directory(client: VinosmithDistributorClient, resource: str) -> list[dict[str, Any]]:
    result = client.fetch_endpoint(resource=resource, endpoint=f"/{resource}")
    if not result.ok:
        raise RuntimeError(f"Vinosmith {resource} directory failed: {result.error or result.status}")
    data = result.json_payload().get("data")
    records = data.get(resource) if isinstance(data, dict) else data
    if not isinstance(records, list):
        raise RuntimeError(f"Vinosmith {resource} directory returned no records")
    return records


def apply_match(db: SourceDatabase, match: dict[str, Any]) -> str:
    supplier_id = match["supplier_id"]
    if supplier_id:
        updates: dict[str, Any] = {}
        if not match["existing_importer_id"] and match["importer_id"]:
            updates["importer_id"] = match["importer_id"]
        if updates:
            db.request(f"suppliers?id=eq.{supplier_id}", "PATCH", updates)
    else:
        payload = {
            "name": match["name"],
            "qb_vendor_name": match["name"],
            "importer_id": match["importer_id"],
            "importer_winery_name": match["importer_name"],
            "active": True,
        }
        supplier_id = db.request("suppliers?select=id", "POST", payload)[0]["id"]
    vendor_id = match["quickbooks_vendor_list_id"]
    if match["mapping_classification"] is None:
        db.request("quickbooks_vendor_mappings", "POST", {
            "quickbooks_vendor_list_id": vendor_id,
            "supplier_id": supplier_id,
            "vendor_classification": "inventory_wine",
            "notes": "Exact active QuickBooks vendor and Vinosmith producer/importer name match.",
        })
    elif not match["mapping_supplier_id"] or match["mapping_classification"] == "unclassified":
        db.request(f"quickbooks_vendor_mappings?quickbooks_vendor_list_id=eq.{vendor_id}", "PATCH", {
            "supplier_id": supplier_id,
            "vendor_classification": "inventory_wine",
        })
    return supplier_id


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--apply", action="store_true", help="Write exact matches; default is preview only")
    args = parser.parse_args()
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local", override=True)
    db = SourceDatabase()
    client = VinosmithDistributorClient(token=os.environ["VINOSMITH_API_TOKEN"])
    importers = fetch_vinosmith_directory(client, "importers")
    producers = fetch_vinosmith_directory(client, "producers")
    vendors = db.read_all("quickbooks_vendors", "list_id,name,full_name,is_active", "list_id")
    suppliers = db.read_all("suppliers", "id,name,qb_vendor_name,importer_id,importer_winery_name", "id")
    mappings = db.read_all("quickbooks_vendor_mappings", "quickbooks_vendor_list_id,supplier_id,vendor_classification", "quickbooks_vendor_list_id")
    matches, review = plan_supplier_intake(vendors, importers, producers, suppliers, mappings)
    created = 0
    if args.apply:
        for match in matches:
            apply_match(db, match)
            created += not bool(match["supplier_id"])
    print(json.dumps({
        "applied": args.apply,
        "exact_matches": len(matches),
        "new_suppliers": sum(not bool(match["supplier_id"]) for match in matches),
        "new_names": [match["name"] for match in matches if not match["supplier_id"]],
        "created": created,
        "review_count": len(review),
        "review": review,
    }))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
