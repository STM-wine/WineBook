# QuickBooks Item Master Ordering Shadow Plan

Date: 2026-08-15

## Goal

Make QuickBooks Desktop the official item master/product brain without destabilizing the current buyer ordering workflow.

The current Order Review and PO Draft flow must remain safe for live ordering. Any QuickBooks item-master work should begin as read-only visibility, additive persistence, and shadow diagnostics before it influences recommendations, approvals, or PO exports.

## Business Direction

- New items start in WineBook / Stem Intelligence.
- Approved new items should eventually be created in QuickBooks.
- QuickBooks then becomes the official item master.
- Vinosmith remains important for live inventory and sales operations, but should not be treated as the final product brain.
- Current ordering is still report/feed driven, so QuickBooks data should first be compared against the current ordering path before replacing any source.

## Production Findings From 2026-08-15

Production Supabase project inspected: `hpnvlxvnzpojpfepcerl`.

QuickBooks item pull:

- `quickbooks_items`: 8,756 rows.
- Active items: 2,156.
- Inactive items: 6,600.
- Unknown active state: 0.
- Item checkpoint: completed.
- Item query pages: 44.
- Last response: `ItemQueryRq`, status OK, `iteratorRemainingCount: 0`.
- Last item response received at: 2026-08-15 15:27 UTC.
- `quickbooks_inventory_snapshots`: 0 rows.

QuickBooks field coverage:

| Field | Total present | Active present |
| --- | ---: | ---: |
| `quantity_on_hand` | 8,727 | 2,127 / 2,156 |
| `quantity_on_order` | 8,727 | 2,127 / 2,156 |
| `quantity_on_sales_order` | 8,676 | 2,127 / 2,156 |
| `average_cost` | 8,727 | 2,127 / 2,156 |
| `purchase_cost` | 8,729 | 2,129 / 2,156 |
| `sales_price` | 8,747 | 2,151 / 2,156 |

Cross-system mapping:

- `product_source_links` for QuickBooks: 0.
- `product_source_links` for Vinosmith: 8,525.

Current completed ordering data:

- Latest completed report date: 2026-08-13.
- Latest report diagnostics: `rb6_rows: 1603`, `rads_rows: 55091`, `recommendation_rows: 1363`.
- This confirms Order Review is still driven by report-generated `reorder_recommendations`, not QuickBooks item master rows.

QuickBooks sales-history requirement:

- Item master coverage is necessary but not sufficient for QuickBooks-backed ordering.
- Year-over-year ordering recommendations need QuickBooks invoice and credit memo history, especially the full 2025 calendar year.
- Deeper trend work should also pull full-year 2024 invoices and credit memos.
- The recovery queue already treats 2025 as the sales-truth priority year for `InvoiceQueryRq` and `CreditMemoQueryRq` windows.
- Before replacing RADs/Vinosmith report sales inputs, verify 2025 QuickBooks invoices and credit memos are complete and reconcile to the sales dashboard.
- Until that coverage is confirmed, QuickBooks should be used for item identity/cost/inventory shadow checks, not YOY recommendation generation.
- Gross profit and gross margin require a separate margin-truth plan; item current cost is not enough for historical GP. See `docs/quickbooks/gross-profit-truth-plan.md`.

## Current Ordering Path

Current buyer workflow:

1. `stem_order/pipeline.py` builds recommendations from RB6/inventory-style and RADs/sales-style data.
2. `report_runs` and `reorder_recommendations` store the latest completed report.
3. `apps/web/src/app/page.tsx` loads the latest completed report, recommendations, supplier catalog wines, PO drafts, and suppliers.
4. `apps/web/src/components/order-dashboard.tsx` merges `reorder_recommendations` with `supplier_catalog_wines`.
5. `apps/web/src/app/api/po-drafts/create/route.ts` creates PO draft lines from approved recommendation/catalog rows.
6. PO exports read the materialized `purchase_order_lines` fields.

Current source blend:

- RB6/Vinosmith-style inventory export data for product rows, available inventory, on-order, FOB, supplier/importer, and product code.
- RADs/sales report data for velocity and historical sales.
- `suppliers` and importer defaults for logistics/trucking.
- `supplier_catalog_wines` for manual/new items, pricing programs, and pending product creation.
- `purchase_order_drafts` and `purchase_order_lines` as materialized buyer approvals.

