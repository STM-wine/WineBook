# Current Status & Next Steps

## Current Status

WineBook has moved beyond the original local MVP shape.

- GitHub repo: `https://github.com/STM-wine/WineBook`
- Ordering Dashboard runs locally in Streamlit.
- Supabase project exists and is connected through local `.env`.
- Numbered schema migrations live in `supabase/migrations/`.
- Daily Vinosmith email automation has a GitHub Actions workflow and Python processing script.
- RB6/RADs/importers parsing has been extracted into reusable modules.
- Recommendations can be saved to Supabase report runs.
- Dashboard reads the latest saved report run and supports supplier filtering, recommendation review, supplier summaries, location summaries, PO CSV export, and transitional supplier PO draft creation.
- Recommendations now default to `rejected` / `approved_qty = 0`, matching the ownership opt-in approval model.

## Business Direction

Use Stem's internal terminology:

- Vinosmith `Importer` = Stem `Supplier`
- User-facing app copy should say `Supplier`.
- Source compatibility code may still refer to `importer` where it is mapping Vinosmith fields.

The product goal is a simple buyer workflow:

1. Daily source data is ingested automatically.
2. Recommendations are already populated when a buyer logs in.
3. Buyer filters by supplier, pickup location, or SKU.
4. Buyer approves or edits quantities.
5. WineBook creates supplier PO drafts.
6. A human enters POs into QuickBooks initially.
7. Later, approved POs sync directly to QuickBooks.

## Immediate Priorities

1. Apply `005_daily_email_ingest.sql` in Supabase before the first automated run.
2. Add GitHub Actions secrets for Supabase, mailbox access, and `IMPORTERS_CSV_BASE64`.
3. Run the `Daily Vinosmith Ingest` workflow manually with `workflow_dispatch` to validate mailbox access.
4. Add in-app approval controls for recommendation rows instead of only defaulting rows to rejected in the database.
5. Persist approved quantities and status changes back to Supabase.
6. Update PO draft creation to use approved lines/approved quantities instead of raw recommended quantities.

## Near-Term Product Work

- Rename remaining user-facing `Importer` labels to `Supplier`.
- Add explicit buyer workflow states: `rejected`, `approved`, `edited`, `deferred`.
- Add a saved PO draft review screen.
- Add pickup-location hierarchy:
  - Pickup Location
  - Supplier
  - Producer
- Add California truck optimization details:
  - FTL progress
  - bottles/cases needed to reach FTL
  - estimated freight savings
- Add trucking-cost-per-bottle support to `importers.csv` or a Supabase logistics table.
- Add product/SKU pallet configuration table for future pallet-aware rounding.

## Data Roadmap

Current transitional feeds:

- RB6 inventory export
- RADs sales history export
- local `importers.csv`

Next expected feed:

- Additional Vinosmith report from Mark to validate/enhance product, placement, logistics, or producer data.

Future durable source:

- QuickBooks for product, vendor/supplier, inventory, and PO data.

## Engineering Priorities

- Keep Streamlit working while productizing.
- Keep daily ingest runnable both from GitHub Actions and locally for debugging.
- Keep parser/calculation/persistence logic outside `app.py`.
- Add tests around every business-rule change.
- Treat `importers.csv`, `.env`, RB6/RADs exports, and PDFs as local data, not repo assets.
- Keep GRW converter code stable and separate unless explicitly brought into scope.

## Verification Commands

```bash
source .venv/bin/activate
python -m compileall app.py wine_calculator.py stem_order tests scripts
python -m unittest discover -s tests
python scripts/smoke_ordering_pipeline.py
```
