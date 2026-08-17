# Product Workspace Build Plan

## Purpose

Stem Intelligence needs a durable Product Workspace under Products that can become the working home for items, pricing, landed cost, depletion allowances, GP, active/inactive lifecycle, and future item creation.

QuickBooks, Vinosmith, Supplier Hub, supplier logistics, and future supplier price-list uploads should remain valid inputs. Over time, Stem Intelligence should become the operational source of truth for pricing work, item setup decisions, overrides, and product intelligence.

## Current State

- The current `public.products` table is the original ordering product table. It is useful but thin: SKU, product code, name, vintage, pack, supplier, current FOB, active flag, and a few flags.
- QuickBooks item mirror exists in `quickbooks_items` and is the best current source for FOB/item identity where available.
- Vinosmith mirror exists in `vinosmith_wines` and `vinosmith_prices` and is useful for wine metadata, item code, price levels, and operational state.
- Supplier logistics live in Supabase `suppliers`, including `trucking_cost_per_bottle`; these are currently the practical laid-in source.
- Supplier Hub already has strong product/pricing primitives:
  - `supplier_catalog_wines`
  - `supplier_catalog_price_levels`
  - `supplier_catalog_free_goods`
  - `price_change_events`
  - matching/search against Supplier Catalog, Stem Product, Recommendations, Vinosmith, and QuickBooks.
- Supplier Hub was intentionally designed as supplier-available/catalog/new-item workflow, not as the official Stem product brain. Do not overload it into the canonical product table without a migration plan.

## Core Product Decision

Build a canonical Product Workspace layer above the current source systems.

Do not make QuickBooks Items the workspace. Do not make Vinosmith the workspace. Do not make Supplier Hub the workspace. Reuse their data and UX patterns, but put a Stem-owned product/pricing model in the middle.

The key missing idea is field-level source of truth:

- FOB should currently come from QuickBooks.
- Laid-in cost should currently come from supplier logistics.
- Price levels may come from Vinosmith, Supplier Hub, supplier uploads, or manual Stem overrides.
- GP is Stem-calculated from sale price, depletion allowance, FOB, laid-in cost, and revenue center rules.
- Manual overrides must be allowed with reason, timestamp, and source clarity.

## Recommended Data Model Direction

Create a new canonical layer rather than forcing everything into the existing thin `public.products` table immediately. Names can change during implementation, but the shape should be:

### `stem_products`

One canonical Stem row per saleable item/vintage/pack/size.

Important fields:

- `id`
- `canonical_sku`
- `item_code`
- `display_name`
- `brand`
- `producer`
- `wine_name`
- `vintage`
- `pack_size`
- `bottle_size`
- `category`
- `supplier_id`
- `supplier_name`
- `revenue_center` such as `stem_core` or `grw_broker`
- `lifecycle_status` such as `active`, `inactive`, `candidate`, `pending_setup`, `archived`
- `is_core`
- `is_btg`
- `created_at`
- `updated_at`

### `stem_product_source_links`

This is the spine that keeps us from rematching the same item forever.

Important fields:

- `product_id`
- `source_system`: `quickbooks_desktop`, `vinosmith`, `supplier_catalog`, `supplier_upload`, `manual`, `stem`
- `source_id`
- `source_code`
- `source_name`
- `match_confidence`
- `is_primary`
- `link_status`
- `last_seen_at`
- `created_at`
- `updated_at`

### `stem_product_costs`

Tracks cost basis and provenance.

Important fields:

- `product_id`
- `fob_bottle`
- `fob_case`
- `fob_source_system`
- `laid_in_per_bottle`
- `laid_in_source_system`
- `tax_per_bottle`
- `freight_per_bottle`
- `landed_bottle_cost`
- `effective_start_date`
- `effective_end_date`
- `is_current`
- `override_reason`
- `created_at`

### `stem_product_price_levels`

Canonical price-level model, influenced by Vinosmith/Supplier Hub but not trapped inside either.

Important fields:

- `product_id`
- `name`
- `bottle_price`
- `case_price`
- `depletion_allowance`
- `bill_back_amount`
- `target_gp_margin`
- `calculated_gp_margin`
- `is_frontline`
- `is_best`
- `premise`
- `marketplace`
- `effective_start_date`
- `effective_end_date`
- `active`
- `source_system`
- `source_id`
- `override_reason`

### `stem_product_free_goods`

Reuse Supplier Hub's free-goods shape, but attach to canonical products.

Important fields:

- `product_id`
- `buy_quantity`
- `free_quantity`
- `unit`
- `program_name`
- `starts_on`
- `ends_on`
- `active`
- `notes`

### `stem_product_change_events`

Generalize `price_change_events` so product/cost/price changes have a clear review trail.

Important fields:

- `product_id`
- `change_type`
- `status`: `draft`, `pending_review`, `approved`, `published`, `rejected`
- `before_payload`
- `after_payload`
- `effective_date`
- `reason`
- `created_by`
- `approved_by`
- `created_at`
- `approved_at`

