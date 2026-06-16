"""Validate rescued Vinosmith data coverage in Supabase.

This read-only helper is meant to survive Render Shell resets: it reconstructs
the current rescue state from sync metadata and normalized cache tables, then
prints the link/vintage/cache coverage issues that matter before Stem relies on
the rescued data as an operational source of truth.
"""

from __future__ import annotations

import argparse
from collections import Counter
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
import json
from pathlib import Path
import re
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.report_vinosmith_rescue_status import fetch_all, fetch_lines_for_order_ids, format_cents
from stem_order.supabase_repository import SupabaseRepository, load_dotenv


RESOURCE_NAMES = (
    "accounts",
    "account_details",
    "users",
    "wines",
    "prices",
    "inventory",
    "wine_prearrivals",
    "supplier_orders",
)


@dataclass
class LinkCoverage:
    total: int
    linked: int
    missing: int
    blank: int

    @property
    def linked_percent(self) -> float:
        return round((self.linked / self.total) * 100, 2) if self.total else 0.0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-date", default="2023-01-01", help="Inclusive supplier-order delivery lower bound.")
    parser.add_argument(
        "--end-date",
        default=date.today().isoformat(),
        help="Inclusive supplier-order delivery upper bound. Defaults to today.",
    )
    parser.add_argument("--sample-size", type=int, default=10, help="Number of sample IDs/names to include per issue.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    start_date = date.fromisoformat(args.start_date)
    end_date = date.fromisoformat(args.end_date)
    if end_date < start_date:
        raise SystemExit("--end-date must be on or after --start-date.")

    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    repo = SupabaseRepository.from_env()

    print("Fetching Vinosmith sync metadata...", file=sys.stderr, flush=True)
    checkpoints = fetch_all(
        repo,
        "source_sync_checkpoints",
        "resource_name,checkpoint_key,status,requested_start_date,requested_end_date,last_synced_at,cursor_data,diagnostics",
        filters=[("eq", "source_system", "vinosmith")],
        order_by="resource_name",
    )
    responses = fetch_all(
        repo,
        "source_api_responses",
        "endpoint,request_identifier,requested_params,response_status,record_count,fetched_at,source_sync_run_id",
        filters=[("eq", "source_system", "vinosmith")],
        order_by="fetched_at",
        desc=True,
        limit=100,
    )
    recent_runs = fetch_all(
        repo,
        "source_sync_runs",
        "id,sync_type,status,requested_start_date,requested_end_date,started_at,completed_at,error_message,parameters",
        filters=[("eq", "source_system", "vinosmith")],
        order_by="started_at",
        desc=True,
        limit=20,
    )

    print("Fetching normalized Vinosmith cache rows...", file=sys.stderr, flush=True)
    wines = fetch_all(
        repo,
        "vinosmith_wines",
        "wine_id,code,name,vintage,active,orderable,inventory_item,unit_set,fob_price,last_seen_at",
        order_by="wine_id",
    )
    accounts = fetch_all(repo, "vinosmith_accounts", "account_id,name,status,last_seen_at", order_by="account_id")
    contacts = fetch_all(
        repo,
        "vinosmith_account_contacts",
        "contact_id,account_id,full_name,email,buyer,primary_contact,last_seen_at",
        order_by="account_id",
    )
    account_sales_reps = fetch_all(
        repo,
        "vinosmith_account_sales_reps",
        "account_id,user_id,full_name,email,last_seen_at",
        order_by="account_id",
    )
    users = fetch_all(repo, "vinosmith_users", "user_id,full_name,email,active,role,last_seen_at", order_by="user_id")
    prices = fetch_all(repo, "vinosmith_prices", "price_id,wine_id,price_cents,active,disabled,last_seen_at", order_by="price_id")
    prearrivals = fetch_all(
        repo,
        "vinosmith_prearrivals",
        "prearrival_key,wine_id,wine_code,wine_name,quantity,expected_date,last_seen_at",
        order_by="expected_date",
    )
    latest_inventory = fetch_latest_inventory_snapshot(repo)

    print("Fetching rescued Vinosmith orders for validation window...", file=sys.stderr, flush=True)
    orders = fetch_all(
        repo,
        "vinosmith_order_headers",
        "supplier_order_id,account_id,user_id,delivery_at,total_cents",
        filters=[
            ("gte", "delivery_at", f"{start_date.isoformat()}T00:00:00+00:00"),
            ("lte", "delivery_at", f"{end_date.isoformat()}T23:59:59+00:00"),
        ],
        order_by="delivery_at",
    )
    lines = fetch_lines_for_order_ids(
        repo,
        [order.get("supplier_order_id") for order in orders],
        "line_item_id,supplier_order_id,wine_id,wine_name,vintage,quantity_bottles,total_cents",
    )

    report = build_quality_report(
        start_date=start_date,
        end_date=end_date,
        checkpoints=checkpoints,
        responses=responses,
        recent_runs=recent_runs,
        wines=wines,
        accounts=accounts,
        contacts=contacts,
        account_sales_reps=account_sales_reps,
        users=users,
        prices=prices,
        prearrivals=prearrivals,
        inventory_rows=latest_inventory["rows"],
        inventory_snapshot_date=latest_inventory["snapshot_date"],
        orders=orders,
        lines=lines,
        sample_size=args.sample_size,
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_report(report)
    return 0


def fetch_latest_inventory_snapshot(repo: SupabaseRepository) -> dict[str, Any]:
    latest = fetch_all(
        repo,
        "vinosmith_inventory_snapshots",
        "snapshot_date",
        order_by="snapshot_date",
        desc=True,
        limit=1,
    )
    snapshot_date = latest[0]["snapshot_date"] if latest else None
    if not snapshot_date:
        return {"snapshot_date": None, "rows": []}
    rows = fetch_all(
        repo,
        "vinosmith_inventory_snapshots",
        "id,wine_id,warehouse_id,available,on_hand,on_order,on_future,on_pending_sync,snapshot_date",
        filters=[("eq", "snapshot_date", snapshot_date)],
        order_by="wine_id",
    )
    return {"snapshot_date": snapshot_date, "rows": rows}


def build_quality_report(
    start_date: date,
    end_date: date,
    checkpoints: list[dict[str, Any]],
    responses: list[dict[str, Any]],
    recent_runs: list[dict[str, Any]],
    wines: list[dict[str, Any]],
    accounts: list[dict[str, Any]],
    contacts: list[dict[str, Any]],
    account_sales_reps: list[dict[str, Any]],
    users: list[dict[str, Any]],
    prices: list[dict[str, Any]],
    prearrivals: list[dict[str, Any]],
    inventory_rows: list[dict[str, Any]],
    inventory_snapshot_date: str | None,
    orders: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    sample_size: int = 10,
) -> dict[str, Any]:
    wine_ids = {str(row["wine_id"]) for row in wines if row.get("wine_id")}
    account_ids = {str(row["account_id"]) for row in accounts if row.get("account_id")}
    user_ids = {str(row["user_id"]) for row in users if row.get("user_id")}
    inventory_wine_ids = {str(row["wine_id"]) for row in inventory_rows if row.get("wine_id")}

    order_total_cents = sum_int(orders, "total_cents")
    line_total_cents = sum_int(lines, "total_cents")
    quantity_bottles = sum_float(lines, "quantity_bottles")

    checkpoints_by_resource = summarize_checkpoints(checkpoints)
    responses_by_resource = summarize_responses(responses)

    missing_line_wines = [
        sample_line(line)
        for line in lines
        if line.get("wine_id") and str(line.get("wine_id")) not in wine_ids
    ]
    blank_line_wines = [sample_line(line) for line in lines if not line.get("wine_id")]
    price_wine_missing = [
        {"price_id": row.get("price_id"), "wine_id": row.get("wine_id")}
        for row in prices
        if row.get("wine_id") and str(row.get("wine_id")) not in wine_ids
    ]
    order_account_missing = [
        sample_order(order)
        for order in orders
        if order.get("account_id") and str(order.get("account_id")) not in account_ids
    ]
    order_user_missing = [
        sample_order(order)
        for order in orders
        if order.get("user_id") and str(order.get("user_id")) not in user_ids
    ]

    return {
        "range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "sync_metadata": {
            "checkpoints_by_resource": checkpoints_by_resource,
            "responses_by_resource": responses_by_resource,
            "recent_runs": recent_runs,
            "missing_resource_checkpoints": [
                resource for resource in RESOURCE_NAMES if resource not in checkpoints_by_resource
            ],
            "missing_resource_responses": [
                resource for resource in RESOURCE_NAMES if resource not in responses_by_resource
            ],
        },
        "cache_counts": {
            "accounts": len(accounts),
            "account_contacts": len(contacts),
            "account_sales_reps": len(account_sales_reps),
            "users": len(users),
            "wines": len(wines),
            "prices": len(prices),
            "prearrivals": len(prearrivals),
            "latest_inventory_snapshot_date": inventory_snapshot_date,
            "latest_inventory_rows": len(inventory_rows),
            "orders": len(orders),
            "order_lines": len(lines),
        },
        "sales_totals": {
            "order_total_cents": order_total_cents,
            "line_total_cents": line_total_cents,
            "order_line_total_diff_cents": line_total_cents - order_total_cents,
            "quantity_bottles": round(quantity_bottles, 4),
        },
        "coverage": {
            "order_accounts": asdict(link_coverage(orders, "account_id", account_ids)),
            "contact_accounts": asdict(link_coverage(contacts, "account_id", account_ids)),
            "sales_rep_accounts": asdict(link_coverage(account_sales_reps, "account_id", account_ids)),
            "sales_rep_users": asdict(link_coverage(account_sales_reps, "user_id", user_ids)),
            "order_users": asdict(link_coverage(orders, "user_id", user_ids)),
            "line_wines": asdict(link_coverage(lines, "wine_id", wine_ids)),
            "price_wines": asdict(link_coverage(prices, "wine_id", wine_ids)),
            "prearrival_wines": asdict(link_coverage(prearrivals, "wine_id", wine_ids)),
            "inventory_wines": asdict(link_coverage(inventory_rows, "wine_id", wine_ids)),
            "catalog_wines_with_latest_inventory": asdict(reverse_coverage(wine_ids, inventory_wine_ids)),
        },
        "vintage_quality": summarize_vintages(wines, lines, sample_size=sample_size),
        "samples": {
            "missing_order_accounts": order_account_missing[:sample_size],
            "missing_order_users": order_user_missing[:sample_size],
            "missing_line_wines": missing_line_wines[:sample_size],
            "blank_line_wines": blank_line_wines[:sample_size],
            "missing_price_wines": price_wine_missing[:sample_size],
        },
    }


def summarize_checkpoints(checkpoints: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for checkpoint in checkpoints:
        grouped.setdefault(str(checkpoint.get("resource_name")), []).append(checkpoint)
    summary = {}
    for resource, rows in grouped.items():
        statuses = Counter(str(row.get("status")) for row in rows)
        completed = [row for row in rows if row.get("status") == "completed"]
        keys = sorted(str(row.get("checkpoint_key")) for row in completed if row.get("checkpoint_key"))
        summary[resource] = {
            "total": len(rows),
            "completed": statuses.get("completed", 0),
            "failed": statuses.get("failed", 0),
            "needs_repair": statuses.get("needs_repair", 0),
            "first_completed": keys[0] if keys else None,
            "last_completed": keys[-1] if keys else None,
        }
    return summary


def summarize_responses(responses: list[dict[str, Any]]) -> dict[str, dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for response in responses:
        resource = str(response.get("request_identifier") or "").strip()
        grouped.setdefault(resource, []).append(response)
    summary = {}
    for resource, rows in grouped.items():
        latest = rows[0] if rows else {}
        summary[resource] = {
            "responses": len(rows),
            "latest_status": latest.get("response_status"),
            "latest_record_count": latest.get("record_count"),
            "latest_fetched_at": latest.get("fetched_at"),
        }
    return summary


def summarize_vintages(
    wines: list[dict[str, Any]],
    lines: list[dict[str, Any]],
    sample_size: int = 10,
) -> dict[str, Any]:
    current_year = datetime.now(timezone.utc).year
    catalog = vintage_counts(wines, "vintage", current_year=current_year)
    line = vintage_counts(lines, "vintage", current_year=current_year)
    mismatches = []
    for row in wines:
        name_year = last_year_from_text(str(row.get("name") or ""), current_year=current_year)
        vintage = str(row.get("vintage") or "")
        if name_year and vintage and vintage not in {"NV", name_year}:
            mismatches.append({"wine_id": row.get("wine_id"), "name": row.get("name"), "vintage": vintage, "name_year": name_year})
    catalog["name_year_mismatch_samples"] = mismatches[:sample_size]
    return {"catalog_wines": catalog, "order_lines": line}


def vintage_counts(rows: list[dict[str, Any]], column: str, current_year: int) -> dict[str, Any]:
    missing = 0
    nv = 0
    year = 0
    suspect = []
    for row in rows:
        value = row.get(column)
        if value in (None, ""):
            missing += 1
            continue
        text = str(value)
        if text.upper() == "NV":
            nv += 1
        elif re.fullmatch(r"\d{4}", text):
            int_year = int(text)
            if 1900 <= int_year <= current_year + 1:
                year += 1
            else:
                suspect.append({"id": row.get("wine_id") or row.get("line_item_id"), "name": row.get("name") or row.get("wine_name"), "vintage": text})
        else:
            suspect.append({"id": row.get("wine_id") or row.get("line_item_id"), "name": row.get("name") or row.get("wine_name"), "vintage": text})
    return {
        "total": len(rows),
        "missing": missing,
        "non_vintage": nv,
        "year": year,
        "suspect_count": len(suspect),
        "suspect_samples": suspect[:10],
    }


def link_coverage(rows: list[dict[str, Any]], column: str, valid_ids: set[str]) -> LinkCoverage:
    blank = 0
    linked = 0
    missing = 0
    for row in rows:
        value = row.get(column)
        if value in (None, ""):
            blank += 1
        elif str(value) in valid_ids:
            linked += 1
        else:
            missing += 1
    return LinkCoverage(total=len(rows), linked=linked, missing=missing, blank=blank)


def reverse_coverage(required_ids: set[str], observed_ids: set[str]) -> LinkCoverage:
    linked = len(required_ids & observed_ids)
    missing = len(required_ids - observed_ids)
    return LinkCoverage(total=len(required_ids), linked=linked, missing=missing, blank=0)


def sample_order(order: dict[str, Any]) -> dict[str, Any]:
    return {
        "supplier_order_id": order.get("supplier_order_id"),
        "account_id": order.get("account_id"),
        "user_id": order.get("user_id"),
        "delivery_at": order.get("delivery_at"),
    }


def sample_line(line: dict[str, Any]) -> dict[str, Any]:
    return {
        "line_item_id": line.get("line_item_id"),
        "supplier_order_id": line.get("supplier_order_id"),
        "wine_id": line.get("wine_id"),
        "wine_name": line.get("wine_name"),
    }


def sum_int(rows: list[dict[str, Any]], column: str) -> int:
    total = 0
    for row in rows:
        try:
            total += int(row.get(column) or 0)
        except (TypeError, ValueError):
            pass
    return total


def sum_float(rows: list[dict[str, Any]], column: str) -> float:
    total = 0.0
    for row in rows:
        try:
            total += float(row.get(column) or 0)
        except (TypeError, ValueError):
            pass
    return total


def last_year_from_text(value: str, current_year: int) -> str | None:
    candidates = []
    for match in re.finditer(r"(?<![A-Za-z0-9/])(18\d{2}|19\d{2}|20\d{2})(?![A-Za-z0-9])", value):
        year = int(match.group(1))
        if 1800 <= year <= current_year + 1:
            candidates.append(match.group(1))
    return candidates[-1] if candidates else None


def print_report(report: dict[str, Any]) -> None:
    counts = report["cache_counts"]
    totals = report["sales_totals"]
    coverage = report["coverage"]
    print(f"Vinosmith data quality: {report['range']['start_date']}..{report['range']['end_date']}")
    print(
        "Cache counts: "
        f"accounts={counts['accounts']:,}, contacts={counts['account_contacts']:,}, "
        f"account_reps={counts['account_sales_reps']:,}, users={counts['users']:,}, wines={counts['wines']:,}, "
        f"prices={counts['prices']:,}, prearrivals={counts['prearrivals']:,}, "
        f"latest_inventory={counts['latest_inventory_rows']:,} "
        f"({counts['latest_inventory_snapshot_date']}), orders={counts['orders']:,}, lines={counts['order_lines']:,}"
    )
    print(
        "Sales totals: "
        f"orders={format_cents(totals['order_total_cents'])}, "
        f"lines={format_cents(totals['line_total_cents'])}, "
        f"diff={format_cents(totals['order_line_total_diff_cents'])}, "
        f"bottle/eaches={totals['quantity_bottles']:,.4f}"
    )
    print("\nCoverage")
    for label, row in coverage.items():
        print(
            f"{label:36} linked={row['linked']:>7,}/{row['total']:<7,} "
            f"({row['linked_percent']:>6.2f}%) missing={row['missing']:,} blank={row['blank']:,}"
        )

    print("\nVintages")
    for label, row in report["vintage_quality"].items():
        print(
            f"{label:16} total={row['total']:,}, year={row['year']:,}, NV={row['non_vintage']:,}, "
            f"missing={row['missing']:,}, suspect={row['suspect_count']:,}"
        )

    metadata = report["sync_metadata"]
    if metadata["missing_resource_checkpoints"] or metadata["missing_resource_responses"]:
        print("\nMetadata gaps")
        print(f"Missing checkpoints: {', '.join(metadata['missing_resource_checkpoints']) or 'none'}")
        print(f"Missing responses: {', '.join(metadata['missing_resource_responses']) or 'none'}")

    samples = report["samples"]
    interesting_samples = {key: value for key, value in samples.items() if value}
    if interesting_samples:
        print("\nSamples")
        for key, values in interesting_samples.items():
            print(f"{key}:")
            for value in values:
                print(f"  {value}")


if __name__ == "__main__":
    raise SystemExit(main())