QuickBooks is currently used in product identity search, not as the ordering source of truth.

## Safety Rule

Do not merge changes that alter live Order Review, approvals, recommended quantities, PO Draft creation, PO line fields, CSV export, or XLSX export unless the behavior is behind a disabled-by-default feature flag.

Ryan's live weekend ordering flow must continue to use the existing report-driven workflow until the QuickBooks-backed path has parity evidence and explicit approval.

## Branch Strategy

Create implementation work on a branch:

```bash
git switch -c codex/qb-item-master-shadow-workflow
```

Keep the branch additive and reviewable:

- Add docs and read-only dashboards first.
- Add additive persistence second.
- Add identity fixes before any ordering changes.
- Add shadow diagnostics before feature-flagged behavior.
- Keep default runtime behavior unchanged.

## Recommended Implementation Phases

### Phase 1: Documentation And Read-Only Visibility

Build a QuickBooks Item Master dashboard/admin view.

Requirements:

- Show total active/inactive item counts.
- Show item type counts.
- Show missing field counts for quantity/cost/price.
- Show item pull freshness and checkpoint status.
- Show inactive item volume and warn that inactive rows are stored but filtered out of current match search.
- Do not affect Order Review, approvals, or PO Drafts.

Acceptance criteria:

- Buyers can still use the existing Order Review without UI or behavior changes.
- Admin/data users can inspect QuickBooks item-master health.
- The view is read-only.

### Phase 2: Add QuickBooks Inventory Snapshot Persistence

Current behavior updates quantity/cost fields directly on `quickbooks_items`. The schema already has `quickbooks_inventory_snapshots`, but production has 0 rows.

Requirements:

- Keep updating `quickbooks_items` exactly as today.
- Also insert one `quickbooks_inventory_snapshots` row per inventory item per completed item pull/sync run.
- Include `quantity_on_hand`, `quantity_on_order`, `quantity_on_sales_order`, `average_cost`, `raw_response_id`, and `raw_data`.
- Respect the existing unique key: `(source_sync_run_id, item_list_id)`.
- If a response has no sync run ID, use a safe fallback design before writing. Do not fake a sync run ID.

Acceptance criteria:

- Existing item persistence remains compatible.
- Snapshot writes are additive.
- Tests cover item persistence with snapshot-eligible and snapshot-ineligible rows.
- No ordering screen reads snapshots yet.

### Phase 3: Fix QuickBooks Identity Semantics

Important current risk: QuickBooks `list_id` is being used as `quickbooksItemNumber` in identity candidates. `ListID` is stable, but it is not necessarily the buyer/accounting-facing item number or SKU.

Requirements:

- Treat `list_id` as `quickbooks_item_id`.
- Treat `name` or a parsed/source-specific item code as the buyer-facing item number only when confirmed.
- Do not export `ListID` as the PO line item code.
- Preserve stable matching on `list_id`.
- Add inactive-item duplicate detection as a separate mode.

Acceptance criteria:

- Product identity matches still include QuickBooks candidates.
- Supplier Catalog linking stores QuickBooks stable ID separately from buyer item code.
- New-item warnings are not cleared merely because a hidden internal ID exists unless the actual item number/code is available or the workflow explicitly accepts the linked QuickBooks item.

### Phase 4: Shadow Item Truth View

Build an ordering-focused comparison layer without changing ordering decisions.

Requirements:

- For each current recommendation row, attempt to find matching QuickBooks item(s).
- Show current report quantity/cost fields beside QuickBooks fields.
- Include Vinosmith fields where available.
- Flag mismatches:
  - Missing QuickBooks item.
  - Inactive QuickBooks item used by current report/product code.
  - Duplicate active candidates.
  - Duplicate inactive candidates.
  - Cost mismatch.
  - Quantity mismatch.
  - Pack/vintage/bottle-size mismatch.
- Store or render diagnostics separately from `reorder_recommendations`.

Acceptance criteria:

- Current PO Draft generation remains unchanged.
- The app can answer, "What would QuickBooks say for this item?" without using that answer to order wine.

