from __future__ import annotations

from datetime import date, datetime, timezone
import unittest

from stem_order.supabase_repository import SupabaseRepository


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


if __name__ == "__main__":
    unittest.main()
