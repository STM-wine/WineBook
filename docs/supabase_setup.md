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
  - `supabase/migrations/006_supabase_github_ingest_trigger.sql`

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
8. After creating the GitHub dispatch token described below, paste and run the contents of `supabase/migrations/006_supabase_github_ingest_trigger.sql`.

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

The app now includes row-level approval/edit controls in the importer workbench. Buyers can adjust either `Weeks w/ Recommended` or `Recommended Qty`; those two values stay synchronized in the Streamlit editor. When a row is approved, the current working `Recommended Qty` is persisted as `approved_qty` for PO draft generation.

## Daily Email Automation

Supabase is the reliable scheduler for the daily Vinosmith ingest. The scheduled database job in `supabase/migrations/006_supabase_github_ingest_trigger.sql` calls GitHub's `workflow_dispatch` API through the morning ingestion window. GitHub Actions remains the worker, but GitHub is no longer trusted as the clock.

The workflow executes `scripts/process_daily_vinosmith_email.py`, which:

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
- `EMAIL_MAILBOXES` optional comma-separated override. For Google Workspace/Gmail, the script now searches `INBOX` and falls back to `[Gmail]/All Mail` automatically so category sorting like Updates does not hide the reports.
- `IMPORTERS_CSV_BASE64`

Optional GitHub Actions secrets/variables:

- `VINOSMITH_SENDER`
- `VINOSMITH_SUBJECT_KEYWORD`
- `RB6_ATTACHMENT_KEYWORDS`
- `RADS_ATTACHMENT_KEYWORDS`

Supabase scheduled trigger setup:

1. Create a fine-grained GitHub token for `STM-wine/WineBook` with repository `Actions: Read and write`.
2. In Supabase SQL Editor, store it in Vault:

```sql
select vault.create_secret(
    '<fine-grained-github-token>',
    'github_actions_dispatch_token',
    'Token allowed to dispatch STM-wine/WineBook workflows'
);
```

3. Apply `supabase/migrations/006_supabase_github_ingest_trigger.sql`.
4. Verify the job exists:

```sql
select jobid, jobname, schedule, active
from cron.job
where jobname = 'daily-vinosmith-github-dispatch';
```

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
