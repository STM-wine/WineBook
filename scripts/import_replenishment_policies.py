"""Reconcile and optionally import wine-name replenishment policies.

The Vinosmith wines endpoint defines the active import universe. Exact normalized
wine-name matches use the workbook policy; unmatched active wines default to
Limited. Dry-run is the default. Use --apply only after the policy migration is
present in the target Supabase project.
"""

from __future__ import annotations

import argparse
from collections import Counter, defaultdict
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import sys
import unicodedata
from typing import Any

import pandas as pd
import requests

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.supabase_repository import load_dotenv
from stem_order.vinosmith_api import VinosmithDistributorClient, records_for_resource


POLICIES = {"Core", "Select", "Limited Core", "Limited", "Allocated", "Special Order"}
POLICY_PRECEDENCE = {"Core": 5, "Limited Core": 4, "Limited": 3, "Special Order": 2, "Allocated": 1}
REST_PAGE_SIZE = 1000
WRITE_BATCH_SIZE = 200


def normalized_name(value: object) -> str:
    text = unicodedata.normalize("NFKC", str(value or ""))
    text = text.replace("’", "'").replace("‘", "'").replace("“", '"').replace("”", '"')
    return re.sub(r"\s+", " ", text).strip().casefold()


def display_family_name(name: object, vintage: object = None) -> str:
    text = re.sub(
        r"\s+\d+(?:\.\d+)?\s*/\s*\d+(?:\.\d+)?\s*(?:ml|l)\s*$",
        "",
        str(name or ""),
        flags=re.I,
    ).strip()
    vintage_text = str(vintage or "").strip()
    if vintage_text:
        text = re.sub(rf"\s+{re.escape(vintage_text)}\s*$", "", text, flags=re.I).strip()
    else:
        text = re.sub(r"\s+(?:(?:19|20)\d{2}|N\.?V\.?)\s*$", "", text, flags=re.I).strip()
    return re.sub(r"\s+", " ", text).strip()


def normalized_family_name(name: object, vintage: object = None) -> str:
    return normalized_name(display_family_name(name, vintage))


def normalized_item_code(value: object) -> str:
    return str(value or "").strip().upper()


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("workbook", type=Path)
    parser.add_argument("--sheet", default="Sheet2")
    parser.add_argument("--audit-output", type=Path)
    parser.add_argument("--apply", action="store_true", help="Write reconciled policies to Supabase.")
    return parser.parse_args()


def supabase_headers(*, write: bool = False) -> dict[str, str]:
    key = os.getenv("SUPABASE_SERVICE_ROLE_KEY", "").strip()
    if not key:
        raise RuntimeError("SUPABASE_SERVICE_ROLE_KEY is required.")
    headers = {"apikey": key, "Accept": "application/json"}
    if write:
        headers.update({
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates,return=representation",
        })
    return headers


def supabase_url(table: str) -> str:
    base = os.getenv("SUPABASE_URL", "").strip().rstrip("/")
    if not base:
        raise RuntimeError("SUPABASE_URL is required.")
    return f"{base}/rest/v1/{table}"


def supabase_get_all(table: str, select: str) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for start in range(0, 100_000, REST_PAGE_SIZE):
        response = requests.get(
            supabase_url(table),
            headers={**supabase_headers(), "Range": f"{start}-{start + REST_PAGE_SIZE - 1}"},
            params={"select": select, "order": "item_code.asc"},
            timeout=60,
        )
        if response.status_code not in {200, 206}:
            raise RuntimeError(f"Supabase {table} read failed ({response.status_code}): {response.text[:500]}")
        page = response.json()
        rows.extend(page)
        if len(page) < REST_PAGE_SIZE:
            return rows
    raise RuntimeError(f"Supabase {table} read exceeded 100,000 rows.")


