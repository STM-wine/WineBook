# WineBook

Internal ordering tools for Stem Wine Company.

**GitHub:** `https://github.com/STM-wine/WineBook`
**Last updated:** May 2026
**Current stack:** Next.js, Supabase Auth/Data, Render, Python 3.11, pandas, openpyxl
**Production app:** `https://stmhq.com`

## Overview

WineBook is being productized from a local MVP into a Supabase-backed ordering dashboard. The near-term app uses Vinosmith/RB6/RADs exports, but the long-term direction is to make WineBook Stem's durable ordering layer: ingest source data, calculate daily reorder recommendations, let buyers approve supplier POs, and eventually push approved POs into QuickBooks.

The repo currently contains the production Next.js app plus two Streamlit-era tools:

| Tool | Entry Point | Status |
| --- | --- | --- |
| WineBook Web App | `apps/web` | Production V1 runtime on Render |
| Ordering Dashboard | `app.py` | Streamlit reference/fallback implementation |
| GRW Invoice Converter | `grw_converter_app.py` | Existing utility, separate from ordering V1 |

Keep the GRW converter separate unless the business explicitly decides to merge it into a future unified front end.

The Ordering Dashboard Streamlit app remains the historical reference implementation. The hosted buyer workflow now lives in `apps/web` as an authenticated Next.js app on Render, while the existing Python ingestion/calculation worker remains responsible for daily Vinosmith processing.

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
├── apps/web/                      # Production Next.js + Supabase Auth app
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

Production web app:

```bash
cd apps/web
cp .env.example .env.local
npm ci
npm run dev
```

For local development, set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`
in `apps/web/.env.local`. Do not add the service-role key to the web app.

Ordering Dashboard and Supplier Hub:

```bash
source .venv/bin/activate
streamlit run app.py
```

The Streamlit app tabs are Order Review, Supplier Hub, Supplier Board, Freight, and PO Drafts. The Next.js app is the current production home for the buyer workflows, including authenticated Order Review, Supplier Hub logistics editing, Freight rollups, PO Draft creation/status review, CSV export, and XLSX export using the STM PO template. Supplier Board is hidden in V1 because Order Summary now covers that supplier-level view.

Supplier logistics are managed in the Supplier Hub tab and stored in Supabase `suppliers` when the latest supplier-logistics migration has been applied. `importers.csv` remains a seed/fallback file, not the normal management workflow.

GRW Invoice Converter:

```bash
source .venv/bin/activate
streamlit run grw_converter_app.py --server.port 8502
```

## GRW Converter Next.js Module

The GRW Converter module brings the existing GRW invoice workflow into the authenticated Next.js app at:

```text
/modules/grw-converter
```

It converts GRW sales order PDFs into Stem-ready PO import outputs while keeping the existing Streamlit converter and Python parser/export files as the production reference. The Streamlit entry point remains `grw_converter_app.py`, and the core reference files remain under `modules/po_tools/grw_invoice_converter/`.

Current architecture:

- Next.js UI lives in `apps/web/src/components/grw-converter-uploader.tsx`.
- Authenticated parse and export routes live under `apps/web/src/app/api/modules/grw-converter/`.
- Python bridge scripts live in `apps/web/scripts/` and call the existing GRW parser, pricing, validation, and template writer modules.
- XLSX and CSV generation run server-side; the browser only sends the selected PDF and any edited item numbers.
- The XLSX export uses `modules/po_tools/grw_invoice_converter/templates/GRW_Template_Updated.xlsx`.

Current Next.js UI flow:

1. User opens the module from the Modules nav dropdown.
2. User drags/drops or selects a GRW invoice PDF.
3. The invoice auto-converts on upload.
4. The page displays invoice summary, credits/balance, download actions, and parsed line items.
5. Item Number defaults to `NEW` and can be edited inline.
6. Download actions generate XLSX and CSV outputs server-side.

Implemented features:

- Auto-convert on upload.
- Parsed line-item display with wine name, vintage, pack, quantity, FOB bottle/case, frontline, ext cost, markup, and ext price.
- Invoice summary / credits & balance display when those values are present in the PDF.
- Editable Item Number values in the app table.
- Edited Item Number values persist into XLSX and CSV exports.
- XLSX export using the existing GRW template writer.
- SaasAnt / QuickBooks CSV export.
- Filename generation based on the uploaded invoice/account/order pattern, matching the Streamlit behavior where filenames like `Account Name #59041.pdf` resolve to `Account_Name_S59041.xlsx`.

Important implementation notes:

- Do not remove, rename, or rewrite the Streamlit GRW converter files; they are still the production reference.
- Keep GRW migration work isolated on feature branches until reviewed and merged by ownership.
- Export generation is server-side and should not move pricing/template logic into the browser.
- The Next.js export route re-parses the uploaded PDF and applies any frontend-edited Item Number overrides before writing XLSX/CSV.
- Local development requires the Next.js app env in `apps/web/.env.local` plus the Python dependencies from `requirements.txt`/the local virtualenv.
- Useful local checks include `npm run build` from `apps/web`, direct bridge testing with a known GRW PDF, and opening `/modules/grw-converter` on localhost.



## Supplier Offer Compiler MVP

Active branch: `supplier-offer-compiler-mvp`.

