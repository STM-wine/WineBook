# Stem Ordering Platform Architecture

## Direction

The ordering assistant should become a cloud app backed by Supabase. Vinosmith/RB6/RADs files are transitional source feeds, not the long-term data model. The durable model should represent Stem's own products, suppliers, inventory snapshots, sales history, reorder recommendations, and purchase order drafts.

## Target Flow

1. Source files arrive from manual upload, email, cloud storage, or eventually QuickBooks.
2. Raw files are stored in Supabase Storage and recorded in `source_files`.
3. A Python worker normalizes the source data and writes structured rows into Supabase Postgres.
4. The reorder engine creates a `report_run` and `reorder_recommendations`.
5. Users open the app, filter by supplier/status/product, create a supplier PO draft, and later adjust or approve quantities.
6. The app exports a PO for manual QuickBooks entry first.
7. Later, QuickBooks OAuth/API integration creates or updates purchase orders directly.

## Near-Term Repo Shape

- `stem_order/ingest.py`: spreadsheet/header/column normalization shared by UI and workers.
- `stem_order/core.py`: stable import path for calculation logic.
- `stem_order/pipeline.py`: source preparation, recommendation assembly, importer logistics, and UI-ready output formatting.
- `stem_order/supabase_repository.py`: optional Supabase write layer, dormant until credentials and the Supabase Python client are available.
- `wine_calculator.py`: existing calculation engine during migration.
- `supabase/migrations/`: database schema for the future cloud app.
- `scripts/`: local smoke checks against sample export files.

## Supabase Responsibilities

- Auth: employee login and role tracking.
- Postgres: durable product/supplier/report/PO data.
- Storage: raw source files and generated PO exports.
- Cron/Functions: lightweight orchestration and scheduled HTTP triggers.

Heavy spreadsheet parsing and pandas calculation should remain in Python workers rather than Supabase Edge Functions.

## Migration Strategy

1. Keep the Streamlit app working.
2. Move parsing and calculation out of `app.py` into reusable modules.
3. Add tests around normalization and reorder calculations.
4. Add a Supabase write path while manual uploads still exist.
5. Replace upload-first workflow with latest-run dashboard.
6. Save supplier-specific PO drafts from current recommendations.
7. Add buyer approval state so all recommendations default to rejected until explicitly approved.
8. Add QuickBooks sync/export once the internal PO workflow is stable.

## Supabase Setup Inputs Needed

When we are ready to connect the app to Supabase, create a Supabase project and provide these values through local environment variables, not committed files:

- `SUPABASE_URL`
- `SUPABASE_ANON_KEY`
- `SUPABASE_SERVICE_ROLE_KEY`

Use `.env.example` as the template. The service role key is only for trusted server-side workers and local migration/testing scripts.

The current Supabase project URL is `https://afefwnhchoqabcwjpwby.supabase.co`.

After the project exists:

1. Apply `supabase/migrations/001_initial_ordering_schema.sql`, then the numbered transitional migrations.
2. Install dependencies with `pip install -r requirements.txt`.
3. Run `python scripts/check_supabase_connection.py` to verify credentials and table writes.
4. Decide user roles for the first release: likely `admin`, `buyer`, and `viewer`.
5. Decide whether the first hosted app is Streamlit-backed or a new Next.js app backed by the same Supabase schema.

See `docs/supabase_setup.md` for the project-specific setup checklist.
