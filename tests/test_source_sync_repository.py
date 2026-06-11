from __future__ import annotations

from datetime import date, datetime, timezone
import unittest

from stem_order.supabase_repository import (
    SupabaseRepository,
    vinosmith_inventory_snapshot_payload,
    vinosmith_order_header_payload,
    vinosmith_order_line_payload,
    vinosmith_price_payload,
    vinosmith_wine_payload,
)


class FakeResult:
    def __init__(self, data):
        self.data = data


class FakeQuery:
    def __init__(self, client, table_name):
        self.client = client
        self.table_name = table_name
        self.operation = None
        self.payload = None
        self.on_conflict = None
        self.filters = []

    def insert(self, payload):
        self.operation = "insert"
        self.payload = payload
        return self

    def update(self, payload):
        self.operation = "update"
        self.payload = payload
        return self

    def upsert(self, payload, on_conflict=None):
        self.operation = "upsert"
        self.payload = payload
        self.on_conflict = on_conflict
        return self

    def eq(self, column, value):
        self.filters.append((column, value))
        return self

    def execute(self):
        self.client.calls.append(
            {
                "table": self.table_name,
                "operation": self.operation,
                "payload": self.payload,
                "on_conflict": self.on_conflict,
                "filters": self.filters,
            }
        )
        if isinstance(self.payload, list):
            rows = []
            for index, payload in enumerate(self.payload):
                data = dict(payload or {})
                data.setdefault("id", f"fake-id-{index}")
                rows.append(data)
            return FakeResult(rows)
        data = dict(self.payload or {})
        data.setdefault("id", "fake-id")
        return FakeResult([data])


class FakeClient:
    def __init__(self):
        self.calls = []

    def table(self, table_name):
        return FakeQuery(self, table_name)