### Phase 4A: QuickBooks Sales Coverage And YOY Readiness

Build explicit coverage checks before any QuickBooks-based recommendation logic.

Requirements:

- Show QuickBooks invoice and credit memo coverage for:
  - Current year to date.
  - Full 2025 calendar year.
- Show 2025 backfill queue status for invoices and credit memos.
- Treat invoice sales minus credit memos as the QuickBooks sales truth basis.
- Compare QuickBooks sales history against RADs/Vinosmith report sales in shadow mode before replacement.
- Do not use QuickBooks sales history to compute recommended quantities until the 2025 coverage is complete and reconciled.

Acceptance criteria:

- The app can answer whether 2025 QuickBooks sales history is complete enough for YOY comparisons.
- Recommendation generation remains report-driven while coverage is incomplete.
- Any future YOY recommendation logic can point to a verified QuickBooks sales-history source.

### Phase 5: Feature-Flagged QuickBooks Enrichment

Only after shadow parity looks good, add disabled-by-default enrichment.

Suggested flags:

```bash
ORDERING_ITEM_TRUTH_SOURCE=current
ORDERING_QUICKBOOKS_ENRICHMENT_ENABLED=false
ORDERING_INCLUDE_INACTIVE_QB_DUPLICATE_CHECK=true
```

Requirements:

- Default production behavior remains `current`.
- QuickBooks enrichment can be enabled in a safe non-production environment first.
- The enrichment layer should never silently replace buyer-approved quantities.
- Any changed PO export field must be explicitly reviewed.

Acceptance criteria:

- Feature flag off: no buyer workflow behavior changes.
- Feature flag on in staging/local: diagnostic comparison shows exact fields changed and why.

## Future New Item Workflow

Recommended lifecycle:

1. User creates a new item candidate in WineBook / Supplier Hub.
2. WineBook validates supplier, producer, wine name, vintage, pack size, bottle size, cost, price, margin, and tags.
3. Duplicate check runs against:
   - QuickBooks active items.
   - QuickBooks inactive items.
   - Vinosmith wines.
   - Supplier Catalog.
   - Recent recommendations.
4. Buyer/admin approves the item.
5. Record moves to `pending_create`.
6. Controlled QuickBooks write path creates the item.
7. QuickBooks returns `ListID`, `EditSequence`, `Name`, and `FullName`.
8. Stem stores the official QuickBooks link on the product/catalog row and in `product_source_links`.
9. The next QuickBooks item pull confirms the item in `quickbooks_items`.
10. Vinosmith receives or maps the official item code for operational sync.

## Data Model Needs

Near-term:

- Keep `quickbooks_items` as current item master mirror.
- Start writing `quickbooks_inventory_snapshots`.
- Add a curated app-facing/admin view or API for QuickBooks item health.
- Add explicit semantics for internal QuickBooks `list_id` vs item number/code.

Likely future:

- `product_source_links` entries for QuickBooks items.
- A Stem-owned item/product truth table or view that reconciles QuickBooks, Vinosmith, supplier catalog, and report recommendations.
- Item audit fields for renamed items, inactive transitions, and duplicate resolution.

## Known Risks

- Inactive items are stored but current match search filters to active/null only.
- QuickBooks internal `ListID` can be confused with buyer-facing item number.
- Renamed items require `ListID` continuity and `EditSequence` tracking.
- Duplicate vintages/formats require pack, vintage, and bottle-size checks, not fuzzy name matching only.
- Vendor/supplier assignment may not be complete enough in the current item parser.
- Pack size and bottle size are currently inferred from names/custom fields in some paths.
- `average_cost`, `purchase_cost`, supplier FOB, and landed cost have different business meanings.
- Inventory timing matters; without snapshots, updated item fields overwrite prior quantities.
- Vinosmith operational availability and QuickBooks accounting quantity may disagree.
- PO exports must not use hidden internal IDs as item codes.

## First Safe Work Slice

Start with:

1. Create the branch.
2. Add this handoff doc.
3. Add read-only QuickBooks item master data-access helpers.
4. Add tests for QuickBooks identity semantics.
5. Add the inventory snapshot persistence path only if the current persistence code exists in this checkout.

Do not start by changing Order Review or PO Draft behavior.
