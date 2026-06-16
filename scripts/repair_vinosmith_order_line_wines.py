"""Hydrate missing Vinosmith wine identities from rescued order-line raw data."""

from __future__ import annotations

import argparse
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.report_vinosmith_rescue_status import fetch_all
from stem_order.supabase_repository import SupabaseRepository, load_dotenv


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--dry-run", action="store_true", help="Report missing wines without writing them.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    repo = SupabaseRepository.from_env()

    print("Fetching rescued Vinosmith wine identities...", file=sys.stderr, flush=True)
    wines = fetch_all(repo, "vinosmith_wines", "wine_id", order_by="wine_id")
    existing_wine_ids = {str(row["wine_id"]) for row in wines if row.get("wine_id")}

    print("Fetching rescued Vinosmith order-line raw data...", file=sys.stderr, flush=True)
    lines = fetch_all(
        repo,
        "vinosmith_order_lines",
        "line_item_id,wine_id,wine_code,wine_name,vintage,raw_data",
        order_by="line_item_id",
    )
    missing_wines = missing_order_line_wines(lines, existing_wine_ids)
    print(
        f"Missing order-line wine identities: {len(missing_wines):,} "
        f"from {len(lines):,} order lines",
        flush=True,
    )
    for wine in missing_wines[:10]:
        print(f"  {wine.get('id')}: {wine.get('name')}")

    if args.dry_run or not missing_wines:
        print("Supabase writes: disabled" if args.dry_run else "No repair writes needed.")
        return 0

    print("Writing missing Vinosmith wine identities...", file=sys.stderr, flush=True)
    saved = repo.upsert_vinosmith_wines(missing_wines, raw_response_id=None)
    print(f"Supabase writes: upserted {len(saved):,} Vinosmith wine identities")
    return 0


def missing_order_line_wines(
    lines: list[dict[str, Any]],
    existing_wine_ids: set[str],
) -> list[dict[str, Any]]:
    missing: dict[str, dict[str, Any]] = {}
    for line in lines:
        wine_id = str(line.get("wine_id") or "").strip()
        if not wine_id or wine_id in existing_wine_ids or wine_id in missing:
            continue
        raw_data = line.get("raw_data") if isinstance(line.get("raw_data"), dict) else {}
        wine = raw_data.get("wine") if isinstance(raw_data.get("wine"), dict) else {}
        if str(wine.get("id") or "").strip() == wine_id:
            missing[wine_id] = wine
            continue
        missing[wine_id] = {
            "id": wine_id,
            "code": line.get("wine_code"),
            "name": line.get("wine_name"),
            "vintage": line.get("vintage"),
        }
    return list(missing.values())


if __name__ == "__main__":
    raise SystemExit(main())
