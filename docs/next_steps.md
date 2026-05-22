# Current Status & Next Steps

## Current Status

WineBook is now a hosted Supabase-backed ordering dashboard with automated daily ingestion.

- GitHub repo: `https://github.com/STM-wine/WineBook`
- Production app: `https://stmhq.com`
- Render service: `https://winebook.onrender.com`
- Ordering Dashboard still runs locally in Streamlit as a reference/fallback app.
- Supabase project is connected through local `.env`.
- Numbered and timestamped schema migrations live in `supabase/migrations/`.
- Daily Vinosmith email ingestion runs remotely: Supabase Cron triggers the GitHub Actions worker.
- GitHub Actions is no longer the primary scheduler; it is the worker and manual-debug entry point.
- RB6/RADs/importers parsing has been extracted into reusable modules.
- Recommendations are persisted to Supabase report runs.
- Dashboard reads the latest completed report run and supports supplier filtering, recommendation review, supplier summaries, location summaries, PO CSV/XLSX export, supplier PO drafts, PO draft review, and PO draft status changes.
- Recommendations default to `rejected` / `approved_qty = 0`, matching the ownership opt-in approval model.
- Buyers can edit either `Weeks w/ Recommended` or `Recommended Qty`; those controls stay synchronized.
- Active supplier PO drafts are guarded to reduce accidental duplicate drafts.
- True Available is calculated from RB6 as `Available Inventory - Unconfirmed Line Item Qty`.
- Velocity Trend compares the most recent 30-day sales window with the prior 30-day window and displays `New` when prior sales are zero but current sales exist.
- Calculated buyer-table columns include hover help with formulas.
- The legacy upload-first fallback is hidden from the app surface; reruns should use automation/manual GitHub dispatch or local scripts.
- Supplier Hub has been ported as an MVP foundation for supplier wine search, manual wine entry, bottle-level pricing, requests, supplier logistics management, pending product creation, and price-change tracking.
- Supplier logistics can be edited in-app and stored in Supabase `suppliers`; `importers.csv` is now a seed/fallback source.
- The Order Review toolbar, supplier workbench filters, editable recommendations, PO draft creation, PO draft review, and PO XLSX/CSV export are the current V1 Streamlit workflow.
- PO draft review now shows per-bottle laid-in cost, total wine cost, total laid-in cost, and estimated total cost. Existing draft rows fall back to calculating laid-in totals from `trucking_cost_per_bottle x approved_qty` when newer stored totals are missing.
- Brand Manager filtering is populated from RB6 `Wine: External ID (1)` / persisted recommendation `brand_manager`, with Supplier Hub `TDM` as the editable supplier-level override.
- Supplier workbench ranking is shown as a separate `Rank` column so wine names can remain clean and alphabetically scannable.
- The Next.js app in `apps/web` is the production V1 runtime. It includes Supabase Auth login, an app-profile allowlist check, latest-run Supabase reads, top-level order metrics, supplier sections, supplier/TDM/search filters, suggested-only filtering, expand-all supplier workbenches, autosave for recommended quantity/approval state, Supplier Hub logistics editing, Freight rollups, PO Draft creation/review/status updates, CSV export, and XLSX export.

## Business Direction

Use Stem's internal terminology:

- Vinosmith `Importer` = Stem `Supplier`
- User-facing app copy should say `Supplier`.
- Source compatibility code may still refer to `importer` where it maps Vinosmith fields.

The product goal is a simple buyer workflow:

1. Daily source data is ingested automatically.
2. Recommendations are already populated when a buyer opens the app.
3. Buyer filters by supplier, pickup location, or SKU.
4. Buyer edits target weeks or recommended quantities.
5. Buyer approves rows.
6. WineBook creates supplier PO drafts.
7. A human enters POs into QuickBooks initially.
8. Later, approved POs sync directly to QuickBooks.

## Immediate Priorities

1. Wait for Render SSL certificate issuance to complete for any pending custom domain.
2. Smoke test `https://stmhq.com`: login, latest report visibility, Order Review edits, approval autosave, PO draft creation, PO Draft review, XLSX export, and line/draft cleanup.
3. Confirm PO Drafts view shows Laid In Cost, Total Wine Cost, Total Laid In Cost, and Estimated Cost correctly in production.
4. Add any remaining Stem users in Supabase Auth and `app_profiles`.
5. Keep the existing Python ingestion/calculation worker in place; it remains the production ingestion path.

## Known Deferred Items

These should not block hosted V1 rollout:

- DI vs Stateside ordering mode.
- Ant Moore full-container logic and container-mix recommendations.
- Brand-level DI defaults, custom transit times, and freight-forwarder rules.
- Weekly supplier cap logic beyond the current purchasing environment modifier.
- More advanced draft lifecycle actions such as reopen/copy.
- Persistent Supplier Hub catalog/request/price-event subtabs.
- QuickBooks writeback/API sync.

## V1 Runtime: Next.js on Render

The V1 runtime is now a standalone authenticated web app hosted on Render.

Production shape:

- Frontend/app shell: Next.js.
- Hosting: Render, not Vercel.
- Auth: Supabase Auth, initially Google sign-in and/or email sign-in.
- Database/storage: existing Supabase project and migrations.
- Worker: keep the current Python GitHub Actions worker for daily RB6/RADs ingestion and recommendation persistence.
- Wix: optional link or embed/entry point only; Wix is not the operational runtime.

Remaining launch sequence:

1. Let Render finish certificate issuance if still pending.
2. Smoke test daily ingestion, login, recommendation approval, PO draft creation, and PO export on `https://stmhq.com`.
3. Gather Mark/Junaid feedback from real hosted use.
4. Polish V1 issues only, then move DI/Ant Moore and deeper Supplier Hub catalog work into the continuation phase.

## Data Roadmap

Current transitional feeds:

- RB6 inventory export
- RADs sales history export
- Supabase `suppliers` logistics table, seeded from tracked `importers.csv` as needed

Next expected feed:

- Additional Vinosmith report from Mark to validate/enhance product, placement, logistics, or producer data.

Future durable source:

- QuickBooks for product, vendor/supplier, inventory, and PO data.

## Engineering Priorities

- Keep Streamlit working while productizing.
- Keep daily ingest runnable both from GitHub Actions and locally for debugging.
- Keep parser/calculation/persistence logic outside `app.py`.
- Add tests around every business-rule change.
- Treat `.env`, RB6/RADs exports, PDFs, and other source reports as local data, not repo assets.
- Keep GRW converter code stable and separate unless explicitly brought into scope.

## Verification Commands

```bash
source .venv/bin/activate
python -m compileall app.py wine_calculator.py stem_order tests scripts
python -m unittest discover -s tests
python scripts/smoke_ordering_pipeline.py
```

Web app:

```bash
cd apps/web
npm run typecheck
npm run build
npm audit --audit-level=moderate
```