class SourceSyncRepositoryTests(unittest.TestCase):
    def test_create_source_sync_run_payload(self):
        client = FakeClient()
        repo = SupabaseRepository(client)

        saved = repo.create_source_sync_run(
            "vinosmith",
            "historical_backfill",
            requested_start_date=date(2026, 5, 1),
            requested_end_date="2026-05-31",
            worker_name="vinosmith-rescue",
            parameters={"endpoint": "supplier_orders"},
        )

        call = client.calls[-1]
        self.assertEqual(call["table"], "source_sync_runs")
        self.assertEqual(call["operation"], "insert")
        self.assertEqual(saved["status"], "running")
        self.assertEqual(call["payload"]["source_system"], "vinosmith")
        self.assertEqual(call["payload"]["sync_type"], "historical_backfill")
        self.assertEqual(call["payload"]["requested_start_date"], "2026-05-01")
        self.assertEqual(call["payload"]["requested_end_date"], "2026-05-31")
        self.assertEqual(call["payload"]["parameters"], {"endpoint": "supplier_orders"})

    def test_create_source_sync_run_rejects_unknown_source(self):
        repo = SupabaseRepository(FakeClient())

        with self.assertRaisesRegex(ValueError, "Unsupported source system"):
            repo.create_source_sync_run("spreadsheet-party", "discovery")

    def test_record_source_api_response_payload(self):
        client = FakeClient()
        repo = SupabaseRepository(client)
        fetched_at = datetime(2026, 6, 11, 18, 30, tzinfo=timezone.utc)

        repo.record_source_api_response(
            "quickbooks_desktop",
            "InvoiceQueryRq",
            source_sync_run_id="run-1",
            request_method="QBXML",
            request_identifier="invoice-window",
            requested_params={"from": "2026-06-01"},
            returned_metadata={"statusCode": 0},
            response_status=200,
            content_type="application/xml",
            byte_size=2048,
            checksum="abc123",
            raw_storage_path="source-files/quickbooks/invoice.xml",
            record_count=12,
            fetched_at=fetched_at,
        )

        payload = client.calls[-1]["payload"]
        self.assertEqual(client.calls[-1]["table"], "source_api_responses")
        self.assertEqual(payload["source_system"], "quickbooks_desktop")
        self.assertEqual(payload["endpoint"], "InvoiceQueryRq")
        self.assertEqual(payload["request_method"], "QBXML")
        self.assertEqual(payload["fetched_at"], "2026-06-11T18:30:00+00:00")
        self.assertEqual(payload["record_count"], 12)

    def test_upsert_checkpoint_uses_compound_conflict_key(self):
        client = FakeClient()
        repo = SupabaseRepository(client)

        repo.upsert_source_sync_checkpoint(
            "vinosmith",
            "supplier_orders",
            "2026-05",
            status="completed",
            last_source_sync_run_id="run-1",
        )

        call = client.calls[-1]
        self.assertEqual(call["table"], "source_sync_checkpoints")
        self.assertEqual(call["operation"], "upsert")
        self.assertEqual(call["on_conflict"], "source_system,resource_name,checkpoint_key")
        self.assertEqual(call["payload"]["status"], "completed")
        self.assertEqual(call["payload"]["last_source_sync_run_id"], "run-1")

    def test_upsert_product_source_link_clamps_confidence(self):
        client = FakeClient()
        repo = SupabaseRepository(client)

        repo.upsert_product_source_link(
            "quickbooks_desktop",
            "item",
            "80000001-123456789",
            source_code="QB-001",
            source_name="Stem Item",
            match_status="candidate",
            confidence=2.5,
        )

        payload = client.calls[-1]["payload"]
        self.assertEqual(client.calls[-1]["on_conflict"], "source_system,source_entity_type,source_id")
        self.assertEqual(payload["confidence"], 1)
        self.assertEqual(payload["match_status"], "candidate")

    def test_upsert_vinosmith_wines_maps_cache_and_source_link_rows(self):
        client = FakeClient()
        repo = SupabaseRepository(client)

        repo.upsert_vinosmith_wines(
            [
                {
                    "id": "wine-1",
                    "code": "ABC123",
                    "name": "Example Wine",
                    "vintage": "2022",
                    "unit_set": "12",
                    "importer": {"id": "supplier-1", "name": "Supplier"},
                    "producer": {"name": "Producer"},
                    "active": True,
                    "core": False,
                }
            ],
            raw_response_id="response-1",
        )

        wine_call = client.calls[-2]
        link_call = client.calls[-1]
        self.assertEqual(wine_call["table"], "vinosmith_wines")
        self.assertEqual(wine_call["operation"], "upsert")
        self.assertEqual(wine_call["on_conflict"], "wine_id")
        self.assertEqual(wine_call["payload"][0]["wine_id"], "wine-1")
        self.assertEqual(wine_call["payload"][0]["unit_set"], 12)
        self.assertEqual(wine_call["payload"][0]["importer_name"], "Supplier")
        self.assertEqual(wine_call["payload"][0]["raw_response_id"], "response-1")
        self.assertEqual(link_call["table"], "product_source_links")
        self.assertEqual(link_call["payload"][0]["source_system"], "vinosmith")
        self.assertEqual(link_call["payload"][0]["source_entity_type"], "wine")

    def test_vinosmith_payload_helpers_map_orders_inventory_and_prices(self):
        wine = {"id": "wine-1", "code": "ABC", "name": "Wine", "unit_set": "6"}
        price_record = {"price": {"id": "price-1", "price_cents": "1999", "default": "true"}, "wine": wine}
        inventory_record = {
            "wine": wine,
            "warehouse": {"id": "wh-1", "name": "Stem"},
            "inventory": {"available": "10.5", "end_of_stock": "false"},
        }
        order = {
            "account": {"id": "acct-1", "name": "Account"},
            "user": {"id": "user-1", "email": "rep@example.com", "full_name": "Rep"},
            "order": {"id": "order-1"},
            "supplier_order": {
                "id": "supplier-order-1",
                "delivery_at": "2026-05-10T12:00:00Z",
                "delivery_status": "sent-to-warehouse",
                "warehouse": {"id": "wh-1", "name": "Stem"},
                "total_cents": "24000",
            },
        }
        line = {
            "id": "line-1",
            "wine": wine,
            "quantity": "2",
            "price_cents": "12000",
            "total_cents": "24000",
        }

        self.assertEqual(vinosmith_wine_payload(wine)["wine_id"], "wine-1")
        self.assertEqual(vinosmith_price_payload(price_record)["is_default"], True)
        self.assertEqual(vinosmith_inventory_snapshot_payload(inventory_record)["available"], 10.5)
        self.assertEqual(vinosmith_inventory_snapshot_payload(inventory_record)["end_of_stock"], False)
        self.assertEqual(vinosmith_order_header_payload(order)["supplier_order_id"], "supplier-order-1")
        self.assertEqual(vinosmith_order_line_payload(line, "supplier-order-1")["quantity_bottles"], 12)


if __name__ == "__main__":
    unittest.main()
