"""Download read-only samples from Vinosmith's Distributor API.

The script only sends GET requests, loads VINOSMITH_API_TOKEN from the
repository-root .env.local file, and writes raw responses under tmp/vinosmith/.
"""

from __future__ import annotations

import argparse
from dataclasses import asdict, dataclass
from datetime import date
import json
import os
from pathlib import Path
import sys
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env.local"
BASE_URL = "https://vinosmith.com/api/distributor"
OUTPUT_DIR = ROOT / "tmp" / "vinosmith"
MAX_RESPONSE_BYTES = 100 * 1024 * 1024

ENDPOINTS = {
    "supplier_orders": {
        "path": "/supplier_orders",
        "filename": "supplier-orders-sample.json",
    },
    "wines": {
        "path": "/wines",
        "filename": "wines-sample.json",
    },
    "prices": {
        "path": "/prices",
        "filename": "prices-sample.json",
    },
    "inventory": {
        "path": "/inventory",
        "filename": "inventory-sample.json",
    },
}


@dataclass
class EndpointResult:
    endpoint: str
    path: str
    status: int | None
    content_type: str
    saved_file: str | None
    response_bytes: int
    error: str | None = None


def load_env_file(path: Path) -> None:
    if not path.exists():
        return
    for raw_line in path.read_text(encoding="utf-8").splitlines():
        line = raw_line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        value = value.strip().strip("\"'")
        if key and key not in os.environ:
            os.environ[key] = value


def validated_window(start_value: str, end_value: str) -> tuple[date, date]:
    start_date = date.fromisoformat(start_value)
    end_date = date.fromisoformat(end_value)
    if end_date < start_date:
        raise ValueError("delivery end date must be on or after the start date")
    if (end_date - start_date).days > 31:
        raise ValueError("supplier_orders discovery windows may not exceed 31 days")
    return start_date, end_date


def fetch_json(
    endpoint: str,
    path: str,
    token: str,
    query: dict[str, str] | None = None,
) -> tuple[EndpointResult, bytes | None]:
    url = f"{BASE_URL}{path}"
    if query:
        url = f"{url}?{urlencode(query)}"
    request = Request(
        url,
        method="GET",
        headers={
            "Accept": "application/json",
            "Authorization": f"Bearer {token}",
            "User-Agent": "Stem-WineBook-Vinosmith-Distributor-Discovery/1.0",
        },
    )

    try:
        with urlopen(request, timeout=60) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise RuntimeError(f"response exceeded {MAX_RESPONSE_BYTES} bytes")
            content_type = response.headers.get("Content-Type", "")
            json.loads(body)
            return (
                EndpointResult(
                    endpoint=endpoint,
                    path=path,
                    status=response.status,
                    content_type=content_type,
                    saved_file=None,
                    response_bytes=len(body),
                ),
                body,
            )
    except HTTPError as exc:
        return (
            EndpointResult(
                endpoint=endpoint,
                path=path,
                status=exc.code,
                content_type=exc.headers.get("Content-Type", "") if exc.headers else "",
                saved_file=None,
                response_bytes=0,
                error=f"HTTP {exc.code}",
            ),
            None,
        )
    except (json.JSONDecodeError, URLError, TimeoutError, RuntimeError) as exc:
        return (
            EndpointResult(
                endpoint=endpoint,
                path=path,
                status=None,
                content_type="",
                saved_file=None,
                response_bytes=0,
                error=type(exc).__name__,
            ),
            None,
        )


def write_json(path: Path, body: bytes) -> None:
    payload = json.loads(body)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--delivery-start-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--delivery-end-date", required=True, help="YYYY-MM-DD")
    parser.add_argument("--account-id", help="Optional Vinosmith account ID")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        start_date, end_date = validated_window(
            args.delivery_start_date,
            args.delivery_end_date,
        )
    except ValueError as exc:
        print(f"Invalid date window: {exc}", file=sys.stderr)
        return 2

    load_env_file(ENV_PATH)
    token = os.getenv("VINOSMITH_API_TOKEN", "").strip()
    if not token:
        print("Missing VINOSMITH_API_TOKEN in repository-root .env.local.", file=sys.stderr)
        return 2

    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    results: list[EndpointResult] = []

    for endpoint, config in ENDPOINTS.items():
        query = None
        if endpoint == "supplier_orders":
            query = {
                "delivery_start_date": start_date.isoformat(),
                "delivery_end_date": end_date.isoformat(),
            }
            if args.account_id:
                query["account_id"] = args.account_id

        result, body = fetch_json(endpoint, config["path"], token, query)
        if body is not None and result.status == 200:
            destination = OUTPUT_DIR / config["filename"]
            write_json(destination, body)
            result.saved_file = str(destination.relative_to(ROOT))
        results.append(result)

    summary = {
        "base_url": BASE_URL,
        "method": "GET",
        "authentication": "Bearer token from repository-root .env.local",
        "supplier_orders_window": {
            "delivery_start_date": start_date.isoformat(),
            "delivery_end_date": end_date.isoformat(),
            "account_id_supplied": bool(args.account_id),
        },
        "results": [asdict(result) for result in results],
    }
    supplier_orders_path = OUTPUT_DIR / ENDPOINTS["supplier_orders"]["filename"]
    if supplier_orders_path.exists():
        supplier_orders_payload = json.loads(supplier_orders_path.read_text(encoding="utf-8"))
        returned_meta = supplier_orders_payload.get("meta")
        if isinstance(returned_meta, dict):
            summary["supplier_orders_returned_meta"] = returned_meta
            returned_start = str(returned_meta.get("delivery_start_date") or "")[:10]
            returned_end = str(returned_meta.get("delivery_end_date") or "")[:10]
            summary["supplier_orders_window_matches_request"] = (
                returned_start == start_date.isoformat()
                and returned_end == end_date.isoformat()
            )
    summary_path = OUTPUT_DIR / "discovery.json"
    summary_path.write_text(json.dumps(summary, indent=2, sort_keys=True) + "\n", encoding="utf-8")

    for result in results:
        saved = f", saved {result.saved_file}" if result.saved_file else ""
        error = f", {result.error}" if result.error else ""
        print(f"{result.endpoint}: {result.status}{saved}{error}")
    print(f"Summary: {summary_path.relative_to(ROOT)}")

    return 0 if all(result.status == 200 for result in results) else 1


if __name__ == "__main__":
    raise SystemExit(main())
