# WineBook

Internal ordering tools for Stem Wine Company.

**GitHub:** `https://github.com/STM-wine/WineBook`
**Last updated:** May 2026
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

1. Vinosmith emails daily RB6 inventory and RADs sales exports to `stm@stemwinecompany.com`.
2. Supabase Cron dispatches the GitHub Actions worker during the morning ingestion window until the current report date has a completed `scheduled_email` run.
3. `scripts/process_daily_vinosmith_email.py` downloads the matching attachments, uploads raw files to Supabase Storage, and runs the shared Python pipeline.
4. `stem_order.ingest` detects headers, normalizes columns, and prepares source frames.
5. `wine_calculator.py` calculates velocity, coverage, forecasts, risk, and recommended quantities.
6. `stem_order.pipeline` adds supplier logistics from Supabase `suppliers`, with local `importers.csv` as a seed/fallback.
7. The app reads the latest completed Supabase report run by default.
8. Buyers review recommendations by supplier, adjust target weeks or recommended quantities, approve rows, and create supplier PO drafts/exports for QuickBooks entry.

Manual RB6/RADs upload is no longer part of the default app surface. For reruns or same-day correction, use the GitHub Actions ingest workflow or the local processing scripts.

`Importer` is Vinosmith terminology. In user-facing workflow and business language, use `Supplier`.

## Repo Structure

```text
WineBook/
├── app.py                         # Ordering Dashboard Streamlit app
├── wine_calculator.py             # Current reorder calculation engine
├── grw_converter_app.py           # Separate GRW invoice converter utility
├── requirements.txt
├── .env.example                   # Safe local env template, no secrets
├── importers.csv                   # Supplier logistics reference data
├── templates/
│   └── po_draft_template_stm.xlsx  # Excel PO draft template
├── components/supplier_catalog/   # Supplier Hub Streamlit module
├── docs/
│   ├── product_architecture.md
│   ├── supabase_setup.md
│   └── next_steps.md
├── models/                        # Supplier Hub domain models
├── services/                      # Supplier Hub pricing/request/catalog services
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

Local source exports such as RB6/RADs `.xlsx` files, PDFs, and `.env` are intentionally ignored. `importers.csv` is tracked as seed/reference data; normal supplier-logistics management happens in the Supplier Hub tab and persists to Supabase.

## Setup

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
```

Fill `.env` with local Supabase keys when you need database reads/writes. Never commit `.env`, service-role keys, database passwords, or customer/source data files.

## Running

Ordering Dashboard and Supplier Hub:

```bash
source .venv/bin/activate
streamlit run app.py
```

The app tabs are Order Review, Supplier Hub, Supplier Board, Freight, and PO Drafts. Supplier Hub is currently local/session-state only; it is a foundation for supplier wine search, manual wine entry, pricing, requests, pending product creation, and price-change tracking.

Supplier logistics are managed in the Supplier Hub tab and stored in Supabase `suppliers` when the latest supplier-logistics migration has been applied. `importers.csv` remains a seed/fallback file, not the normal management workflow.

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

Apply migrations from `supabase/migrations/` in order. The first six are numbered historical setup migrations; later timestamped migrations are incremental production changes. See `docs/supabase_setup.md` for the full setup checklist.

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
- True available inventory is calculated from RB6 as `Available Inventory - Unconfirmed Line Item Qty`, clamped at zero.
- High-volume SKUs, currently defined as average monthly sales over 480 bottles, are flagged for future pallet-configuration rounding.
- Every SKU receives a recommendation row.
- Recommendations default to `rejected`; buyers must explicitly approve rows before PO entry.
- Buyers can edit either `Weeks w/ Recommended` or `Recommended Qty`; the dashboard keeps those values synchronized and saves the working recommended quantity as the approved quantity when approved.
- Weekly velocity is calculated as `30d Sales / 4.345`.
- Velocity trend compares the latest 30-day RADs sales window against the prior 30-day window. If the prior period is zero and the latest period has sales, the buyer table displays `New`.

## Operational Inventory Risk

WineBook also calculates a first-version operational inventory risk score in `wine_calculator.py`. This is not an accounting aging model. It does not use QuickBooks, receipt dates, landed inventory value, or accounting inventory aging. It uses only the current RB6 inventory export and RADs sales history to help buyers decide which wines are safe to replenish, which need review, and which should be frozen or reduced before more cash is tied up.

The risk score uses:

- `inventory_value`: true available bottles multiplied by FOB bottle cost.
- `days_since_last_sale`: the report date minus the most recent RADs sale date for the planning SKU.
- `weeks_on_hand`: true available inventory divided by weekly velocity. If there is inventory but no recent velocity, the calculator treats weeks on hand as very high for operational review.
- `last_90_day_sales`: RADs movement in the last 90 days.

Inventory value matters because slow-moving wine with a high dollar value can quietly consume working capital. A low-cost, low-quantity item may deserve a light review, while a high-value item with little movement may need to be frozen even before accounting aging data is available.

Risk labels:

| Label | Meaning |
| --- | --- |
| LOW | Inventory level appears aligned with recent RADs movement. |
| WATCH | Movement is slowing or weeks on hand is elevated; review before adding more. |
| HIGH RISK | The wine has a long sales gap, high weeks on hand, or high inventory value relative to velocity. |
| FREEZE | Do not replenish without review; inventory is not moving enough for the cash tied up. |

Core and BTG wines get human-review protection. If a Core or BTG item would be frozen only because weeks on hand is high, WineBook labels it `HIGH RISK` instead and asks for review before freezing. Core/BTG wines can still be labeled `FREEZE` when there are truly no sales in the last 90 days and inventory value is meaningfully high.

Future QuickBooks-aware work may improve this with receipt dates, landed cost, accounting inventory aging, and better inventory valuation. That should extend the operational score rather than replacing the RB6/RADs view.

Current buyer table includes:

- Wine name with supplier-rank badge and BTG/Core flags
- True available inventory
- On-order quantity
- Inventory value
- Days since last sale
- Last 30 day sales, with optional 60/90 day sales
- Next 30 day forecast, with optional LY 60/90 day forecast fields
- Weekly velocity
- Velocity trend percentage
- Weeks on hand
- Inventory risk label and reason
- Weeks available with on-order quantity
- Weeks available with recommended quantity
- Editable recommended quantity
- Approval checkbox
- Estimated wine cost and landed cost

Calculated buyer-table headers include hover help with formulas and plain-English explanations.

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
- Supabase Cron is the scheduling source of truth. GitHub Actions remains the Python worker and can still be manually dispatched for debugging.
- The hosted-product direction is still open: Streamlit can continue as the near-term app, but a future authenticated web app can reuse the same Supabase schema and Python worker pipeline.
