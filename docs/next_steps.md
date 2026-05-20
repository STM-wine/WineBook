# Current Status & Next Steps

## Current Status

WineBook is now a Supabase-backed ordering dashboard with automated daily ingestion.

- GitHub repo: `https://github.com/STM-wine/WineBook`
- Ordering Dashboard runs locally in Streamlit.
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

1. Retest `Create PO Drafts` after applying the PO line schema-cache migration.
2. Confirm PO Drafts view shows Laid In Cost, Total Wine Cost, Total Laid In Cost, and Estimated Cost correctly.
3. Commit the Streamlit V1 checkpoint and use it as the reference implementation for the migration.
4. Begin migration to a standalone authenticated web app: Next.js + Supabase Auth/Data + Render.
5. Keep the existing Python ingestion/calculation worker in place during the frontend migration.

## Known Deferred Items

These should not block the Streamlit V1 checkpoint or migration start:

- DI vs Stateside ordering mode.
- Ant Moore full-container logic and container-mix recommendations.
- Brand-level DI defaults, custom transit times, and freight-forwarder rules.
- Weekly supplier cap logic beyond the current purchasing environment modifier.
- Delete/edit individual SKUs directly inside an existing PO Draft.
- More advanced draft lifecycle actions such as cancel/reopen/copy.
- Moving navigation into the browser/Streamlit top chrome; this is better handled in the post-Streamlit app shell.
- Frozen buyer-table columns and richer table interactions; these are primary reasons to move off Streamlit.
- QuickBooks writeback/API sync.

## V1 Migration Plan: Streamlit to Render

Current app is still Streamlit on localhost. The V1 deliverable target is a standalone authenticated web app hosted outside Streamlit, likely on Render.

Planned V1 production shape:

- Frontend/app shell: Next.js.
- Hosting: Render, not Vercel.
- Auth: Supabase Auth, initially Google sign-in and/or email sign-in.
- Database/storage: existing Supabase project and migrations.
- Worker: keep the current Python GitHub Actions worker for daily RB6/RADs ingestion and recommendation persistence.
- Wix: optional link or embed/entry point only; Wix is not the operational runtime.

Migration sequence:

1. Freeze the Streamlit app as the V1 reference workflow.
2. Build a Next.js app shell with Supabase Auth.
3. Read latest completed report run and recommendations from Supabase.
4. Rebuild Order Review with a controlled editable table that preserves scroll, supports sticky columns, and has clear autosave behavior.
5. Rebuild Supplier Hub logistics fields needed for V1, including TDM.
6. Rebuild PO Drafts view/export actions against existing Supabase tables.
7. Deploy to Render with environment-managed Supabase keys.
8. Smoke test daily ingestion, login, recommendation approval, PO draft creation, and PO export.

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