def upsert_policy_rows(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    saved: list[dict[str, Any]] = []
    for start in range(0, len(rows), WRITE_BATCH_SIZE):
        batch = rows[start : start + WRITE_BATCH_SIZE]
        response = requests.post(
            supabase_url("ordering_item_markers"),
            headers=supabase_headers(write=True),
            params={"on_conflict": "item_code"},
            json=batch,
            timeout=60,
        )
        if response.status_code not in {200, 201}:
            raise RuntimeError(f"Supabase policy upsert failed ({response.status_code}): {response.text[:1000]}")
        saved.extend(response.json())
    return saved


def read_policy_workbook(path: Path, sheet: str) -> pd.DataFrame:
    frame = pd.read_excel(path, sheet_name=sheet)
    frame.columns = [str(column).strip() for column in frame.columns]
    required = {"Name", "Tag"}
    if not required.issubset(frame.columns):
        raise ValueError(f"Workbook must contain columns: {', '.join(sorted(required))}")
    frame["Name"] = frame["Name"].map(lambda value: str(value or "").strip())
    frame["Tag"] = frame["Tag"].map(lambda value: str(value or "").strip())
    invalid = frame.loc[~frame["Tag"].isin(POLICIES), ["Name", "Tag"]]
    if not invalid.empty:
        raise ValueError(f"Workbook contains invalid policies: {invalid.to_dict(orient='records')[:10]}")
    # The database keeps the original value for compatibility; Select is its user-facing name.
    frame["Tag"] = frame["Tag"].replace({"Select": "Limited Core"})
    duplicate_names = frame.assign(_key=frame["Name"].map(normalized_name)).groupby("_key").filter(lambda group: len(group) > 1)
    if not duplicate_names.empty:
        raise ValueError(f"Workbook contains duplicate wine names: {duplicate_names[['Name', 'Tag']].to_dict(orient='records')[:10]}")
    return frame


def family_default(rows: list[dict[str, Any]]) -> str:
    policies = {row["replenishment_policy"] for row in rows}
    if "Core" in policies:
        return "Core"
    newest_year = max((int(row["vintage"]) for row in rows if str(row.get("vintage") or "").isdigit()), default=None)
    candidates = [row for row in rows if newest_year is None or str(row.get("vintage") or "") == str(newest_year)]
    return max((row["replenishment_policy"] for row in candidates), key=POLICY_PRECEDENCE.get)


def build_import(frame: pd.DataFrame, live_wines: list[dict[str, Any]]) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    sheet_by_name = {
        normalized_name(row["Name"]): {"row": int(index) + 2, "name": row["Name"], "policy": row["Tag"]}
        for index, row in frame.iterrows()
    }
    active_name_keys = {normalized_name(wine.get("name")) for wine in live_wines}
    sheet_unmatched = [
        {"row": int(index) + 2, "name": row["Name"], "policy": row["Tag"]}
        for index, row in frame.iterrows()
        if normalized_name(row["Name"]) not in active_name_keys
    ]

    import_rows: list[dict[str, Any]] = []
    for wine in live_wines:
        code = normalized_item_code(wine.get("code"))
        name = str(wine.get("name") or "").strip()
        if not code or not name:
            continue
        matched = sheet_by_name.get(normalized_name(name))
        policy = matched["policy"] if matched else "Limited"
        family_name = display_family_name(name, wine.get("vintage"))
        import_rows.append({
            "item_code": code,
            "wine_id": str(wine.get("id") or ""),
            "wine_name": name,
            "vintage": wine.get("vintage"),
            "replenishment_policy": policy,
            "policy_family_key": normalized_family_name(name, wine.get("vintage")),
            "policy_family_name": family_name,
            "match_source": "initial_upload" if matched else "system",
            "sheet_row": matched["row"] if matched else None,
        })

    family_rows: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for row in import_rows:
        family_rows[row["policy_family_key"]].append(row)
    defaults = {key: family_default(rows) for key, rows in family_rows.items()}
    payload = [
        {
            "item_code": row["item_code"],
            "is_btg": False,
            "is_core": row["replenishment_policy"] == "Core",
            "replenishment_policy": row["replenishment_policy"],
            "policy_family_key": row["policy_family_key"],
            "policy_family_name": row["policy_family_name"],
            "family_default_policy": defaults[row["policy_family_key"]],
            "recommendations_suppressed": False,
            "suppression_reason": None,
            "suppressed_until": None,
            "marker_note": "Initial 365-day sales policy import" if row["match_source"] == "initial_upload" else "Defaulted active Vinosmith wine to Limited",
            "note_source": row["match_source"],
        }
        for row in import_rows
    ]
    audit = {
        "active_vinosmith_wines": len(live_wines),
        "importable_active_wines": len(import_rows),
        "skipped_active_wines_without_code_or_name": len(live_wines) - len(import_rows),
        "sheet_rows": len(frame),
        "exact_active_matches": sum(row["match_source"] == "initial_upload" for row in import_rows),
        "active_wines_defaulted_to_limited": sum(row["match_source"] == "system" for row in import_rows),
        "sheet_rows_not_in_active_vinosmith": len(sheet_unmatched),
        "policy_counts": dict(Counter(row["replenishment_policy"] for row in import_rows)),
        "family_default_counts": dict(Counter(defaults.values())),
        "family_count": len(family_rows),
        "planned_rows": payload,
        "sheet_unmatched": sheet_unmatched,
    }
    return payload, audit


def main() -> int:
    args = parse_args()
    load_dotenv(ROOT / ".env.local", override=True)
    frame = read_policy_workbook(args.workbook, args.sheet)
    result = VinosmithDistributorClient(os.getenv("VINOSMITH_API_TOKEN", "")).fetch_resource("wines")
    if not result.ok:
        raise RuntimeError(f"Vinosmith wines request failed: {result.status or result.error}")
    live_wines = [
        wine for wine in records_for_resource("wines", result.json_payload())
        if wine.get("active") is True or wine.get("orderable") is True
    ]
    payload, audit = build_import(frame, live_wines)
    audit.update({
        "mode": "apply" if args.apply else "dry-run",
        "workbook": str(args.workbook),
        "generated_at": datetime.now(timezone.utc).isoformat(),
    })

    if args.apply:
        previous = supabase_get_all(
            "ordering_item_markers",
            "item_code,is_btg,is_core,replenishment_policy,policy_family_key,policy_family_name,family_default_policy,recommendations_suppressed,suppression_reason,suppressed_until,marker_note,note_source,updated_at",
        )
        audit["previous_marker_rows"] = previous
        saved = upsert_policy_rows(payload)
        audit["saved_rows"] = len(saved)
        audit["saved_policy_counts"] = dict(Counter(row.get("replenishment_policy") for row in saved))
        audit["saved_item_codes"] = [row.get("item_code") for row in saved]
        if len(saved) != len(payload):
            raise RuntimeError(f"Expected {len(payload)} saved rows, received {len(saved)}.")

    summary_keys = {
        "mode", "workbook", "active_vinosmith_wines", "importable_active_wines",
        "skipped_active_wines_without_code_or_name", "sheet_rows", "exact_active_matches",
        "active_wines_defaulted_to_limited", "sheet_rows_not_in_active_vinosmith",
        "policy_counts", "family_default_counts", "family_count", "saved_rows", "saved_policy_counts",
    }
    print(json.dumps({key: value for key, value in audit.items() if key in summary_keys}, indent=2))
    if args.audit_output:
        args.audit_output.parent.mkdir(parents=True, exist_ok=True)
        args.audit_output.write_text(json.dumps(audit, indent=2), encoding="utf-8")
        print(f"Audit written to {args.audit_output}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
