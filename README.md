# WineBook

Internal ordering tools for Stem Wine Company.

**GitHub:** `https://github.com/STM-wine/WineBook`
**Last updated:** April 2026
**Stack:** Python 3.11, Streamlit, pandas, openpyxl, Supabase

## Overview

WineBook is being productized from a local MVP into a Supabase-backed ordering dashboard. The near-term app uses Vinosmith/RB6/RADs exports, but the long-term direction is to make WineBook Stem's durable ordering layer: ingest source data, calculate daily reorder recommendations, let buyers approve supplier POs, and eventually push approved POs into QuickBooks.

The repo currently contains two independent Streamlit tools:

| Tool | Entry Point | Status |
| --- | --- | --- |
| Ordering Dashboard | `app.py` | Active productization focus |
| GRW Invoice Converter | `grw_converter_app.py` | Existing utility, not part of the current ordering-dashboard work |

Keep the GRW converter separate unless the business explicitly decides to merge it into a future unified front end.

## Current Ordering Flow

1. Manual RB6 inventory and RADs sales exports are uploaded in the Streamlit app.
2. `stem_order.ingest` detects headers, normalizes columns, and prepares source frames.
3. `wine_calculator.py` calculates velocity, coverage, forecasts, risk, and recommended quantities.
4. `stem_order.pipeline` adds supplier logistics from local `importers.csv` when available.
5. The app saves report runs and recommendation rows to Supabase when credentials are configured.
6. Buyers open the dashboard, filter by supplier/status/product, review recommendations, and create supplier PO drafts.

The remote automation path uses GitHub Actions to run `scripts/process_daily_vinosmith_email.py` on weekday mornings after Vinosmith emails the reports to `stm@stemwinecompany.com`. The workflow downloads the attachments, uploads raw source files to Supabase Storage, and creates a `scheduled_email` report run.

`Importer` is Vinosmith terminology. In user-facing workflow and business language, use `Supplier`.

## Repo Structure

```text
WineBook/
├── app.py                         # Ordering Dashboard Streamlit app
├── wine_calculator.py             # Current reorder calculation engine
├── grw_converter_app.py           # Separate GRW invoice converter utility
├── requirements.txt
├── .env.example                   # Safe local env template, no secrets
├── docs/
│   ├── product_architecture.md
│   ├── supabase_setup.md
│   └── next_steps.md
├── stem_order/
│   ├── ingest.py                  # RB6/RADs/importers normalization
│   ├── pipeline.py                # Shared ordering pipeline
│   ├── dashboard.py               # Dashboard/PO table shaping
│   ├── supabase_repository.py     # Supabase persistence layer
│   └── core.py
├── supabase/migrations/           # Numbered Supabase schema migrations
├── scripts/                       # Local smoke/persist/check helpers
├── tests/
└── modules/po_tools/              # GRW converter internals
```

Local source exports such as `importers.csv`, RB6/RADs `.xlsx` files, PDFs, and `.env` are intentionally ignored.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with local Supabase keys when you need database reads/writes. Never commit `.env`, service-role keys, database passwords, or customer/source data files.

## Running

Ordering Dashboard:

```bash
source .venv/bin/activate
streamlit run app.py
```

GRW Invoice Converter:

```bash
source .venv/bin/activate
streamlit run grw_converter_app.py --server.port 8502
```

## Supabase

Project URL:

```text
https://hpnvlxvnzpojpfepcerl.supabase.co
```

Apply migrations in numeric order from `supabase/migrations/`. See `docs/supabase_setup.md` for the full setup checklist.

Useful local checks:

```bash
python scripts/check_supabase_connection.py
python scripts/show_latest_report_run.py
python scripts/smoke_ordering_pipeline.py
python scripts/process_daily_vinosmith_email.py --dry-run
```

## Ordering Logic

Current buyer-facing rules from Mark/ownership:

- Core SKUs target 30 days of demand.
- BTG SKUs target 45 days of demand.
- Non-Core / Non-BTG SKUs with last-30-day sales target 30 days of demand.
- Recommended quantity subtracts true available inventory and on-order quantity, then rounds up to full case equivalent.
- High-volume SKUs, currently defined as average monthly sales over 480 bottles, are flagged for future pallet-configuration rounding.
- Every SKU receives a recommendation row.
- Recommendations default to `rejected`; buyers must explicitly approve or edit quantities before PO entry.

Current output includes:

- Supplier
- Wine name
- BTG/Core flags
- True available inventory
- On-order quantity
- Last 30/60/90 day sales
- Next 30/60/90 day forecast fields
- Weekly velocity
- Velocity trend percentage
- Risk level
- Recommended quantity
- Approval status
- Estimated wine cost and landed cost

## Logistics Direction

The dashboard now includes pickup-location rollups and a first California full-truckload summary:

- FTL threshold: 850 cases / 10,200 bottles
- FTL incentive: $2 per case savings at full truck
- Non-FTL freight assumption from notes: $4.75 per case
- Future work should use internal trucking-cost-per-bottle and pallet-configuration data to recommend incremental SKUs that efficiently fill trucks.

## Verification

Run before pushing meaningful changes:

```bash
python -m compileall app.py wine_calculator.py stem_order tests scripts
python -m unittest discover -s tests
python scripts/smoke_ordering_pipeline.py
```

## Development Notes

- Keep calculation and ingest logic reusable outside Streamlit. Scheduled workers will need the same pipeline.
- Keep `display_df` UI-only; use raw numeric frames for calculations and persistence.
- Use Supabase service-role keys only in trusted server-side/local scripts.
- The current hosted-product direction is still open: Streamlit can continue as the near-term app, but a future authenticated web app can reuse the same Supabase schema and Python worker pipeline.
