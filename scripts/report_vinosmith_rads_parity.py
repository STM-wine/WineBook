"""Compare rescued Vinosmith order history against stored RB6/RADs recommendations.

This read-only helper uses the latest completed `report_runs` +
`reorder_recommendations` rows as the legacy RB6/RADs baseline, then aggregates
rescued Vinosmith supplier-order lines over the same trailing windows. It prints
both the RADs-compatible bottle/eaches quantity and the legacy multiplied value
so old over-multiplied rescues are obvious.
"""

from __future__ import annotations

import argparse
from collections import defaultdict
from dataclasses import dataclass
from datetime import date, datetime, timedelta
import json
from pathlib import Path
import re
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.report_vinosmith_rescue_status import fetch_all, format_cents
from stem_order.supabase_repository import SupabaseRepository, load_dotenv


WINDOWS = (30, 60, 90)


@dataclass
class VinosmithSkuTotals:
    bottle_quantity: float = 0
    legacy_multiplied_quantity: float = 0
    line_total_cents: int = 0
    line_count: int = 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--report-run-id", help="Specific report_runs.id to compare. Defaults to latest completed run.")
    parser.add_argument(
        "--as-of-date",
        help="Comparison end date. Defaults to report_date, then completed_at date, then today.",
    )
    parser.add_argument("--top", type=int, default=25, help="Number of largest SKU differences to print.")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")
    repo = SupabaseRepository.from_env()

    report_run = fetch_report_run(repo, args.report_run_id)
    if not report_run:
        raise SystemExit("No completed report run with recommendations found.")

    as_of_date = resolve_as_of_date(args.as_of_date, report_run)
    min_start_date = as_of_date - timedelta(days=max(WINDOWS))
    print(f"Using report_run={report_run['id']} as_of_date={as_of_date.isoformat()}", file=sys.stderr, flush=True)

    print("Fetching stored recommendations...", file=sys.stderr, flush=True)
    recommendations = fetch_recommendations(repo, report_run["id"])
    print("Fetching Vinosmith order headers for parity window...", file=sys.stderr, flush=True)
    order_rows = fetch_all(
        repo,
        "vinosmith_order_headers",
        "supplier_order_id,delivery_at,total_cents",
        filters=[
            ("gte", "delivery_at", f"{min_start_date.isoformat()}T00:00:00+00:00"),
            ("lte", "delivery_at", f"{as_of_date.isoformat()}T23:59:59+00:00"),
        ],
        order_by="delivery_at",
    )
    print("Fetching Vinosmith order lines...", file=sys.stderr, flush=True)
    line_rows = fetch_all(
        repo,
        "vinosmith_order_lines",
        "line_item_id,supplier_order_id,wine_name,quantity_cases,quantity_bottles,total_cents",
        order_by="supplier_order_id",
    )

    report = build_parity_report(
        report_run=report_run,
        recommendations=recommendations,
        order_rows=order_rows,
        line_rows=line_rows,
        as_of_date=as_of_date,
        top=args.top,
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print_report(report)
    return 0


def fetch_report_run(repo: SupabaseRepository, report_run_id: str | None) -> dict[str, Any] | None:
    if report_run_id:
        result = repo.client.table("report_runs").select("*").eq("id", report_run_id).limit(1).execute()
        return (result.data or [None])[0]

    for report_run in repo.get_completed_report_runs(limit=25):
        recommendations = fetch_recommendations(repo, report_run["id"], limit=1)
        if recommendations:
            return report_run
    return None


def fetch_recommendations(repo: SupabaseRepository, report_run_id: str, limit: int = 20000) -> list[dict[str, Any]]:
    return fetch_all(
        repo,
        "reorder_recommendations",
        "*",
        filters=[("eq", "report_run_id", report_run_id)],
        order_by="last_30_day_sales",
        desc=True,
        limit=limit,
    )


def build_parity_report(
    report_run: dict[str, Any],
    recommendations: list[dict[str, Any]],
    order_rows: list[dict[str, Any]],
    line_rows: list[dict[str, Any]],
    as_of_date: date,
    top: int = 25,
) -> dict[str, Any]:
    order_dates = {
        str(order.get("supplier_order_id")): date_from_timestamp(order.get("delivery_at"))
        for order in order_rows
        if order.get("supplier_order_id")
    }
    lines_by_order: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for line in line_rows:
        supplier_order_id = str(line.get("supplier_order_id") or "")
        if supplier_order_id in order_dates:
            lines_by_order[supplier_order_id].append(line)

    vinosmith_by_window = {
        window: aggregate_vinosmith_lines(lines_by_order, order_dates, as_of_date, window)
        for window in WINDOWS
    }
    recommendation_rows = []
    for row in recommendations:
        sku = normalize_sku(row.get("planning_sku") or row.get("product_name"))
        if not sku:
            continue
        recommendation_rows.append(
            {
                "sku": sku,
                "product_name": row.get("product_name"),
                "last_30_day_sales": float_value(row.get("last_30_day_sales")),
                "last_60_day_sales": float_value(row.get("last_60_day_sales")),
                "last_90_day_sales": float_value(row.get("last_90_day_sales")),
            }
        )

    window_reports = {}
    for window in WINDOWS:
        window_reports[str(window)] = compare_window(
            window=window,
            recommendation_rows=recommendation_rows,
            vinosmith_totals=vinosmith_by_window[window],
            top=top,
        )

    return {
        "report_run": {
            "id": report_run.get("id"),
            "run_type": report_run.get("run_type"),
            "report_date": report_run.get("report_date"),
            "completed_at": report_run.get("completed_at"),
        },
        "as_of_date": as_of_date.isoformat(),
        "recommendation_count": len(recommendation_rows),
        "vinosmith_order_count": len(order_dates),
        "vinosmith_line_count": sum(len(lines) for lines in lines_by_order.values()),
        "windows": window_reports,
    }


def aggregate_vinosmith_lines(
    lines_by_order: dict[str, list[dict[str, Any]]],
    order_dates: dict[str, date | None],
    as_of_date: date,
    window_days: int,
) -> dict[str, VinosmithSkuTotals]:
    start_date = as_of_date - timedelta(days=window_days)
    totals: dict[str, VinosmithSkuTotals] = defaultdict(VinosmithSkuTotals)
    for supplier_order_id, delivery_date in order_dates.items():
        if delivery_date is None or delivery_date < start_date or delivery_date > as_of_date:
            continue
        for line in lines_by_order.get(supplier_order_id, []):
            sku = normalize_sku(line.get("wine_name"))
            if not sku:
                continue
            summary = totals[sku]
            stored_quantity_cases = float_value(line.get("quantity_cases"))
            stored_quantity_bottles = float_value(line.get("quantity_bottles"))
            if (
                stored_quantity_cases
                and is_integer_like(stored_quantity_cases)
                and is_integer_like(stored_quantity_bottles)
                and stored_quantity_bottles > stored_quantity_cases * 1.5
            ):
                bottle_quantity = stored_quantity_cases
                legacy_multiplied_quantity = stored_quantity_bottles
            else:
                bottle_quantity = stored_quantity_bottles
                legacy_multiplied_quantity = stored_quantity_bottles
            summary.bottle_quantity += bottle_quantity
            summary.legacy_multiplied_quantity += legacy_multiplied_quantity
            summary.line_total_cents += int_value(line.get("total_cents"))
            summary.line_count += 1
    return totals


def compare_window(
    window: int,
    recommendation_rows: list[dict[str, Any]],
    vinosmith_totals: dict[str, VinosmithSkuTotals],
    top: int,
) -> dict[str, Any]:
    sales_key = f"last_{window}_day_sales"
    sku_rows = []
    rads_total = 0.0
    vinosmith_bottle_total = 0.0
    vinosmith_legacy_multiplied_total = 0.0
    matched_skus = 0
    for recommendation in recommendation_rows:
        sku = recommendation["sku"]
        rads_quantity = float_value(recommendation.get(sales_key))
        vinosmith = vinosmith_totals.get(sku, VinosmithSkuTotals())
        if rads_quantity or vinosmith.line_count:
            matched_skus += int(bool(vinosmith.line_count))
            rads_total += rads_quantity
            vinosmith_bottle_total += vinosmith.bottle_quantity
            vinosmith_legacy_multiplied_total += vinosmith.legacy_multiplied_quantity
            sku_rows.append(
                {
                    "sku": sku,
                    "product_name": recommendation.get("product_name"),
                    "rads_quantity": round(rads_quantity, 4),
                    "vinosmith_bottle_quantity": round(vinosmith.bottle_quantity, 4),
                    "vinosmith_legacy_multiplied_quantity": round(vinosmith.legacy_multiplied_quantity, 4),
                    "bottle_diff": round(vinosmith.bottle_quantity - rads_quantity, 4),
                    "legacy_multiplied_diff": round(vinosmith.legacy_multiplied_quantity - rads_quantity, 4),
                    "line_total_cents": vinosmith.line_total_cents,
                    "line_count": vinosmith.line_count,
                }
            )

    bottle_abs_diff = abs(vinosmith_bottle_total - rads_total)
    legacy_multiplied_abs_diff = abs(vinosmith_legacy_multiplied_total - rads_total)
    sku_rows.sort(key=lambda row: abs(row["bottle_diff"]), reverse=True)
    return {
        "days": window,
        "sku_count_with_any_sales": len(sku_rows),
        "matched_skus": matched_skus,
        "totals": {
            "rads_quantity": round(rads_total, 4),
            "vinosmith_bottle_quantity": round(vinosmith_bottle_total, 4),
            "vinosmith_legacy_multiplied_quantity": round(vinosmith_legacy_multiplied_total, 4),
            "bottle_diff": round(vinosmith_bottle_total - rads_total, 4),
            "legacy_multiplied_diff": round(vinosmith_legacy_multiplied_total - rads_total, 4),
            "bottle_abs_diff": round(bottle_abs_diff, 4),
            "legacy_multiplied_abs_diff": round(legacy_multiplied_abs_diff, 4),
            "best_quantity_basis": "bottle_quantity"
            if bottle_abs_diff <= legacy_multiplied_abs_diff
            else "legacy_multiplied_quantity",
            "vinosmith_line_total": format_cents(sum(row["line_total_cents"] for row in sku_rows)),
        },
        "top_bottle_quantity_differences": sku_rows[:top],
    }


def print_report(report: dict[str, Any]) -> None:
    report_run = report["report_run"]
    print(f"Vinosmith/RADs parity report as of {report['as_of_date']}")
    print(f"Report run: {report_run['id']} ({report_run.get('run_type')}, report_date={report_run.get('report_date')})")
    print(f"Recommendations: {report['recommendation_count']:,}")
    print(f"Vinosmith rows in 90-day horizon: orders={report['vinosmith_order_count']:,}, lines={report['vinosmith_line_count']:,}")

    for window_key in [str(window) for window in WINDOWS]:
        window = report["windows"][window_key]
        totals = window["totals"]
        print(f"\nLast {window['days']} days")
        print(f"RADs quantity: {totals['rads_quantity']:,.4f}")
        print(
            f"Vinosmith bottle/eaches quantity: {totals['vinosmith_bottle_quantity']:,.4f} "
            f"(diff {totals['bottle_diff']:,.4f})"
        )
        print(
            "Legacy multiplied quantity: "
            f"{totals['vinosmith_legacy_multiplied_quantity']:,.4f} "
            f"(diff {totals['legacy_multiplied_diff']:,.4f})"
        )
        print(f"Best quantity basis: {totals['best_quantity_basis']}")
        print(f"Vinosmith line total: {totals['vinosmith_line_total']}")
        print("Largest bottle/eaches quantity differences:")
        for row in window["top_bottle_quantity_differences"][:10]:
            print(
                f"  {row['bottle_diff']:>10,.2f} | RADs {row['rads_quantity']:>8,.2f} | "
                f"VS bottles {row['vinosmith_bottle_quantity']:>8,.2f} | {row['product_name'] or row['sku']}"
            )


def resolve_as_of_date(raw_as_of_date: str | None, report_run: dict[str, Any]) -> date:
    if raw_as_of_date:
        return date.fromisoformat(raw_as_of_date)
    if report_run.get("report_date"):
        return date.fromisoformat(str(report_run["report_date"])[:10])
    if report_run.get("completed_at"):
        return date.fromisoformat(str(report_run["completed_at"])[:10])
    return date.today()


def normalize_sku(value: Any) -> str:
    if value in (None, ""):
        return ""
    name = str(value).lower()
    name = re.sub(r"\b20[2-9][0-9]\b", "", name)
    name = re.sub(r"[,.]", "", name)
    return " ".join(name.split()).strip()


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


def is_integer_like(value: float) -> bool:
    return abs(value - round(value)) < 0.0001


if __name__ == "__main__":
    raise SystemExit(main())