### Future Supplier Upload Tables

These come after the canonical workspace exists.

- `supplier_price_list_uploads`
- `supplier_price_list_rows`
- `supplier_product_candidates`
- `supplier_candidate_source_links`
- `supplier_candidate_price_levels`
- `supplier_candidate_decisions`

Supplier uploads should create candidates and suggestions. They should not automatically create official products.

## Product Workspace UX

The Products > Items page should evolve from a QuickBooks item health page into the Product Workspace.

Default view:

- Active products only.
- Fast search.
- Inactive lookup available but not noisy.
- Table-first experience, not a marketing page.
- Quicksand font wherever possible.
- Modern, clean, dense enough for repeated admin use.

Primary table columns:

- Item code
- Product / brand
- Vintage
- Pack
- Supplier / importer
- Revenue center
- FOB
- Laid-in
- Landed cost
- Frontline
- Best price
- Average GP %
- Last sold
- YTD sales
- Active status
- Source health

Sorting/filtering:

- Brand
- Supplier/importer
- Revenue center
- Active/inactive
- Price level
- GP %
- FOB
- Laid-in
- Price
- Last sold
- Source status

Row drawer tabs:

- Overview
- Pricing
- Cost Basis
- Sources
- Sales / GP
- Inventory
- History

The row drawer is important because the table should stay clean while the workspace still has depth.

## Build Order

### Phase 1: Product Workspace V1, Read-Only

Goal: useful item/pricing table without changing source-of-truth behavior.

Build:

- Replace or evolve Products > Items into Product Workspace.
- Load active QB/Vinosmith/Supplier Hub matched items.
- Show inactive only when toggled/searched.
- Display source badges for QB, Vinosmith, Supplier Hub, Stem.
- Show calculated landed cost and GP.
- Add row drawer with Overview, Pricing, Cost Basis, Sources.
- Keep existing QuickBooks item health page either as a subtab or diagnostic link.

Stopping point for review:

- User can browse active products, sort/filter, inspect a row, and understand where numbers came from.

### Phase 2: Canonical Product Foundation

Goal: introduce the Stem-owned product/pricing layer.

Build:

- Add canonical product/source/cost/price/free-good/change-event migrations.
- Backfill canonical products from current QB/Vinosmith/Supplier Hub matches.
- Store source links instead of relying only on fuzzy matching.
- Keep read-only UI pointed at canonical views where possible.

Stopping point for review:

- User can see the same Product Workspace, but rows are now backed by canonical Stem products and source links.

### Phase 3: Manual Overrides

Goal: allow Stem to correct pricing/cost/workspace fields before Stem becomes full source of truth.

Build:

- Editable cost and pricing drawer sections.
- Override reason required.
- Preserve source-of-truth labels.
- Show effective dates.
- Create change events for edits.
- Add draft/pending/approved state where needed.

Stopping point for review:

- User can override a price/cost field safely and see an audit trail.

### Phase 4: New Item Builder

Goal: create potential/new items inside Stem Intelligence.

Build:

- Reuse Supplier Hub Add Wine form and matching logic.
- Allow start-from existing QB/Vinosmith/Supplier Catalog row.
- Allow manual from-scratch item.
- Calculate suggested pricing from FOB, laid-in, GP target, and price rules.
- Save as candidate or pending item setup.
- Do not write to QuickBooks yet.

Stopping point for review:

- User can create a pending item/candidate and see pricing suggestions.

### Phase 5: Supplier Price-List Upload

Goal: supplier price lists become candidate rows, not chaos.

Build:

- Upload file.
- Parse rows.
- Match to canonical products and known sources.
- Flag new vintage/new format/net new/possible match.
- Generate suggested FOB/laid-in/price/GP changes.
- Allow bulk review with manual overrides.

Stopping point for review:

- User can upload a supplier list, review candidate matches, and approve only intentional changes.

### Phase 6: Publishing / Source Writeback

Goal: Stem becomes the working source of truth while respecting external systems.

Build later:

- Publish approved price changes.
- Export or sync changes to QuickBooks/Vinosmith.
- Track published state and failures.
- Keep manual review before financial system writes.

## Rules To Preserve

- Simplicity first.
- Table-first admin UX.
- No clutter.
- Dollar amounts must show two decimal places.
- GP math must be explainable by tooltip/source labels.
- FOB should be QuickBooks until explicitly changed.
- Laid-in cost currently comes from supplier logistics.
- GRW should remain separated by revenue center.
- Active products should be default; inactive lookup must be available.
- Supplier CSV should not be treated as future source of truth.

## Immediate Next Implementation Slice

Start with Phase 1.

Concrete first task:

Build `Products > Items` into a read-only Product Workspace table using current data sources, preserving the existing QuickBooks item health diagnostics as a secondary view.

Do not begin supplier price-list upload until the canonical product foundation is in place.

Do not move ordering logic onto this product foundation until the Product Workspace proves the model and source links are stable.

