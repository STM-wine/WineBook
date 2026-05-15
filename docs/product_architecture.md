# WineBook Product Architecture

## Direction

WineBook should become a cloud app backed by Supabase. Vinosmith/RB6/RADs files are transitional source feeds, not the long-term data model. The durable model should represent Stem's own products, suppliers, inventory snapshots, sales history, reorder recommendations, logistics rules, and purchase order drafts.

Terminology matters: Vinosmith calls the field `Importer`, but Stem's internal and user-facing term is `Supplier`. Keep compatibility mappings in ingest code, but use `Supplier` in product copy and user workflows.

## Target Flow

1. Source files arrive from email/cloud automation or eventually QuickBooks.
2. Raw files are stored in Supabase Storage and recorded in `source_files`.
3. A Python worker normalizes the source data and writes structured rows into Supabase Postgres.
4. The reorder engine creates a `report_run` and `reorder_recommendations`.
5. Recommendations default to rejected with zero approved quantity.
6. Users open the app, filter by supplier/status/product/location, adjust working recommendation quantities or target weeks, approve rows, and create a supplier PO draft.
7. The app exports a PO for manual QuickBooks entry first.
8. Later, QuickBooks OAuth/API integration creates or updates purchase orders directly.

## Near-Term Repo Shape

- `stem_order/ingest.py`: spreadsheet/header/column normalization shared by UI and workers.
- `stem_order/core.py`: stable import path for calculation logic.
- `stem_order/pipeline.py`: source preparation, recommendation assembly, importer logistics, and UI-ready output formatting.
- `stem_order/dashboard.py`: dashboard table shaping, PO exports, location rollups, and California truck summary helpers.
- `stem_order/supabase_repository.py`: optional Supabase write layer, dormant until credentials and the Supabase Python client are available.
- `components/supplier_catalog/`: Supplier Hub Streamlit module for manual supplier wine intelligence.
- `services/`: Supplier Hub pricing, catalog, request workflow, normalization, and price-change services.
- `models/`: Supplier Hub domain objects for supplier wines, wine requests, and price changes.
- `wine_calculator.py`: existing calculation engine during migration.
- `supabase/migrations/`: database schema for the future cloud app.
- `scripts/`: local smoke checks against sample export files.
- `.github/workflows/daily-vinosmith-ingest.yml`: manually dispatchable GitHub Actions worker for remote email ingestion.

## Supabase Responsibilities

- Auth: employee login and role tracking.
- Postgres: durable product/supplier/report/PO data.
- Storage: raw source files and generated PO exports.
- Cron/Functions: lightweight orchestration and scheduled HTTP triggers.

Heavy spreadsheet parsing and pandas calculation should remain in Python workers rather than Supabase Edge Functions.

## Automation Strategy

The current remote automation path uses Supabase as the clock and GitHub Actions as the worker:

1. Vinosmith emails RB6/inventory and RADs/sales reports to `stm@stemwinecompany.com`.
2. Supabase Cron runs through the morning window and calls GitHub's `workflow_dispatch` API only while the current Mountain-time report date lacks a completed `scheduled_email` report run.
3. GitHub Actions runs `scripts/process_daily_vinosmith_email.py`.
4. The script connects to the mailbox, downloads matching attachments, stores raw files in Supabase Storage, and runs the existing Python pipeline.
5. The script writes a `scheduled_email` report run. It also skips if a completed scheduled run already exists for that report date unless forced.

This keeps the stack tight: GitHub for code and worker execution, Supabase for data/storage/auth/scheduling, Python for spreadsheet processing.

## Current Ordering Rules

- Core SKUs target 30 days of demand.
- BTG SKUs target 45 days of demand.
- Non-Core / Non-BTG SKUs with recent sales target 30 days of demand.
- True available inventory is calculated from RB6 as `Available Inventory - Unconfirmed Line Item Qty`, clamped at zero.
- Order quantity subtracts true available inventory and on-order quantity, then rounds up to full case equivalent.
- High-volume SKUs over 480 bottles/month should eventually round to full pallet configuration. Today they are flagged because pallet configuration data is not yet modeled.
- Every SKU gets a recommendation row.
- Orders are opt-in: recommendations default to `rejected` until explicitly approved.

