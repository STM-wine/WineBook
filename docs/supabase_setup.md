# Supabase Setup

## Project

- Project URL: `https://afefwnhchoqabcwjpwby.supabase.co`
- Schema migrations:
  - `supabase/migrations/001_initial_ordering_schema.sql`
  - `supabase/migrations/002_manual_recommendation_ingest.sql`
  - `supabase/migrations/003_manual_po_draft_ingest.sql`
  - `supabase/migrations/004_buyer_recommendation_fields.sql`

Do not commit database passwords, service-role keys, or `.env` files. If the database password has been shared outside a password manager, rotate it in Supabase before production use.

## Local Environment

Create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Fill in:

```bash
SUPABASE_URL=https://afefwnhchoqabcwjpwby.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

The anon key is safe for browser/client contexts. The service-role key bypasses row-level security and must only be used by trusted local scripts, backend workers, or server-side code.

## Apply Initial Schema

For the first pass, the simplest route is the Supabase dashboard:

1. Open the project in Supabase.
2. Go to SQL Editor.
3. Paste and run the contents of `supabase/migrations/001_initial_ordering_schema.sql`.
4. Paste and run the contents of `supabase/migrations/002_manual_recommendation_ingest.sql`.
5. Paste and run the contents of `supabase/migrations/003_manual_po_draft_ingest.sql`.
6. Paste and run the contents of `supabase/migrations/004_buyer_recommendation_fields.sql`.

After that, install dependencies and check the connection:

```bash
source .venv/bin/activate
pip install -r requirements.txt
python scripts/check_supabase_connection.py
```

The check script loads `.env` automatically if it exists.

## Keys Needed From Supabase

In Supabase, go to Project Settings -> API:

- Project URL
- `anon public` key
- `service_role secret` key

The app can use the anon key later for authenticated client reads. The Python worker and migration/check scripts need the service-role key.

## First Tables To Verify

After migration, confirm these tables exist:

- `app_profiles`
- `suppliers`
- `products`
- `source_files`
- `report_runs`
- `inventory_snapshots`
- `sales_history`
- `reorder_recommendations`
- `purchase_order_drafts`
- `purchase_order_lines`
- `audit_events`

`002_manual_recommendation_ingest.sql` should also add transitional recommendation fields:

- `planning_sku`
- `product_name`
- `product_code`
- `supplier_name`

`003_manual_po_draft_ingest.sql` should add matching transitional PO fields:

- `purchase_order_drafts.supplier_name`
- `purchase_order_lines.product_name`
- `purchase_order_lines.product_code`
- `purchase_order_lines.planning_sku`

`004_buyer_recommendation_fields.sql` should add buyer-facing recommendation fields, including:

- `recommendation_status` defaulting to `rejected`
- `approved_qty`
- `is_btg` / `is_core`
- `last_60_day_sales` / `last_90_day_sales`
- `next_30_day_forecast` / `next_60_day_forecast` / `next_90_day_forecast`
- `velocity_trend_pct`
- `risk_level`
- `pickup_location`
- `trucking_cost_per_bottle`
- `landed_cost`
