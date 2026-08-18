# Ordering Source Bridge Next Steps

Branch: `codex/ordering-source-readiness-bridge`

## Current Decision

Stop trying to prove that the new database/API path matches the current report output. The report contains known bad data and should be treated only as the current live ordering input until the new path is ready.

The next goal is to build a better ordering input path from the real sources of truth, while keeping live Order Review report-driven.

## Source Of Truth

QuickBooks is source of truth for:

- Item master and item code
- Active item status
- FOB/cost
- Quantity on order
- Sales history, using invoices minus credit memos
- Pack size, from the item custom field `PACK SIZE`
- Vendors/suppliers identity

Vinosmith is source of truth for:

- `Available` inventory only for ordering availability

Stem is source of truth for:

- BTG marker
- Core marker
- Supplier logistics and operating settings: laid-in/trucking, ETA, pickup/freight, TDM
- Supplier/vendor classification and app workflow metadata

The current report/export files are not source of truth.

## Ordering Logic

For each active QuickBooks product item:

1. Match QuickBooks item code to Vinosmith wine code exactly.
2. Use `Vinosmith Available` as ordering availability.
3. Use `QuickBooks quantity_on_order` as on-order quantity.
4. Use QuickBooks invoice lines minus credit memo lines for sales windows.
5. Use QuickBooks `purchase_cost`, falling back to `average_cost`, for FOB/cost.
6. Use QuickBooks custom field `PACK SIZE` for pack size.
7. Use Stem-owned BTG/Core markers for target-day logic.
8. Show QuickBooks on hand as reference only; do not use it as ordering availability.

Recommendation math:

```text
weekly_velocity = last_30_day_net_sales / 4.345
target_days = BTG target days, Core target days, or Standard target days
target_qty = weekly_velocity * (target_days / 7)
base_recommended_qty_raw = max(0, target_qty - (vinosmith_available + quickbooks_on_order))
recommended_qty_raw = base_recommended_qty_raw * monthly_multiplier
recommended_qty_rounded = round to pack size using existing minimum/round-up rules
```

Unconfirmed line item quantity should not be part of the new ordering path.

## Next Implementation Slices

### 1. Ordering Markers

Create an app-owned marker source keyed by exact item code.

Database foundation added in `20260818110000_ordering_item_markers.sql`.

Fields:

- `item_code`
- `is_btg`
- `is_core`
- `marker_note`
- `note_source`
- `updated_by`
- `updated_at`
- change history for inserts, updates, and deletes

Workflow:

- Seed from a user-provided upload file.
- Match upload rows by exact item code to the product/item list.
- Add a sortable table with BTG and Core toggle columns.
- Save edits in Stem.
- Later add an export file so markers can be pushed back into Vinosmith if needed.

### 2. QuickBooks Pack Size

Read pack size from QuickBooks item custom field `PACK SIZE`.

Use item-name parsing only as fallback if needed.

### 3. QuickBooks Vendors And Supplier Mapping

QuickBooks vendors are already mirrored in `quickbooks_vendors`, but Stem suppliers are not yet linked to them.

Next work:

- Show QuickBooks vendors in the app.
- Link/classify vendors as wine vendors vs other vendors.
- Treat QuickBooks vendors as supplier identity source of truth.
- Keep Stem supplier logistics editable on top of the vendor identity.

### 4. Ordering Input Preview

Build a read-only preview table that does not change live ordering.

Columns should include:

- Item code
- Product name
- QB active status
- Vinosmith Available
- QB on hand, reference only
- QB on order
- QB FOB/cost
- QB pack size
- QB 30/60/90 day net sales
- Stem BTG/Core
- Calculated recommendation

### 5. Sales Performance Cache

Do not calculate all invoice and credit memo history from raw lines on every page load.

Preferred direction:

- Roll up net sales by item code and date or month.
- Recalculate recent windows regularly.
- Treat older windows as stable after 60-90 days unless an invoice or credit memo changes.
- When a credit memo arrives, mark affected item/date buckets dirty and recalculate only those buckets.

Possible table shape:

- `item_code`
- `sales_date` or `period_month`
- `invoice_qty`
- `credit_memo_qty`
- `net_qty`
- `last_recalculated_at`
- `dirty_reason`

## Guardrails

- Do not change live Order Review behavior yet.
- Do not change PO draft creation or exports yet.
- Do not save new database-derived recommendations into `reorder_recommendations` yet.
- Product Workspace remains read-only unless explicitly scoped otherwise.
- Keep Settings > Data Health focused on diagnostics and source readiness.
- Keep UX table-first and practical.
