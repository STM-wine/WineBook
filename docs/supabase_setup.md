# Supabase Setup

## Project

- Project URL: `https://hpnvlxvnzpojpfepcerl.supabase.co`
- GitHub repo: `https://github.com/STM-wine/WineBook`
- Schema migrations:
  - `supabase/migrations/001_initial_ordering_schema.sql`
  - `supabase/migrations/002_manual_recommendation_ingest.sql`
  - `supabase/migrations/003_manual_po_draft_ingest.sql`
  - `supabase/migrations/004_buyer_recommendation_fields.sql`
  - `supabase/migrations/005_daily_email_ingest.sql`

Do not commit database passwords, service-role keys, or `.env` files. If the database password has been shared outside a password manager, rotate it in Supabase before production use.

## Local Environment

Create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

Fill in:

```bash
SUPABASE_URL=https://hpnvlxvnzpojpfepcerl.supabase.co
SUPABASE_ANON_KEY=...
SUPABASE_SERVICE_ROLE_KEY=...
```

The anon key is safe for browser/client contexts. The service-role key bypasses row-level security and must only be used by trusted local scripts, backend workers, or server-side code. Do not put service-role keys in frontend/browser code.

## Apply Initial Schema

For the first pass, the simplest route is the Supabase dashboard:

1. Open the project in Supabase.
2. Go to SQL Editor.
3. Paste and run the contents of `supabase/migrations/001_initial_ordering_schema.sql`.
4. Paste and run the contents of `supabase/migrations/002_manual_recommendation_ingest.sql`.
5. Paste and run the contents of `supabase/migrations/003_manual_po_draft_ingest.sql`.
6. Paste and run the contents of `supabase/migrations/004_buyer_recommendation_fields.sql`.
7. Paste and run the contents of `supabase/migrations/005_daily_email_ingest.sql`.

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

## Current Persistence Shape

The app currently writes report runs and recommendations from manual upload runs. This is transitional: RB6/RADs and `importers.csv` still provide the source data, while Supabase stores durable run history and PO draft data.

New recommendation rows default to an opt-in approval model:

- `recommendation_status = rejected`
- `approved_qty = 0`

The next app step is to add row-level approval/edit controls and persist buyer changes back to Supabase.

## Daily Email Automation

GitHub Actions runs `.github/workflows/daily-vinosmith-ingest.yml` on weekday mornings. The workflow executes `scripts/process_daily_vinosmith_email.py`, which:

1. Connects to the `stm@stemwinecompany.com` mailbox over IMAP.
2. Finds the current day's Vinosmith report attachments.
3. Uploads the raw files to the private Supabase Storage bucket `source-files`.
4. Creates `source_files` rows.
5. Runs the existing Python ordering pipeline.
6. Saves a `scheduled_email` report run and recommendations.

Required GitHub Actions secrets:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `EMAIL_HOST` (`imap.gmail.com` for Gmail/Google Workspace)
- `EMAIL_PORT` (`993`)
- `EMAIL_USERNAME`
- `EMAIL_PASSWORD`
- `EMAIL_MAILBOX` (`INBOX`)
- `IMPORTERS_CSV_BASE64`

Optional GitHub Actions secrets/variables:

- `VINOSMITH_SENDER`
- `VINOSMITH_SUBJECT_KEYWORD`
- `RB6_ATTACHMENT_KEYWORDS`
- `RADS_ATTACHMENT_KEYWORDS`

To create `IMPORTERS_CSV_BASE64` locally:

```bash
base64 -i importers.csv | pbcopy
```

Paste the copied value into the GitHub secret. Keep the actual `importers.csv` out of the repo.

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

`005_daily_email_ingest.sql` should add daily automation support:

- private Supabase Storage bucket `source-files`
- `report_runs.report_date`
- `report_runs.source_channel`
- scheduled-run lookup index by report date/status
- `source_files.email_message_id`
