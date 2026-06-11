"""Fetch Vinosmith API data and write Stem's source-sync cache tables.

This is intentionally a trusted server/local worker, not browser code. It can
run as download-only when Supabase service-role credentials are absent, and it
can write source sync metadata plus normalized Vinosmith cache rows when they
are present.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.supabase_repository import SupabaseRepository, load_dotenv
from stem_order.vinosmith_api import (
    DEFAULT_VINOSMITH_DELIVERY_STATUSES,
    VINOSMITH_DISTRIBUTOR_ENDPOINTS,
    VinosmithDistributorClient,
    VinosmithFetchResult,
    analyze_vintage_values,
    collect_wine_snapshots,
    filter_supplier_orders_by_delivery_status,
    filter_supplier_orders_by_delivery_window,
    records_for_resource,
    returned_metadata,
    validate_supplier_order_window,
    write_raw_json,
)


OUTPUT_ROOT = ROOT / "tmp" / "vinosmith-rescue"
RESOURCE_CHOICES = ("supplier_orders", "wines", "prices", "inventory")


@dataclass
class ResourceSummary:
    resource: str
    status: int | None
    record_count: int
    accepted_count: int
    raw_file: str | None
    response_id: str | None
    checkpoint_key: str | None
    diagnostics: dict[str, Any]
    error: str | None = None


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--resource",
        action="append",
        choices=RESOURCE_CHOICES,
        help="Resource to fetch. Repeatable. Defaults to wines, prices, inventory.",
    )
    parser.add_argument("--all", action="store_true", help="Fetch all resources, including supplier_orders.")
    parser.add_argument("--delivery-start-date", help="YYYY-MM-DD; required for supplier_orders.")
    parser.add_argument("--delivery-end-date", help="YYYY-MM-DD; required for supplier_orders.")
    parser.add_argument("--account-id", help="Optional Vinosmith account ID for supplier_orders.")
    parser.add_argument(
        "--delivery-status",
        action="append",
        default=[],
        help="Accepted supplier_order delivery_status. Repeatable. Defaults to sent-to-warehouse.",
    )
    parser.add_argument(
        "--sync-type",
        choices=("discovery", "historical_backfill", "daily_refresh", "parity_check", "manual_poc"),
        default="manual_poc",
    )
    parser.add_argument("--output-dir", type=Path, help="Raw JSON output directory. Defaults under tmp/vinosmith-rescue/.")
    parser.add_argument("--no-supabase", action="store_true", help="Fetch and save raw JSON without Supabase writes.")
    parser.add_argument("--require-supabase", action="store_true", help="Fail if Supabase service-role credentials are absent.")
    parser.add_argument(
        "--no-normalized-writes",
        action="store_true",
        help="Record sync metadata only; do not write normalized Vinosmith cache tables.",
    )
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    resources = selected_resources(args)
    order_window = supplier_order_window(args, resources)
    statuses = tuple(args.delivery_status or DEFAULT_VINOSMITH_DELIVERY_STATUSES)

    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local")

    token = os.getenv("VINOSMITH_API_TOKEN", "").strip()
    if not token:
        print("Missing VINOSMITH_API_TOKEN.", file=sys.stderr)
        return 2

    repo = None if args.no_supabase else maybe_repository(require=args.require_supabase)
    output_dir = args.output_dir or default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    client = VinosmithDistributorClient(token=token)
    source_sync_run = None
    if repo:
        source_sync_run = repo.create_source_sync_run(
            "vinosmith",
            args.sync_type,
            requested_start_date=order_window[0] if order_window else None,
            requested_end_date=order_window[1] if order_window else None,
            worker_name="sync_vinosmith_rescue.py",
            parameters={
                "resources": resources,
                "delivery_statuses": statuses,
                "account_id_supplied": bool(args.account_id),
                "normalized_writes": not args.no_normalized_writes,
            },
        )

    summaries: list[ResourceSummary] = []
    try:
        for resource in resources:
            summary = sync_resource(
                client=client,
                repo=repo,
                source_sync_run_id=source_sync_run["id"] if source_sync_run else None,
                resource=resource,
                output_dir=output_dir,
                order_window=order_window,
                account_id=args.account_id,
                delivery_statuses=statuses,
                write_normalized=not args.no_normalized_writes,
            )
            summaries.append(summary)

        diagnostics = {
            "resources": [asdict(summary) for summary in summaries],
            "output_dir": str(output_dir.relative_to(ROOT)),
        }
        if repo and source_sync_run:
            if any(summary.error for summary in summaries):
                repo.fail_source_sync_run(source_sync_run["id"], "One or more Vinosmith resources failed.")
            else:
                repo.complete_source_sync_run(source_sync_run["id"], diagnostics=diagnostics)

        write_run_summary(output_dir, diagnostics)
        print_summary(summaries, output_dir, repo_enabled=repo is not None)
        return 1 if any(summary.error for summary in summaries) else 0
    except Exception as exc:
        if repo and source_sync_run:
            repo.fail_source_sync_run(source_sync_run["id"], str(exc))
        raise


def selected_resources(args: argparse.Namespace) -> list[str]:
    if args.all:
        return list(RESOURCE_CHOICES)
    return args.resource or ["wines", "prices", "inventory"]


def supplier_order_window(args: argparse.Namespace, resources: list[str]) -> tuple[date, date] | None:
    if "supplier_orders" not in resources:
        return None
    if not args.delivery_start_date or not args.delivery_end_date:
        raise SystemExit("--delivery-start-date and --delivery-end-date are required for supplier_orders.")
    return validate_supplier_order_window(args.delivery_start_date, args.delivery_end_date)


def maybe_repository(require: bool) -> SupabaseRepository | None:
    has_credentials = bool(os.getenv("SUPABASE_URL")) and bool(os.getenv("SUPABASE_SERVICE_ROLE_KEY"))
    if not has_credentials:
        if require:
            raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        return None
    return SupabaseRepository.from_env()


def default_output_dir() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return OUTPUT_ROOT / stamp


def sync_resource(
    client: VinosmithDistributorClient,
    repo: SupabaseRepository | None,
    source_sync_run_id: str | None,
    resource: str,
    output_dir: Path,
    order_window: tuple[date, date] | None,
    account_id: str | None,
    delivery_statuses: tuple[str, ...],
    write_normalized: bool,
) -> ResourceSummary:
    requested_params = {}
    if resource == "supplier_orders":
        if order_window is None:
            raise ValueError("supplier_orders requires an order window")
        requested_params = {
            "delivery_start_date": order_window[0].isoformat(),
            "delivery_end_date": order_window[1].isoformat(),
            "account_id": account_id,
        }

    result = client.fetch_resource(resource, requested_params)
    payload = result.json_payload() if result.body else {}
    raw_file = save_raw_payload(output_dir, resource, payload) if result.body else None
    records = records_for_resource(resource, payload)
    accepted_records = accepted_resource_records(resource, records, order_window, delivery_statuses)
    resource_diagnostics = diagnostics_for_resource(resource, accepted_records, result.fetched_at)

    response_id = None
    checkpoint_key = None
    if repo:
        response_id = record_api_response(repo, source_sync_run_id, result, payload, raw_file, len(records))
        if result.ok and write_normalized:
            write_resource_records(repo, source_sync_run_id, response_id, resource, accepted_records, result.fetched_at)
        if result.ok:
            checkpoint_key = upsert_checkpoint(
                repo,
                source_sync_run_id,
                resource,
                order_window,
                result,
                record_count=len(records),
                accepted_count=len(accepted_records),
                response_id=response_id,
                resource_diagnostics=resource_diagnostics,
            )

    return ResourceSummary(
        resource=resource,
        status=result.status,
        record_count=len(records),
        accepted_count=len(accepted_records),
        raw_file=str(raw_file.relative_to(ROOT)) if raw_file else None,
        response_id=response_id,
        checkpoint_key=checkpoint_key,
        diagnostics=resource_diagnostics,
        error=result.error,
    )


def accepted_resource_records(
    resource: str,
    records: list[dict[str, Any]],
    order_window: tuple[date, date] | None,
    delivery_statuses: tuple[str, ...],
) -> list[dict[str, Any]]:
    if resource != "supplier_orders":
        return records
    if order_window is None:
        return []
    windowed = filter_supplier_orders_by_delivery_window(records, order_window[0], order_window[1])
    return filter_supplier_orders_by_delivery_status(windowed, delivery_statuses)


def save_raw_payload(output_dir: Path, resource: str, payload: dict[str, Any]) -> Path:
    destination = output_dir / f"{resource}.json"
    write_raw_json(destination, payload)
    return destination


def record_api_response(
    repo: SupabaseRepository,
    source_sync_run_id: str | None,
    result: VinosmithFetchResult,
    payload: dict[str, Any],
    raw_file: Path | None,
    record_count: int,
) -> str:
    checksum = hashlib.sha256(result.body or b"").hexdigest() if result.body else None
    saved = repo.record_source_api_response(
        "vinosmith",
        result.endpoint,
        source_sync_run_id=source_sync_run_id,
        request_method="GET",
        request_identifier=result.resource,
        requested_params=result.requested_params,
        returned_metadata=returned_metadata(payload),
        response_status=result.status,
        response_status_text=result.status_text,
        content_type=result.content_type,
        byte_size=result.byte_size,
        checksum=checksum,
        raw_storage_path=f"local:{raw_file.relative_to(ROOT)}" if raw_file else None,
        record_count=record_count,
        fetched_at=result.fetched_at,
    )
    return saved["id"]


def write_resource_records(
    repo: SupabaseRepository,
    source_sync_run_id: str | None,
    response_id: str,
    resource: str,
    records: list[dict[str, Any]],
    fetched_at: datetime,
) -> None:
    if resource == "wines":
        repo.upsert_vinosmith_wines(records, raw_response_id=response_id)
    elif resource == "prices":
        repo.upsert_vinosmith_prices(records, raw_response_id=response_id)
    elif resource == "inventory":
        repo.insert_vinosmith_inventory_snapshots(
            records,
            source_sync_run_id=source_sync_run_id,
            raw_response_id=response_id,
            snapshot_at=fetched_at,
        )
    elif resource == "supplier_orders":
        repo.upsert_vinosmith_supplier_orders(records, raw_response_id=response_id)
    else:
        raise ValueError(f"Unsupported Vinosmith resource: {resource}")


def diagnostics_for_resource(
    resource: str,
    records: list[dict[str, Any]],
    fetched_at: datetime,
) -> dict[str, Any]:
    wines = collect_wine_snapshots(resource, records)
    if not wines:
        return {}
    return {
        "vintage": analyze_vintage_values(wines, current_year=fetched_at.year),
    }


def upsert_checkpoint(
    repo: SupabaseRepository,
    source_sync_run_id: str | None,
    resource: str,
    order_window: tuple[date, date] | None,
    result: VinosmithFetchResult,
    record_count: int,
    accepted_count: int,
    response_id: str | None,
    resource_diagnostics: dict[str, Any] | None = None,
) -> str:
    if resource == "supplier_orders" and order_window:
        checkpoint_key = f"{order_window[0].isoformat()}:{order_window[1].isoformat()}"
        requested_start_date = order_window[0]
        requested_end_date = order_window[1]
    elif resource == "inventory":
        checkpoint_key = result.fetched_at.date().isoformat()
        requested_start_date = result.fetched_at.date()
        requested_end_date = result.fetched_at.date()
    else:
        checkpoint_key = "latest"
        requested_start_date = None
        requested_end_date = None

    repo.upsert_source_sync_checkpoint(
        "vinosmith",
        resource,
        checkpoint_key,
        status="completed",
        requested_start_date=requested_start_date,
        requested_end_date=requested_end_date,
        completed_through=result.fetched_at,
        cursor_data={
            "endpoint": result.endpoint,
            "response_id": response_id,
            "record_count": record_count,
            "accepted_count": accepted_count,
        },
        last_source_sync_run_id=source_sync_run_id,
        diagnostics={
            "returned_metadata": returned_metadata(result.json_payload() if result.body else {}),
            "known_endpoint": VINOSMITH_DISTRIBUTOR_ENDPOINTS.get(resource),
            **(resource_diagnostics or {}),
        },
        last_synced_at=result.fetched_at,
    )
    return checkpoint_key


def write_run_summary(output_dir: Path, diagnostics: dict[str, Any]) -> None:
    (output_dir / "summary.json").write_text(json.dumps(diagnostics, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def print_summary(summaries: list[ResourceSummary], output_dir: Path, repo_enabled: bool) -> None:
    for summary in summaries:
        error = f", error={summary.error}" if summary.error else ""
        print(
            f"{summary.resource}: status={summary.status}, records={summary.record_count}, "
            f"accepted={summary.accepted_count}{error}"
        )
    print(f"Raw output: {output_dir.relative_to(ROOT)}")
    print(f"Supabase writes: {'enabled' if repo_enabled else 'disabled'}")


if __name__ == "__main__":
    raise SystemExit(main())
