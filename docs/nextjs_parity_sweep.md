# Next.js Parity Sweep

Last updated: 2026-05-21

Purpose: track the migration from the Streamlit Ordering Dashboard to the Next.js app so V1 does not accidentally leave useful workflow behind.

Deployment status: the Next.js app is live on Render at `https://stmhq.com`. Streamlit remains a reference/fallback app, not the production buyer runtime.

## Legend

- `Done`: implemented in Next.js.
- `Improved`: implemented with better UX than Streamlit.
- `Patched`: gap found during this sweep and fixed.
- `Gap`: not yet implemented.
- `Deferred`: intentionally post-V1 or post-migration.

## App Shell and Auth

| Streamlit capability | Next.js status | Notes |
| --- | --- | --- |
| Local-only app shell | Improved | Next.js app uses Supabase Auth and profile allowlist. |
| Top navigation: Order Review, Supplier Hub, Freight, PO Drafts | Done | URL-backed views instead of one long scroll. Supplier Board is hidden for V1 because it overlaps with Order Summary. |
| Create PO Drafts from top toolbar | Done | Global action remains available from the header. |
| Data date visible | Done | Header data-date pill. |
| User feedback after save/create | Done | Status message strip for saves, draft creation, and errors. |
| Production hosting | Done | Render service with `stmhq.com` custom domain. |

## Order Review

| Streamlit capability | Next.js status | Notes |
| --- | --- | --- |
| Metric cards: urgent, low, recommended, approved, PO value, suppliers | Done | Same core metrics. |
| Supplier filter | Done | Same behavior. |
| Brand Manager / TDM filter | Done | Uses recommendation `brand_manager`. |
| Wine / supplier / item search | Done | Search includes product name, planning SKU, product code, supplier, and brand manager. |
| Suggested-only filter | Done | Same behavior. |
| Supplier summary table | Done | Same core rollup fields. |
| Supplier workbench sections | Improved | Next uses native details sections plus AG Grid inside each supplier. |
| Expand all supplier workbenches | Done | Same behavior. |
| Show all active inventory items, not only suggested orders | Done | Current filtering defaults to all rows unless Suggested Only is checked. |
| Wine column pinned during horizontal scroll | Improved | AG Grid pins wine column. |
| Table edit does not reset scroll position | Improved | AG Grid avoids Streamlit rerun jumpiness. |
| Item # column | Done | Present in workbench grid. |
| TDM supplier context | Done | Shown in supplier workbench header rather than as a table column. |
| Rank | Patched | Restored supplier-level velocity rank in the workbench grid. |
| Core / BTG flags next to wine name | Done | Uses star / wine-glass flags in wine display. |
| Optional 60/90 day sales toggles per supplier | Patched | Added per-supplier workbench toggles. |
| Optional LY 60/90 day forecast toggles per supplier | Patched | Added per-supplier workbench toggles. |
| Weeks w/ Recommended editable | Patched | Editing target weeks recalculates Recommended Qty. |
| Recommended Qty editable | Done | Editing quantity updates local row and saves when row is approved. |
| Approval checkbox autosave | Done | Checkbox persists approval state through server action. |
| Calculated header explanations/tooltips | Patched | Added AG Grid header tooltips for calculated columns. |
| Duplicate active draft warning per supplier | Gap | Streamlit warns when a supplier already has an active draft; Next has draft status in PO Drafts but no per-supplier warning yet. |

## Supplier Hub

| Streamlit capability | Next.js status | Notes |
| --- | --- | --- |
| Supplier Logistics table | Improved | Search, pickup filter, inactive toggle, sticky supplier column, row states. |
| Add/edit supplier logistics | Done | Supports add/edit/active/TDM/laid-in/freight fields. |
| Load supplier logistics from `importers.csv` | Deferred | Normal workflow should be app-managed Supabase data. Could add an admin import later. |
| Search Wines subtab | Gap | Streamlit version is session-only catalog data; Next needs persistent model/schema before parity. |
| Add Wine subtab with pricing preview | Gap | Needs persistent supplier catalog tables before useful Next implementation. |
| Requests subtab | Gap | Needs persistent request model/schema. |
| Pending Product Creation subtab | Gap | Needs persistent catalog/request model/schema. |
| Upcoming Price Changes subtab | Gap | Needs persistent price-event model/schema. |

## Supplier Board

| Streamlit capability | Next.js status | Notes |
| --- | --- | --- |
| Supplier-level queue table | Deferred | Hidden for V1 because Order Summary now serves this supplier-level workflow. |
| Sort by urgency / value | Deferred | Revisit only if buyers need a separate supplier queue. |
| Show approved-progress context | Deferred | Revisit only if buyers need a separate supplier queue. |

## Freight

| Streamlit capability | Next.js status | Notes |
| --- | --- | --- |
| CA truck progress | Improved | Suggested/approved mode, progress bar, selected bottle count. |
| Bottles needed to full truck | Done | Uses 10,200 bottle / 850 case threshold. |
| FTL savings | Done | `$2 per case` savings once threshold is met. |
| Pickup-location summary | Improved | Adds wine cost, laid-in cost, estimated cost, and mode toggle. |
| Supplier rollups within pickup location | Improved | Expandable location cards show supplier-level freight details. |

## PO Drafts

| Streamlit capability | Next.js status | Notes |
| --- | --- | --- |
| Create one PO draft per supplier from approved lines | Done | Same global workflow. |
| Skip suppliers with active drafts | Done | Server action skips active draft suppliers. |
| Draft created feedback | Done | Status strip reports created/skipped/errors. |
| Draft status progression | Done | Mark Ready and Mark Entered. |
| Review existing drafts | Improved | Filterable summary cards and line detail tables. |
| CSV export | Done | Per-draft CSV. |
| XLSX export with Mark's template | Done | Global XLSX route exports current report-run drafts. |
| Laid-in, wine cost, total laid-in cost, estimated cost | Done | Present in app and export math. |
| Delete SKU from PO draft view | Done | Added line removal with Supabase delete policy. |
| Cancel entire PO draft | Patched | Draft and Ready for Entry cards now expose Cancel Draft. |

## Data Pipeline and Persistence

| Capability | Next.js status | Notes |
| --- | --- | --- |
| Reads latest completed report run | Done | Same persisted snapshot architecture. |
| Daily ingestion automation | Done | Supabase-triggered GitHub dispatch in place. |
| Supplier logistics managed in Supabase | Done | Replaces normal `importers.csv` editing. |
| Supabase Auth / profile access | Done | App profiles gate access. |
| Purchasing environment fields surfaced | Gap | Logic is ported into pipeline, but fields are not yet visible in Next UI. |
| DI / Ant Moore logic | Deferred | Explicitly planned after hosted V1 rollout. |

## Recommended Next Tasks

1. Wait for Render certificate status to finish if either custom domain still shows certificate pending.
2. Run manual workflow testing in Next.js: approve lines, create drafts, remove a line, export XLSX, cancel a draft, mark draft ready/entered.
3. Add per-supplier active-draft warning in Order Review if Mark wants it before broader rollout.
4. Decide whether Supplier Hub catalog subtabs are V1 or post-V1, because they require persistent supplier catalog/request/price-event schema to be useful in the hosted app.
