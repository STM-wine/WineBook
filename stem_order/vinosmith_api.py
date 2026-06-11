"""Small Vinosmith Distributor API client and normalization helpers."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import date, datetime, timezone
import json
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen


VINOSMITH_DISTRIBUTOR_BASE_URL = "https://vinosmith.com/api/distributor"
VINOSMITH_SUPPLIER_ORDER_MAX_WINDOW_DAYS = 31
DEFAULT_VINOSMITH_DELIVERY_STATUSES = ("sent-to-warehouse",)
MAX_RESPONSE_BYTES = 100 * 1024 * 1024

VINOSMITH_DISTRIBUTOR_ENDPOINTS = {
    "supplier_orders": "/supplier_orders",
    "wines": "/wines",
    "prices": "/prices",
    "inventory": "/inventory",
}


@dataclass(frozen=True)
class VinosmithFetchResult:
    resource: str
    endpoint: str
    requested_params: dict[str, Any]
    status: int | None
    status_text: str
    content_type: str
    fetched_at: datetime
    body: bytes | None = None
    error: str | None = None

    @property
    def ok(self) -> bool:
        return self.status == 200 and self.body is not None and self.error is None

    @property
    def byte_size(self) -> int:
        return len(self.body or b"")

    def json_payload(self) -> dict[str, Any]:
        if not self.body:
            return {}
        try:
            payload = json.loads(self.body)
        except json.JSONDecodeError:
            return {}
        return payload if isinstance(payload, dict) else {}


class VinosmithDistributorClient:
    def __init__(
        self,
        token: str,
        base_url: str = VINOSMITH_DISTRIBUTOR_BASE_URL,
        timeout: int = 60,
        user_agent: str = "Stem-WineBook-Vinosmith-Rescue/1.0",
    ) -> None:
        token = token.strip()
        if not token:
            raise ValueError("Missing VINOSMITH_API_TOKEN for Vinosmith Distributor API access.")
        self.token = token
        self.base_url = base_url.rstrip("/")
        self.timeout = timeout
        self.user_agent = user_agent

    def fetch_resource(
        self,
        resource: str,
        params: dict[str, Any] | None = None,
    ) -> VinosmithFetchResult:
        if resource not in VINOSMITH_DISTRIBUTOR_ENDPOINTS:
            raise ValueError(f"Unsupported Vinosmith resource: {resource}")

        requested_params = {key: value for key, value in (params or {}).items() if value not in (None, "")}
        url = f"{self.base_url}{VINOSMITH_DISTRIBUTOR_ENDPOINTS[resource]}"
        if requested_params:
            url = f"{url}?{urlencode(requested_params)}"

        request = Request(
            url,
            method="GET",
            headers={
                "Accept": "application/json",
                "Authorization": f"Bearer {self.token}",
                "User-Agent": self.user_agent,
            },
        )

        fetched_at = datetime.now(timezone.utc)
        try:
            with urlopen(request, timeout=self.timeout) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
                if len(body) > MAX_RESPONSE_BYTES:
                    raise RuntimeError(f"response exceeded {MAX_RESPONSE_BYTES} bytes")
                json.loads(body)
                return VinosmithFetchResult(
                    resource=resource,
                    endpoint=VINOSMITH_DISTRIBUTOR_ENDPOINTS[resource],
                    requested_params=requested_params,
                    status=response.status,
                    status_text=response.reason or "",
                    content_type=response.headers.get("Content-Type", ""),
                    fetched_at=fetched_at,
                    body=body,
                )
        except HTTPError as exc:
            body = exc.read(MAX_RESPONSE_BYTES)
            return VinosmithFetchResult(
                resource=resource,
                endpoint=VINOSMITH_DISTRIBUTOR_ENDPOINTS[resource],
                requested_params=requested_params,
                status=exc.code,
                status_text=exc.reason or "",
                content_type=exc.headers.get("Content-Type", "") if exc.headers else "",
                fetched_at=fetched_at,
                body=body,
                error=f"HTTP {exc.code}",
            )
        except (json.JSONDecodeError, RuntimeError, TimeoutError, URLError) as exc:
            return VinosmithFetchResult(
                resource=resource,
                endpoint=VINOSMITH_DISTRIBUTOR_ENDPOINTS[resource],
                requested_params=requested_params,
                status=None,
                status_text="",
                content_type="",
                fetched_at=fetched_at,
                error=type(exc).__name__,
            )


def validate_supplier_order_window(start_value: str, end_value: str) -> tuple[date, date]:
    start_date = date.fromisoformat(start_value)
    end_date = date.fromisoformat(end_value)
    if end_date < start_date:
        raise ValueError("delivery end date must be on or after the start date")
    if (end_date - start_date).days > VINOSMITH_SUPPLIER_ORDER_MAX_WINDOW_DAYS:
        raise ValueError(
            f"supplier_orders windows may not exceed {VINOSMITH_SUPPLIER_ORDER_MAX_WINDOW_DAYS} days"
        )
    return start_date, end_date


def records_for_resource(resource: str, payload: dict[str, Any]) -> list[dict[str, Any]]:
    data = payload.get("data")
    if not isinstance(data, dict):
        return []
    records = data.get(resource)
    return records if isinstance(records, list) else []


def returned_metadata(payload: dict[str, Any]) -> dict[str, Any]:
    meta = payload.get("meta")
    return meta if isinstance(meta, dict) else {}


def filter_supplier_orders_by_delivery_window(
    supplier_orders: list[dict[str, Any]],
    start_date: date,
    end_date: date,
) -> list[dict[str, Any]]:
    start_value = start_date.isoformat()
    end_value = end_date.isoformat()
    filtered = []
    for order in supplier_orders:
        supplier_order = order.get("supplier_order")
        if not isinstance(supplier_order, dict):
            continue
        delivery_date = str(supplier_order.get("delivery_at") or "")[:10]
        if start_value <= delivery_date <= end_value:
            filtered.append(order)
    return filtered


def filter_supplier_orders_by_delivery_status(
    supplier_orders: list[dict[str, Any]],
    statuses: tuple[str, ...] = DEFAULT_VINOSMITH_DELIVERY_STATUSES,
) -> list[dict[str, Any]]:
    allowed = set(statuses)
    return [
        order
        for order in supplier_orders
        if str((order.get("supplier_order") or {}).get("delivery_status") or "") in allowed
    ]


def supplier_order_line_bottle_quantity(line_item: dict[str, Any]) -> float:
    quantity = numeric_value(line_item.get("quantity"), 0) or 0
    wine = line_item.get("wine") if isinstance(line_item.get("wine"), dict) else {}
    unit_set = numeric_value(wine.get("unit_set"), 1) or 1
    return quantity * unit_set


def numeric_value(value: Any, default: float | None = None) -> float | None:
    if value in (None, ""):
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def write_raw_json(destination: Path, payload: dict[str, Any]) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