## Buyer Dashboard Surface

Primary table fields should remain focused on buyer decisions:

- Wine Name with importer rank and BTG/Core flags inline
- True Available Inventory
- On Order Quantity
- Last 30 Days Sales
- Next 30 Days Forecast
- Weekly Velocity
- Velocity Trend
- Weeks Available with On Order
- Weeks Available with Recommended Order Quantity
- Recommended Quantity, editable as the buyer's working order quantity
- Approval checkbox
- Estimated Cost

Optional/detail fields can expose last 60/90-day sales and next 60/90-day forecasts.

The importer workbench is grouped by supplier/importer. The importer selector defaults to `All`, and selecting a single importer narrows the same workbench rather than switching to a separate mode. Recommendation rows remain opt-in: the buyer must approve a row before it is included in PO draft generation.

Calculated headers in the buyer workbench should explain their formulas in hover help. Current formulas include:

- Weekly Velocity = `30d Sales / 4.345`.
- Velocity Trend = `((Last 30d Sales - Prior 30d Sales) / Prior 30d Sales) x 100`; if prior-period sales are zero and current sales are positive, display `New`.
- Weeks with On Order = `(True Available + On Order) / Weekly Velocity`.
- Weeks with Recommended = `(True Available + On Order + Recommended Qty) / Weekly Velocity`.
- Estimated Cost = `Recommended Qty x FOB`.

Supplier logistics are now expected to live in Supabase `suppliers`, including ETA, pickup location, freight forwarder, order frequency, notes, active status, and `trucking_cost_per_bottle`. `importers.csv` remains a seed/fallback source until the database table is fully populated.

## Logistics Rollups

The order summary should aggregate hierarchically:

1. Pickup Location
2. Supplier
3. Producer

California full-truckload logic:

- FTL threshold: 850 cases / 10,200 bottles.
- FTL incentive: $2 per case savings at full truck.
- Non-FTL freight assumption from notes: $4.75 per case.
- Dashboard should show progress to full truck, bottles needed to reach FTL, and estimated savings.

Future logistics work should add internal trucking cost per bottle, pallet configuration by SKU, and intelligent SKU recommendations to fill trucks efficiently.

## Migration Strategy

1. Keep the Streamlit app working.
2. Move parsing and calculation out of `app.py` into reusable modules.
3. Add tests around normalization and reorder calculations.
4. Add a Supabase write path while manual uploads still exist.
5. Replace upload-first workflow with latest-run dashboard. The old upload-first fallback is no longer part of the default app surface.
6. Save supplier-specific PO drafts from current recommendations.
7. Add buyer approval state so all recommendations default to rejected until explicitly approved. Done for the current Streamlit workflow.
8. Add logistics rollups and truck optimization summaries. Initial freight and California truck summaries exist; producer rollups and intelligent fill recommendations remain future work.
9. Automate daily email ingestion with Supabase-triggered GitHub Actions. Current automation exists, searches Gmail All Mail so category sorting does not hide reports, and suppresses extra GitHub dispatches after a completed daily run.
10. Refine PO drafts into buyer-ready exports and status workflows. Initial draft review, CSV/XLSX export, duplicate active-draft guard, and status changes exist.
11. Decide the hosting path for the first non-local release.
12. Add QuickBooks sync/export once the internal PO workflow is stable.

## Supabase Setup Inputs Needed

When we are ready to connect the app to Supabase, create a Supabase project and provide these values through local environment variables, not committed files:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Use `.env.example` as the template. The service role key is only for trusted server-side workers and local migration/testing scripts.

The current Supabase project URL is `https://hpnvlxvnzpojpfepcerl.supabase.co`.

After the project exists:

1. Apply `supabase/migrations/001_initial_ordering_schema.sql`, then the numbered transitional migrations.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run `python scripts/check_supabase_connection.py` to verify credentials and table writes.
4. Decide user roles for the first release: likely `admin`, `buyer`, and `viewer`.
5. Decide whether the first hosted app is Streamlit-backed or a new authenticated web app backed by the same Supabase schema. Wix should be treated as a possible entry point, link, or embed surface rather than the main application runtime.

See `docs/supabase_setup.md` for the project-specific setup checklist.
