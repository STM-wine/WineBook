from __future__ import annotations

from datetime import datetime, timezone
import json
from pathlib import Path
import unittest
from unittest.mock import Mock, patch

from scripts.sync_vinosmith_rescue import sync_resource
from stem_order.vinosmith_api import VinosmithFetchResult


class VinosmithPriceSnapshotSyncTests(unittest.TestCase):
    def test_only_full_price_fetch_retires_unseen_prices(self):
        fetched_at = datetime(2026, 11, 26, tzinfo=timezone.utc)
        payload = {"data": {"prices": [{"price": {"id": 4673547, "active": True}, "wine": {"id": 861917}}]}}
        client = Mock()
        client.fetch_resource.return_value = VinosmithFetchResult(
            resource="prices", endpoint="/prices", requested_params={}, status=200,
            status_text="OK", content_type="application/json", fetched_at=fetched_at,
            body=json.dumps(payload).encode(),
        )
        repo = Mock()
        repo.disable_unseen_vinosmith_prices.return_value = 1

        with (
            patch("scripts.sync_vinosmith_rescue.save_raw_payload", return_value=None),
            patch("scripts.sync_vinosmith_rescue.record_api_response", return_value="response-1"),
            patch("scripts.sync_vinosmith_rescue.write_resource_records"),
            patch("scripts.sync_vinosmith_rescue.upsert_checkpoint", return_value="latest"),
            patch("scripts.sync_vinosmith_rescue.print_progress"),
        ):
            for extra_params in ({}, {"prices": {"updated_since": "2026-11-25"}}):
                repo.disable_unseen_vinosmith_prices.reset_mock()
                sync_resource(
                    client=client, repo=repo, source_sync_run_id="run-1", resource="prices",
                    output_dir=Path("tmp/vinosmith-rescue/test"), order_window=None,
                    account_id=None, extra_query_params=extra_params, delivery_statuses=(),
                    write_normalized=True,
                )
                if extra_params:
                    repo.disable_unseen_vinosmith_prices.assert_not_called()
                else:
                    repo.disable_unseen_vinosmith_prices.assert_called_once_with(fetched_at, 1)


if __name__ == "__main__":
    unittest.main()