The Supplier Offer Compiler is a trust-first compiler for supplier CSV/XLSX offers. It is intentionally not a direct importer: supplier documents should become evidence-backed, reviewed offer candidates before anything touches QuickBooks, VinoSmith, official products, or `supplier_catalog_wines`.

Current MVP state:

- Route: `/modules/supplier-offer-compiler` in the Next.js app.
- Upload support: CSV and XLSX only.
- Supplier selector reuses Supplier Hub logistics data from Supabase `suppliers`, merged with `importers.csv` defaults via `loadImporterDefaults()` / `mergeSupplierDefaults()`.
- Parser foundation lives in `apps/web/src/lib/supplier-offer-compiler/`.
- Compiler API routes live in `apps/web/src/app/api/supplier-offer-compiler/`.
- UI currently has stable form state: idle, ready, and compiling states are distinct.
- The first migration for durable compiler tables is `supabase/migrations/20260706120000_supplier_offer_compiler_foundation.sql`.
- Do not apply that migration automatically during development unless explicitly requested.

Important current constraint:

The next product change should split parsing from persistence. The first user action should preview extraction JSON without requiring the `supplier_offer_*` tables. Only a later human approval/save action should persist compiler records to Supabase, and that save action should be disabled with a clear migration-needed message when the compiler tables are unavailable.

Next recommended step:

1. Add a preview-only API route, likely `apps/web/src/app/api/supplier-offer-compiler/preview/route.ts`.
2. Reuse the existing CSV/XLSX parser, normalization, validation, and pricing preview helpers.
3. Return temporary JSON containing document metadata, detected headers, extracted rows, extracted fields, normalized candidate fields, confidence/validation flags, and pricing preview.
4. Update `SupplierOfferCompilerView` so the primary button previews extraction, similar to the GRW converter.
5. Add a separate approval/save action that calls the persistence route only after human review.
6. Keep QuickBooks, VinoSmith, official products, and `supplier_catalog_wines` untouched.

Local verification:

```bash
cd apps/web
npx tsc --noEmit
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
- Buyer workbench rank is displayed in its own `Rank` column; the Wine column remains the product name plus Core/BTG flags.
- Velocity trend compares the latest 30-day RADs sales window against the prior 30-day window. If the prior period is zero and the latest period has sales, the buyer table displays `New`.
- Brand Manager is sourced from RB6 `Wine: External ID (1)` / `brand_manager`; Supplier Hub `TDM` is the editable supplier-level override.
- PO Draft review shows per-bottle laid-in cost, total wine cost, total laid-in cost, and estimated total cost.

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

## V1 Deployment

Streamlit exposed several buyer-workflow limits that are hard to solve cleanly in that framework: scroll position reset after table edits, awkward sticky/frozen table behavior, limited header/layout control, and constrained top navigation placement. V1 has moved to a standalone web app.

Production shape:

- Next.js frontend/app shell in `apps/web`.
- Supabase Auth for Google/email login.
- Supabase Postgres/Storage as the durable backend.
- Render hosting for the app.
- Existing Python/GitHub Actions worker remains responsible for daily Vinosmith email ingestion and calculation.
- Wix may link to or embed the app, but it should not host the operational runtime.

Render deployment notes:

- Production URL: `https://stmhq.com`.
- Render service URL: `https://winebook.onrender.com`.
- `render.yaml` defines the web service with root directory `apps/web`.
- The web app requires Node 20+.
- Production env vars are `NEXT_PUBLIC_SITE_URL`, `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, and `GITHUB_WORKFLOW_DISPATCH_TOKEN`.
- Optional workflow override env vars are `GITHUB_WORKFLOW_REPO`, `GITHUB_WORKFLOW_REF`, and `VINOSMITH_INGEST_WORKFLOW_ID`.
- The PO XLSX template is copied into `apps/web/templates/` so the export route works when Render deploys only the web app directory.

Supabase Auth redirects currently required:

- `https://stmhq.com/auth/callback`
- `https://www.stmhq.com/auth/callback`
- `https://winebook.onrender.com/auth/callback`
- `http://localhost:3000/auth/callback`

Deferred until after hosted V1 rollout:

- DI vs Stateside ordering mode.
- Ant Moore container-fill/container-mix logic.
- Brand-level DI defaults, transit times, and freight-forwarder rules.
- Delete SKU directly from an existing PO Draft.
- QuickBooks writeback/API sync.

## Verification

Run before pushing meaningful changes:

```bash
python -m compileall app.py wine_calculator.py stem_order tests scripts
python -m unittest discover -s tests
python scripts/smoke_ordering_pipeline.py
```

For the web app:

```bash
cd apps/web
npm run typecheck
npm run build
npm audit --audit-level=moderate
```

## Development Notes

- Keep calculation and ingest logic reusable outside Streamlit. Scheduled workers will need the same pipeline.
- Keep `display_df` UI-only; use raw numeric frames for calculations and persistence.
- Use Supabase service-role keys only in trusted server-side/local scripts.
- Supabase Cron is the scheduling source of truth. GitHub Actions remains the Python worker and can still be manually dispatched for debugging.
- The hosted-product direction is Next.js + Supabase Auth/Data on Render, with the existing Python worker retained for ingestion/calculation.
