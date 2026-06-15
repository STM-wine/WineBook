"""Summarize rescued Vinosmith cache data from Supabase.

This is a trusted server/local worker helper. It reads private Vinosmith cache
tables through the Supabase service-role client and prints a compact validation
report after rescue/backfill runs.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
import json
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.supabase_repository import SupabaseRepository, load_dotenv


@dataclass
class MonthSummary:
    month: str
    orders: int = 0
    lines: int = 0
    order_total_cents: int = 0
    line_total_cents: int = 0
    quantity_bottles: float = 0
    missing_account_orders: int = 0
    missing_user_orders: int = 0
    missing_wine_lines: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--start-date", default="2023-01-01", help="Inclusive delivery date lower bound.")
    parser.add_argument(
        "--end-date",
        default=date.today().isoformat(),
        help="Inclusive delivery date upper bound. Defaults to today.",
    )
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

    print("Fetching Vinosmith order headers...", file=sys.stderr, flush=True)
    order_rows = fetch_all(
        repo,
        "vinosmith_order_headers",
        "supplier_order_id,delivery_at,delivery_status,total_cents,account_id,user_id,warehouse_id",
        filters=[
            ("gte", "delivery_at", f"{start_date.isoformat()}T00:00:00+00:00"),
            ("lte", "delivery_at", f"{end_date.isoformat()}T23:59:59+00:00"),
        ],
        order_by="delivery_at",
    )
    print("Fetching Vinosmith order lines...", file=sys.stderr, flush=True)
    line_rows = fetch_all(
        repo,
        "vinosmith_order_lines",
        "line_item_id,supplier_order_id,wine_id,total_cents,quantity_bottles",
        order_by="supplier_order_id",
    )
    print("Fetching supplier-order checkpoints...", file=sys.stderr, flush=True)
    checkpoints = fetch_all(
        repo,
        "source_sync_checkpoints",
        "resource_name,checkpoint_key,status,requested_start_date,requested_end_date,last_synced_at",
        filters=[
            ("eq", "source_system", "vinosmith"),
            ("eq", "resource_name", "supplier_orders"),
        ],
        order_by="requested_start_date",
    )
    print("Fetching recent Vinosmith sync runs...", file=sys.stderr, flush=True)
    recent_runs = fetch_all(
        repo,
        "source_sync_runs",
        "id,sync_type,status,requested_start_date,requested_end_date,completed_at,error_message",
        filters=[("eq", "source_system", "vinosmith")],
        order_by="completed_at",
        desc=True,
        limit=10,
    )

    report = build_report(
        order_rows=order_rows,
        line_rows=line_rows,
        checkpoints=checkpoints,
        recent_runs=recent_runs,
        start_date=start_date,
        end_date=end_date,
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_report(report)
    return 0


def fetch_all(
    repo: SupabaseRepository,
    table: str,
    columns: str,
    filters: list[tuple[str, str, Any]] | None = None,
    order_by: str | None = None,
    desc: bool = False,
    limit: int | None = None,
    page_size: int = 1000,
) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    while limit is None or len(rows) < limit:
        start = len(rows)
        end = start + min(page_size, (limit - start) if limit else page_size) - 1
        query = repo.client.table(table).select(columns)
        for method, column, value in filters or []:
            query = getattr(query, method)(column, value)
        if order_by:
            query = query.order(order_by, desc=desc)
        result = query.range(start, end).execute()
        page = result.data or []
        rows.extend(page)
        if len(page) < page_size:
            break
    return rows


def build_report(
    order_rows: list[dict[str, Any]],
    line_rows: list[dict[str, Any]],
    checkpoints: list[dict[str, Any]],
    recent_runs: list[dict[str, Any]],
    start_date: date,
    end_date: date,
) -> dict[str, Any]:
    months: dict[str, MonthSummary] = {}
    orders_by_id: dict[str, str] = {}
    for order in order_rows:
        delivery_date = date_from_timestamp(order.get("delivery_at"))
        if delivery_date is None or delivery_date < start_date or delivery_date > end_date:
            continue
        month = delivery_date.strftime("%Y-%m")
        summary = months.setdefault(month, MonthSummary(month=month))
        summary.orders += 1
        summary.order_total_cents += int_value(order.get("total_cents"))
        if not order.get("account_id"):
            summary.missing_account_orders += 1
        if not order.get("user_id"):
            summary.missing_user_orders += 1
        supplier_order_id = str(order.get("supplier_order_id") or "")
        if supplier_order_id:
            orders_by_id[supplier_order_id] = month

    unknown_order_lines = 0
    for line in line_rows:
        month = orders_by_id.get(str(line.get("supplier_order_id") or ""))
        if not month:
            unknown_order_lines += 1
            continue
        summary = months.setdefault(month, MonthSummary(month=month))
        summary.lines += 1
        summary.line_total_cents += int_value(line.get("total_cents"))
        summary.quantity_bottles += float_value(line.get("quantity_bottles"))
        if not line.get("wine_id"):
            summary.missing_wine_lines += 1

    month_rows = [asdict(months[month]) for month in sorted(months)]
    completed_checkpoints = [
        checkpoint
        for checkpoint in checkpoints
        if checkpoint.get("status") == "completed"
        and checkpoint.get("requested_start_date")
        and checkpoint.get("requested_end_date")
    ]
    checkpoint_keys = sorted(str(checkpoint.get("checkpoint_key")) for checkpoint in completed_checkpoints)
    return {
        "range": {"start_date": start_date.isoformat(), "end_date": end_date.isoformat()},
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "totals": {
            "orders": sum(month["orders"] for month in month_rows),
            "lines": sum(month["lines"] for month in month_rows),
            "order_total_cents": sum(month["order_total_cents"] for month in month_rows),
            "line_total_cents": sum(month["line_total_cents"] for month in month_rows),
            "quantity_bottles": round(sum(month["quantity_bottles"] for month in month_rows), 4),
            "missing_account_orders": sum(month["missing_account_orders"] for month in month_rows),
            "missing_user_orders": sum(month["missing_user_orders"] for month in month_rows),
            "missing_wine_lines": sum(month["missing_wine_lines"] for month in month_rows),
            "unknown_order_lines": unknown_order_lines,
        },
        "months": month_rows,
        "checkpoints": {
            "completed_count": len(completed_checkpoints),
            "first": checkpoint_keys[0] if checkpoint_keys else None,
            "last": checkpoint_keys[-1] if checkpoint_keys else None,
            "incomplete": [
                {
                    "checkpoint_key": checkpoint.get("checkpoint_key"),
                    "status": checkpoint.get("status"),
                }
                for checkpoint in checkpoints
                if checkpoint.get("status") != "completed"
            ],
        },
        "recent_runs": recent_runs,
    }


def print_report(report: dict[str, Any]) -> None:
    totals = report["totals"]
    print(f"Vinosmith rescue status: {report['range']['start_date']}..{report['range']['end_date']}")
    print(f"Orders: {totals['orders']:,}")
    print(f"Lines: {totals['lines']:,}")
    print(f"Order total: {format_cents(totals['order_total_cents'])}")
    print(f"Line total: {format_cents(totals['line_total_cents'])}")
    print(f"Quantity bottle/eaches: {totals['quantity_bottles']:,.4f}")
    print(
        "Missing links: "
        f"accounts={totals['missing_account_orders']:,}, "
        f"users={totals['missing_user_orders']:,}, "
        f"wines={totals['missing_wine_lines']:,}, "
        f"lines_without_rescued_order={totals['unknown_order_lines']:,}"
    )
    checkpoints = report["checkpoints"]
    print(
        "Supplier-order checkpoints: "
        f"{checkpoints['completed_count']} completed, first={checkpoints['first']}, last={checkpoints['last']}"
    )
    if checkpoints["incomplete"]:
        print(f"Incomplete checkpoints: {checkpoints['incomplete']}")

    print("\nMonth        Orders   Lines       Order Total        Line Total     Bottles")
    for month in report["months"]:
        print(
            f"{month['month']}  "
            f"{month['orders']:>7,} "
            f"{month['lines']:>7,} "
            f"{format_cents(month['order_total_cents']):>17} "
            f"{format_cents(month['line_total_cents']):>17} "
            f"{month['quantity_bottles']:>11,.2f}"
        )


def date_from_timestamp(value: Any) -> date | None:
    if value in (None, ""):
        return None
    try:
        return date.fromisoformat(str(value)[:10])
    except ValueError:
        return None


def int_value(value: Any) -> int:
    if value in (None, ""):
        return 0
    try:
        return int(value)
    except (TypeError, ValueError):
        return 0


def float_value(value: Any) -> float:
    if value in (None, ""):
        return 0
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0


def format_cents(value: int) -> str:
    return f"${value / 100:,.2f}"


if __name__ == "__main__":
    raise SystemExit(main())
