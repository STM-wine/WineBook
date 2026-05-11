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

1. Apply `20260511161706_guard_github_ingest_dispatch.sql` in Supabase so successful daily ingestion stops further GitHub dispatches for that report date.
2. Watch one weekday morning run after that migration to confirm the reduced dispatch noise.
3. Work through Mark's next Linear issues against the buyer workbench.
4. Tighten the PO draft output around the actual QuickBooks entry workflow.
5. Decide the first hosted release strategy.

## Near-Term Product Work

- Continue replacing remaining user-facing `Importer` labels with `Supplier`.
- Add lightweight in-app operational visibility:
  - latest report date
  - latest ingest status
  - source files used
  - last successful automation time
- Improve PO draft formatting for real operations:
  - supplier header
  - pickup location
  - cases and bottles
  - estimated cost
  - status and entry notes
- Add better saved-draft affordances:
  - cancel draft
  - copy/reopen draft
  - clearer duplicate-draft message
- Add pickup-location hierarchy:
  - Pickup Location
  - Supplier
  - Producer
- Add California truck optimization details:
  - FTL progress
  - bottles/cases needed to reach FTL
  - estimated freight savings
- Move supplier logistics out of tracked `importers.csv` and into a Supabase table with an app editing surface.
- Add product/SKU pallet configuration table for future pallet-aware rounding.

## Hosting / Publication Questions

Current app is still Streamlit on localhost. For the first non-local release, likely options are:

- Streamlit Community Cloud or another Streamlit host for fastest path.
- A small hosted VM/container running Streamlit for more control.
- A new web frontend backed by Supabase for a more durable app shape.
- Eventually embedding or linking from Stem's existing website after authentication is settled.

Near-term recommendation: keep Streamlit while buyer workflow is still changing quickly, then choose the hosted path once the Linear issues clarify the stable surface.

## Data Roadmap

Current transitional feeds:

- RB6 inventory export
- RADs sales history export
- tracked `importers.csv` logistics reference data

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
