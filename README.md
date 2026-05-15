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

- BTG SKUs target 45 days of demand.
- Core SKUs target 30 days of demand.
- Standard, non-Core / non-BTG SKUs target 15 days of demand.
- Weekly velocity is calculated as `30d Sales / 4.345`.
- Base recommendation is `(Target Weeks × Weekly Velocity) - True Available - On Order`, clamped at zero.
- Final recommendation is `Base Recommendation × Purchasing Environment Modifier`.
- True available inventory is calculated from RB6 as `Available Inventory - Unconfirmed Line Item Qty`, clamped at zero.
- High-volume SKUs, currently defined as average monthly sales over 480 bottles, are flagged for future pallet-configuration rounding.
- Every SKU receives a recommendation row.
- Recommendations default to `rejected`; buyers must explicitly approve rows before PO entry.
- Buyers can edit either `Weeks w/ Recommended` or `Recommended Qty`; the dashboard keeps those values synchronized and saves the working recommended quantity as the approved quantity when approved.
- Velocity trend compares the latest 30-day RADs sales window against the prior 30-day window. If the prior period is zero and the latest period has sales, the buyer table displays `New`.

Minimum case threshold:

- Standard wines with a final recommendation below one full case round down to zero.
- Core and BTG wines keep the existing pack-size round-up behavior, so a justified sub-case recommendation can still become one case.
- All positive recommended quantities still round to the wine's pack size.

## Purchasing Environment Modifier

WineBook separates demand signal from purchasing posture.

Demand signal answers:
"What has been selling?"

Purchasing posture answers:
"How aggressively should we allow ourselves to buy right now?"

Arizona has a meaningful summer slowdown, and trailing sales data can sometimes be inflated by intentional inventory-reduction sales. The system should not blindly chase historical sales if the business is entering a defensive cash-flow period.

The purchasing environment modifier currently lives in `wine_calculator.py`.

| Months | Mode | Multiplier |
| --- | --- | --- |
| January-March | Aggressive | 1.15 |
| April | Neutral | 1.00 |
| May-August | Defensive | 0.75 |
| September | Rebuild | 1.00 |
| October-December | Growth | 1.10 |

Base Recommendation =
`(Target Weeks × Weekly Velocity) - True Available - On Order`

Final Recommendation =
`Base Recommendation × Purchasing Environment Modifier`

This is NOT a demand forecast. It is a working-capital discipline layer. The goal is to become more conservative during defensive months while still protecting Core, BTG, and proven movers.

Future direction: additional modifiers may include cash posture, inventory value targets, supplier ETA weighting, and supplier relationship protection.

Current buyer table includes:

- Wine name with supplier-rank badge and BTG/Core flags
- True available inventory
- On-order quantity
- Last 30 day sales, with optional 60/90 day sales
- Next 30 day forecast, with optional LY 60/90 day forecast fields
- Weekly velocity
- Velocity trend percentage
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
