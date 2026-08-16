"""Backfill Vinosmith supplier orders using Supabase REST keys.

The Supabase Python client used by the older rescue script rejects newer
`sb_secret` keys. This worker keeps the same Vinosmith normalization behavior
but writes through PostgREST so current Supabase secret keys work.
"""

from __future__ import annotations

import argparse
from datetime import date, datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import sys
from typing import Any
from urllib.error import HTTPError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from scripts.sync_vinosmith_rescue import (  # noqa: E402
    OUTPUT_ROOT,
    accepted_resource_records,
    date_windows,
    diagnostics_for_resource,
    print_progress,
    save_raw_payload,
)
from stem_order.supabase_repository import (  # noqa: E402
    dedupe_payloads_for_conflict,
    load_dotenv,
    vinosmith_order_header_payload,
    vinosmith_order_line_payload,
    vinosmith_wine_payload,
)
from stem_order.vinosmith_api import (  # noqa: E402
    DEFAULT_VINOSMITH_DELIVERY_STATUSES,
    VinosmithDistributorClient,
    records_for_resource,
    returned_metadata,
)


RESOURCE = "supplier_orders"


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--backfill-start-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--backfill-end-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--backfill-window-days", type=int, default=7, help="1-31 days per API request")
    parser.add_argument("--delivery-status", action="append", default=[], help="Accepted delivery status")
    parser.add_argument("--account-id", help="Optional Vinosmith account ID")
    parser.add_argument(
        "--sync-type",
        choices=("historical_backfill", "daily_refresh", "manual_poc"),
        default="historical_backfill",
    )
    parser.add_argument("--output-dir", type=Path, help="Raw JSON output directory")
    parser.add_argument("--no-normalized-writes", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    load_dotenv(ROOT / ".env")
    load_dotenv(ROOT / ".env.local", override=True)

    supabase = SupabaseRestClient.from_env()
    token = os.getenv("VINOSMITH_API_TOKEN", "").strip()
    if not token:
        raise RuntimeError("Missing VINOSMITH_API_TOKEN.")

    start_date = date.fromisoformat(args.backfill_start_date)
    end_date = date.fromisoformat(args.backfill_end_date)
    windows = date_windows(start_date, end_date, args.backfill_window_days)
    statuses = tuple(args.delivery_status or DEFAULT_VINOSMITH_DELIVERY_STATUSES)
    output_dir = args.output_dir or default_output_dir()
    output_dir.mkdir(parents=True, exist_ok=True)

    print_progress(
        f"Starting REST Vinosmith supplier-order backfill: "
        f"{start_date.isoformat()}..{end_date.isoformat()}, windows={len(windows)}"
    )
    run = supabase.insert_one(
        "source_sync_runs",
        {
            "source_system": "vinosmith",
            "sync_type": args.sync_type,
            "status": "running",
            "requested_start_date": start_date.isoformat(),
            "requested_end_date": end_date.isoformat(),
            "worker_name": "backfill_vinosmith_supplier_orders_rest.py",
            "parameters": {
                "resource": RESOURCE,
                "delivery_statuses": statuses,
                "account_id_supplied": bool(args.account_id),
                "normalized_writes": not args.no_normalized_writes,
                "backfill_window_days": args.backfill_window_days,
                "supplier_order_windows": [
                    {"start_date": window[0].isoformat(), "end_date": window[1].isoformat()} for window in windows
                ],
            },
        },
    )

    client = VinosmithDistributorClient(token=token)
    summaries: list[dict[str, Any]] = []
    try:
        for window in windows:
            summary = sync_window(
                client=client,
                supabase=supabase,
                source_sync_run_id=run["id"],
                output_dir=output_dir,
                order_window=window,
                account_id=args.account_id,
                delivery_statuses=statuses,
                write_normalized=not args.no_normalized_writes,
            )
            summaries.append(summary)

        diagnostics = {"resources": summaries, "output_dir": str(output_dir.relative_to(ROOT))}
        supabase.update_by_id(
            "source_sync_runs",
            run["id"],
            {"status": "completed", "completed_at": now_iso(), "diagnostics": diagnostics},
        )
        (output_dir / "summary.json").write_text(json.dumps(diagnostics, indent=2, sort_keys=True) + "\n")
        print_summary(summaries, output_dir)
        return 1 if any(summary.get("error") for summary in summaries) else 0
    except Exception as exc:
        supabase.update_by_id(
            "source_sync_runs",
            run["id"],
            {"status": "failed", "completed_at": now_iso(), "error_message": str(exc)},
        )
        raise


def sync_window(
    client: VinosmithDistributorClient,
    supabase: "SupabaseRestClient",
    source_sync_run_id: str,
    output_dir: Path,
    order_window: tuple[date, date],
    account_id: str | None,
    delivery_statuses: tuple[str, ...],
    write_normalized: bool,
) -> dict[str, Any]:
    label = f"{RESOURCE} {order_window[0].isoformat()}..{order_window[1].isoformat()}"
    requested_params = {
        "delivery_start_date": order_window[0].isoformat(),
        "delivery_end_date": order_window[1].isoformat(),
        "account_id": account_id,
    }
    print_progress(f"{label}: fetching from Vinosmith")
    result = client.fetch_resource(RESOURCE, requested_params)
    payload = result.json_payload() if result.body else {}
    raw_file = save_raw_payload(output_dir, RESOURCE, payload, order_window=order_window) if result.body else None
    records = records_for_resource(RESOURCE, payload)
    accepted_records = accepted_resource_records(RESOURCE, records, order_window, delivery_statuses)
    diagnostics = diagnostics_for_resource(RESOURCE, accepted_records, result.fetched_at)
    status_text = result.status if result.status is not None else result.status_text or "no-status"
    print_progress(f"{label}: fetched status={status_text}, records={len(records)}, accepted={len(accepted_records)}")

    response = record_api_response(
        supabase=supabase,
        source_sync_run_id=source_sync_run_id,
        result=result,
        payload=payload,
        raw_file=raw_file,
        record_count=len(records),
    )
    if result.ok and write_normalized:
        print_progress(f"{label}: writing normalized rows")
        write_supplier_orders(supabase, accepted_records, raw_response_id=response["id"])
    if result.ok:
        print_progress(f"{label}: updating checkpoint")
        upsert_checkpoint(
            supabase=supabase,
            source_sync_run_id=source_sync_run_id,
            order_window=order_window,
            fetched_at=result.fetched_at,
            response_id=response["id"],
            record_count=len(records),
            accepted_count=len(accepted_records),
            diagnostics=diagnostics,
            payload=payload,
        )

    error = result.error
    if error:
        print_progress(f"{label}: failed error={error}")
    else:
        print_progress(f"{label}: completed")
    return {
        "resource": RESOURCE,
        "requested_window": f"{order_window[0].isoformat()}:{order_window[1].isoformat()}",
        "status": result.status,
        "record_count": len(records),
        "accepted_count": len(accepted_records),
        "raw_file": str(raw_file.relative_to(ROOT)) if raw_file else None,
        "response_id": response["id"],
        "checkpoint_key": f"{order_window[0].isoformat()}:{order_window[1].isoformat()}" if result.ok else None,
        "diagnostics": diagnostics,
        "error": error,
    }


def record_api_response(
    supabase: "SupabaseRestClient",
    source_sync_run_id: str,
    result,
    payload: dict[str, Any],
    raw_file: Path | None,
    record_count: int,
) -> dict[str, Any]:
    checksum = hashlib.sha256(result.body or b"").hexdigest() if result.body else None
    return supabase.insert_one(
        "source_api_responses",
        {
            "source_sync_run_id": source_sync_run_id,
            "source_system": "vinosmith",
            "endpoint": result.endpoint,
            "request_method": "GET",
            "request_identifier": result.resource,
            "requested_params": result.requested_params,
            "returned_metadata": returned_metadata(payload),
            "response_status": result.status,
            "response_status_text": result.status_text,
            "content_type": result.content_type,
            "byte_size": result.byte_size,
            "checksum": checksum,
            "raw_storage_path": f"local:{raw_file.relative_to(ROOT)}" if raw_file else None,
            "record_count": record_count,
            "fetched_at": result.fetched_at.isoformat(),
        },
    )


def write_supplier_orders(supabase: "SupabaseRestClient", records: list[dict[str, Any]], raw_response_id: str) -> None:
    headers = [vinosmith_order_header_payload(record, raw_response_id=raw_response_id) for record in records]
    supabase.upsert_many("vinosmith_order_headers", headers, on_conflict="supplier_order_id")

    wines: list[dict[str, Any]] = []
    lines: list[dict[str, Any]] = []
    for record in records:
        supplier_order = record.get("supplier_order") if isinstance(record.get("supplier_order"), dict) else {}
        supplier_order_id = clean_value(supplier_order.get("id"))
        if not supplier_order_id:
            continue
        for line_item in record.get("line_items") or []:
            if not isinstance(line_item, dict):
                continue
            lines.append(vinosmith_order_line_payload(line_item, supplier_order_id=str(supplier_order_id)))
            wine = line_item.get("wine")
            if isinstance(wine, dict) and wine.get("id"):
                wines.append(vinosmith_wine_payload(wine, raw_response_id=raw_response_id))

    supabase.upsert_many("vinosmith_wines", wines, on_conflict="wine_id")
    supabase.upsert_many("vinosmith_order_lines", lines, on_conflict="line_item_id")
    print_progress(
        f"normalized upsert complete: headers={len(headers)}, wines={len(wines)}, lines={len(lines)}"
    )


def upsert_checkpoint(
    supabase: "SupabaseRestClient",
    source_sync_run_id: str,
    order_window: tuple[date, date],
    fetched_at: datetime,
    response_id: str,
    record_count: int,
    accepted_count: int,
    diagnostics: dict[str, Any],
    payload: dict[str, Any],
) -> None:
    checkpoint_key = f"{order_window[0].isoformat()}:{order_window[1].isoformat()}"
    supabase.upsert_many(
        "source_sync_checkpoints",
        [
            {
                "source_system": "vinosmith",
                "resource_name": RESOURCE,
                "checkpoint_key": checkpoint_key,
                "status": "completed",
                "requested_start_date": order_window[0].isoformat(),
                "requested_end_date": order_window[1].isoformat(),
                "completed_through": fetched_at.isoformat(),
                "cursor_data": {
                    "endpoint": "/supplier_orders",
                    "response_id": response_id,
                    "record_count": record_count,
                    "accepted_count": accepted_count,
                },
                "last_source_sync_run_id": source_sync_run_id,
                "diagnostics": {"returned_metadata": returned_metadata(payload), **diagnostics},
                "last_synced_at": fetched_at.isoformat(),
            }
        ],
        on_conflict="source_system,resource_name,checkpoint_key",
    )


class SupabaseRestClient:
    def __init__(self, url: str, key: str) -> None:
        if not url or not key:
            raise RuntimeError("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.")
        self.url = url.rstrip("/")
        self.key = key

    @classmethod
    def from_env(cls) -> "SupabaseRestClient":
        return cls(os.getenv("SUPABASE_URL", ""), os.getenv("SUPABASE_SERVICE_ROLE_KEY", ""))

    def insert_one(self, table: str, payload: dict[str, Any]) -> dict[str, Any]:
        rows = self.request("POST", table, payload, prefer="return=representation")
        if not rows:
            raise RuntimeError(f"Supabase insert into {table} returned no data")
        return rows[0]

    def update_by_id(self, table: str, row_id: str, payload: dict[str, Any]) -> None:
        self.request("PATCH", table, payload, query={"id": f"eq.{row_id}"}, prefer="return=minimal")

    def upsert_many(
        self,
        table: str,
        rows: list[dict[str, Any]],
        on_conflict: str,
        batch_size: int = 500,
    ) -> None:
        cleaned_rows = dedupe_payloads_for_conflict([row for row in rows if row], on_conflict=on_conflict)
        for start in range(0, len(cleaned_rows), batch_size):
            self.request(
                "POST",
                table,
                cleaned_rows[start : start + batch_size],
                query={"on_conflict": on_conflict},
                prefer="resolution=merge-duplicates,return=minimal",
            )

    def request(
        self,
        method: str,
        table: str,
        payload: Any | None,
        query: dict[str, str] | None = None,
        prefer: str = "return=minimal",
    ) -> list[dict[str, Any]]:
        query_string = f"?{urlencode(query or {})}" if query else ""
        data = None if payload is None else json.dumps(payload).encode("utf-8")
        request = Request(
            f"{self.url}/rest/v1/{table}{query_string}",
            data=data,
            method=method,
            headers={
                "apikey": self.key,
                "Authorization": f"Bearer {self.key}",
                "Content-Type": "application/json",
                "Accept": "application/json",
                "Prefer": prefer,
            },
        )
        try:
            with urlopen(request, timeout=90) as response:
                body = response.read().decode("utf-8")
                return json.loads(body) if body else []
        except HTTPError as exc:
            body = exc.read(2000).decode("utf-8", "replace")
            raise RuntimeError(f"Supabase {method} {table} failed: status={exc.code} body={body}") from exc


def clean_value(value: Any) -> Any:
    return None if value is None or str(value).strip() == "" else value


def default_output_dir() -> Path:
    stamp = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
    return OUTPUT_ROOT / stamp


def now_iso() -> str:
    return datetime.now(timezone.utc).isoformat()


def print_summary(summaries: list[dict[str, Any]], output_dir: Path) -> None:
    for summary in summaries:
        error = f", error={summary['error']}" if summary.get("error") else ""
        print(
            f"{summary['resource']} {summary['requested_window']}: status={summary['status']}, "
            f"records={summary['record_count']}, accepted={summary['accepted_count']}{error}"
        )
    print(f"Raw output: {output_dir.relative_to(ROOT)}")
    print("Supabase writes: enabled via REST")


if __name__ == "__main__":
    raise SystemExit(main())
