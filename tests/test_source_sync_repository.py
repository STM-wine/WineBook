from __future__ import annotations

from datetime import date, datetime, timezone
import unittest

from stem_order.supabase_repository import (
    SupabaseRepository,
    dedupe_payloads_for_conflict,
    execute_with_transient_retries,
    is_transient_http_error,
    normalized_vinosmith_vintage,
    vinosmith_account_contact_payload,
    vinosmith_account_payload,
    vinosmith_account_sales_rep_payload,
    vinosmith_inventory_snapshot_payload,
    vinosmith_order_header_payload,
    vinosmith_order_line_payload,
    vinosmith_prearrival_payload,
    vinosmith_price_payload,
    vinosmith_user_payload,
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

    def test_vinosmith_payload_helpers_map_orders_inventory_prices_and_prearrivals(self):
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
        line_payload = vinosmith_order_line_payload(line, "supplier-order-1")
        self.assertEqual(line_payload["quantity_bottles"], 2)
        self.assertAlmostEqual(line_payload["quantity_cases"], 2 / 6)
        prearrival_payload = vinosmith_prearrival_payload(
            {
                "wine": wine,
                "prearrival": {
                    "quantity": "20.0",
                    "expected_date": "2026-08-01",
                    "notes": "More coming",
                    "external_identifier1": "pre-1",
                    "created_at": "2026-06-01T12:00:00Z",
                },
            },
            raw_response_id="response-3",
        )
        self.assertEqual(prearrival_payload["wine_id"], "wine-1")
        self.assertEqual(prearrival_payload["quantity"], 20)
        self.assertEqual(prearrival_payload["expected_date"], "2026-08-01")
        self.assertEqual(prearrival_payload["external_identifier_1"], "pre-1")
        self.assertEqual(prearrival_payload["raw_response_id"], "response-3")

    def test_upsert_vinosmith_supplier_orders_hydrates_line_wines(self):
        client = FakeClient()
        repo = SupabaseRepository(client)

        repo.upsert_vinosmith_supplier_orders(
            [
                {
                    "account": {"id": "acct-1", "name": "Account"},
                    "user": {"id": "user-1", "email": "rep@example.com", "full_name": "Rep"},
                    "order": {"id": "order-1"},
                    "supplier_order": {
                        "id": "supplier-order-1",
                        "delivery_at": "2026-05-10T12:00:00Z",
                        "delivery_status": "sent-to-warehouse",
                        "total_cents": "24000",
                    },
                    "line_items": [
                        {
                            "id": "line-1",
                            "wine": {"id": "wine-1", "code": "ABC", "name": "Wine", "unit_set": "6"},
                            "quantity": "2",
                            "price_cents": "12000",
                            "total_cents": "24000",
                        }
                    ],
                }
            ],
            raw_response_id="response-1",
        )

        self.assertEqual(client.calls[0]["table"], "vinosmith_order_headers")
        self.assertEqual(client.calls[1]["table"], "vinosmith_wines")
        self.assertEqual(client.calls[1]["payload"][0]["wine_id"], "wine-1")
        self.assertEqual(client.calls[1]["payload"][0]["raw_response_id"], "response-1")
        self.assertEqual(client.calls[2]["table"], "product_source_links")
        self.assertEqual(client.calls[3]["table"], "vinosmith_order_lines")

    def test_vinosmith_account_user_contact_and_sales_rep_payloads(self):
        account_payload = vinosmith_account_payload(
            {
                "id": 3430,
                "name": "1760 Restaurant",
                "code": "1760",
                "status": "active",
                "kind": "Restaurant",
                "license_expiration": "2027-12-31",
                "shipping_lat": "37.793139",
                "shipping_lng": "-122.421159",
                "created_at": "2024-01-01T00:00:00Z",
                "updated_at": "2026-02-27T19:22:30.664+00:00",
            },
            raw_response_id="response-1",
        )
        user_payload = vinosmith_user_payload(
            {
                "user_id": 123,
                "first_name": "Taylor",
                "last_name": "Sorensen",
                "email": "taylor@example.com",
                "active": "true",
                "role": "sales_rep",
            },
            raw_response_id="response-2",
        )
        contact_payload = vinosmith_account_contact_payload(
            {
                "id": 12920,
                "first_name": "Travis",
                "last_name": "Hip",
                "title": "Buyer",
                "email": "buyer@example.com",
                "phone": "555-0101",
                "mobile_phone": "555-0102",
                "invoices": False,
                "buyer": True,
                "primary": "true",
                "birth_date": "1980-01-01",
            },
            account_id="3430",
            raw_response_id="response-3",
        )
        sales_rep_payload = vinosmith_account_sales_rep_payload(
            {
                "user_id": 475,
                "first_name": "Brooke",
                "last_name": "Page",
                "email": "rep@example.com",
            },
            account_id="3430",
            raw_response_id="response-4",
        )

        self.assertEqual(account_payload["account_id"], "3430")
        self.assertEqual(account_payload["license_expiration"], "2027-12-31")
        self.assertEqual(account_payload["shipping_lat"], 37.793139)
        self.assertEqual(account_payload["raw_response_id"], "response-1")
        self.assertEqual(user_payload["user_id"], "123")
        self.assertEqual(user_payload["full_name"], "Taylor Sorensen")
        self.assertEqual(user_payload["active"], True)
        self.assertEqual(user_payload["raw_response_id"], "response-2")
        self.assertEqual(contact_payload["contact_id"], "12920")
        self.assertEqual(contact_payload["account_id"], "3430")
        self.assertEqual(contact_payload["full_name"], "Travis Hip")
        self.assertEqual(contact_payload["buyer"], True)
        self.assertEqual(contact_payload["primary_contact"], True)
        self.assertEqual(contact_payload["birth_date"], "1980-01-01")
        self.assertEqual(sales_rep_payload["account_id"], "3430")
        self.assertEqual(sales_rep_payload["user_id"], "475")
        self.assertEqual(sales_rep_payload["full_name"], "Brooke Page")

    def test_upsert_vinosmith_accounts_users_prearrivals_and_account_details(self):
        client = FakeClient()
        repo = SupabaseRepository(client)

        repo.upsert_vinosmith_accounts([{"id": 3430, "name": "1760 Restaurant"}], raw_response_id="response-1")
        repo.upsert_vinosmith_users([{"user_id": 123, "email": "rep@example.com"}], raw_response_id="response-2")
        repo.upsert_vinosmith_prearrivals(
            [{"wine": {"id": "wine-1"}, "prearrival": {"quantity": "10.0", "expected_date": "2026-08-01"}}],
            raw_response_id="response-3",
        )
        repo.upsert_vinosmith_account_details(
            [
                {
                    "id": 3430,
                    "name": "1760 Restaurant",
                    "contacts": [{"id": 12920, "first_name": "Travis", "buyer": True}],
                    "sales_reps": [{"user_id": 475, "first_name": "Brooke"}],
                }
            ],
            raw_response_id="response-4",
        )

        account_call = client.calls[-8]
        user_call = client.calls[-7]
        prearrival_call = client.calls[-4]
        detail_account_call = client.calls[-3]
        contact_call = client.calls[-2]
        sales_rep_call = client.calls[-1]
        self.assertEqual(account_call["table"], "vinosmith_accounts")
        self.assertEqual(account_call["on_conflict"], "account_id")
        self.assertEqual(account_call["payload"][0]["account_id"], "3430")
        self.assertEqual(user_call["table"], "vinosmith_users")
        self.assertEqual(user_call["on_conflict"], "user_id")
        self.assertEqual(user_call["payload"][0]["user_id"], "123")
        self.assertEqual(prearrival_call["table"], "vinosmith_prearrivals")
        self.assertEqual(prearrival_call["on_conflict"], "prearrival_key")
        self.assertEqual(prearrival_call["payload"][0]["wine_id"], "wine-1")
        self.assertEqual(detail_account_call["table"], "vinosmith_accounts")
        self.assertEqual(detail_account_call["payload"][0]["raw_response_id"], "response-4")
        self.assertEqual(contact_call["table"], "vinosmith_account_contacts")
        self.assertEqual(contact_call["on_conflict"], "contact_id")
        self.assertEqual(contact_call["payload"][0]["contact_id"], "12920")
        self.assertEqual(sales_rep_call["table"], "vinosmith_account_sales_reps")
        self.assertEqual(sales_rep_call["on_conflict"], "account_id,user_id")
        self.assertEqual(sales_rep_call["payload"][0]["user_id"], "475")

    def test_normalized_vinosmith_vintage_prefers_name_year_and_nv_over_bad_source_value(self):
        self.assertEqual(
            normalized_vinosmith_vintage(
                {
                    "name": "Chateau Tronquoy-Lalande St Estephe Red 2019 6/750ml",
                    "vintage": "2079",
                },
                current_year=2026,
            ),
            "2019",
        )
        self.assertEqual(
            normalized_vinosmith_vintage(
                {
                    "name": "Chartogne Taillet Cuvee Ste Anne NV 12/750ml",
                    "vintage": "2047",
                },
                current_year=2026,
            ),
            "NV",
        )
        self.assertIsNone(
            normalized_vinosmith_vintage(
                {
                    "name": "Mystery Wine 12/750ml",
                    "vintage": "2079",
                },
                current_year=2026,
            )
        )
        self.assertEqual(
            normalized_vinosmith_vintage(
                {
                    "name": "Legitimate Future Release 12/750ml",
                    "vintage": "2027",
                },
                current_year=2026,
            ),
            "2027",
        )
        self.assertEqual(
            normalized_vinosmith_vintage(
                {
                    "name": "Masseria Cuturi 1881 Negroamaro Zacinto 2017 12/750ml",
                    "vintage": "1881",
                },
                current_year=2026,
            ),
            "2017",
        )
        self.assertEqual(
            normalized_vinosmith_vintage(
                {
                    "name": "Illahe 1899 Pinot Noir 2021 6/750ml",
                    "vintage": "1899",
                },
                current_year=2026,
            ),
            "2021",
        )
        self.assertIsNone(
            normalized_vinosmith_vintage(
                {
                    "name": "Benten Sawane Junmai Ginjo Sake 6/1800ml",
                    "vintage": "1800",
                },
                current_year=2026,
            )
        )

    def test_dedupe_payloads_for_conflict_keeps_last_duplicate_key(self):
        payloads = [
            {"wine_id": "wine-1", "name": "First"},
            {"wine_id": "wine-2", "name": "Second"},
            {"wine_id": "wine-1", "name": "Updated"},
            {"wine_id": None, "name": "No key"},
        ]

        deduped = dedupe_payloads_for_conflict(payloads, on_conflict="wine_id")

        self.assertEqual(
            deduped,
            [
                {"wine_id": None, "name": "No key"},
                {"wine_id": "wine-1", "name": "Updated"},
                {"wine_id": "wine-2", "name": "Second"},
            ],
        )

    def test_transient_retry_helper_retries_protocol_disconnects(self):
        class RemoteProtocolError(RuntimeError):
            __module__ = "httpx"

        attempts = {"count": 0}

        def operation():
            attempts["count"] += 1
            if attempts["count"] == 1:
                raise RemoteProtocolError("ConnectionTerminated")
            return "ok"

        self.assertTrue(is_transient_http_error(RemoteProtocolError("ConnectionTerminated")))
        self.assertEqual(execute_with_transient_retries(operation, attempts=2, base_delay=0), "ok")
        self.assertEqual(attempts["count"], 2)


if __name__ == "__main__":
    unittest.main()
