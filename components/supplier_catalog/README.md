# Supplier Hub

## Overview

Supplier Hub is the foundation for Stem Wine Company's internal supplier wine intelligence workflow. It is designed to replace the current Wine Needs spreadsheet process with a searchable, structured, operational catalog of supplier-available wines.

The first version is intentionally manual-entry only. It establishes the architecture for supplier wine availability, bottle-level pricing, wine requests, approval workflows, price change tracking, and deterministic wine name normalization. Later phases can layer on supplier price list ingestion, PDF processing, AI extraction, duplicate detection, and automated communication without rewriting the core concepts.

Supplier Hub supports:

- Searchable supplier wine intelligence
- Supplier available wine catalog management
- Manual wine request workflows for reps and managers
- Bottle-level pricing and gross profit diagnostics
- Approval workflow foundations
- Pending Stem product creation workflows
- Upcoming price change tracking
- Future supplier price list ingestion

## Core Concepts

Supplier Hub intentionally separates three related but distinct business objects.

### 1. Stem Active Product

A Stem Active Product is an item that exists in Stem's active product system and can be sold, inventoried, ordered, and eventually represented in downstream systems such as QuickBooks or purchase order workflows.

Stem Active Products are not created automatically by this MVP.

### 2. Supplier Available Wine

A Supplier Available Wine is a wine that a supplier or importer has available, or may have available, for Stem to consider. It can be searched, priced, requested, reviewed, and tracked before it becomes a Stem product.

Not every supplier wine should become an active Stem product.

### 3. Requested Wine

A Requested Wine is a rep or manager request tied to an account need, placement type, requested quantity, needed-by date, and approval decision.

A request can refer to an existing Stem product, a supplier available wine, or a net new wine. Approval does not mean the wine has been ordered. It means the request is accepted into the ordering workflow for the next appropriate cycle.

### Why These Are Separate

The separation prevents Supplier Hub from collapsing supplier intelligence, sales demand, and Stem product lifecycle into one object too early. That matters because:

- Not every supplier wine becomes a Stem product.
- Not every request becomes inventory.
- Not every available wine is approved.
- Approved requests may become special orders rather than standard products.
- Future supplier price list ingestion must preserve raw availability before matching or conversion.

## Current MVP Scope

Included in this first pass:

- Manual supplier wine entry
- Searchable supplier wine catalog
- Request workflow foundation
- Approval workflow foundation
- Bottle-level pricing engine
- Best price calculation
- Gross profit warning diagnostics
- Price change tracking foundation
- Upcoming price changes table
- Deterministic wine name normalization service
- QuickBooks display name foundation
- Planning SKU foundation
- Lightweight importer ordering workflow payloads
- Local/session-state storage only

Intentionally not included yet:

- OCR
- AI extraction
- Autonomous PDF parsing
- Automated supplier ingestion
- Live supplier integrations
- Advanced fuzzy matching
- Automatic SKU creation
- Automated purchase order generation
- Complex RBAC
- Hard coupling to unfinished Supabase schema

## Navigation Structure

The top navigation is:

- Order Review
- Supplier Hub
- PO Drafts
- Freight

Supplier Hub is a standalone module in the Streamlit app. PO Drafts and Freight currently remain tied to the existing ordering dashboard workflow while the module structure matures.

## Supplier Hub Tabs

### Search Wines

Table-driven supplier catalog search. Filters include supplier, wine name, producer, and vintage.

### Add Wine

Manual entry workflow for supplier/importer selection, wine identity, pack format, FOB pricing, laid-in cost, availability status, and match/conversion status.

Supplier selection is the first step. After a supplier is selected, the app loads `laid_in_per_bottle` from `importers.csv` and uses it as the default landed-cost input. Users can override it manually.

### Requests

Request creation and approval workflow. Reps and managers can request existing supplier catalog wines or net new wines, and approvers can approve, reject, hold, approve as special order, or approve as new Stem product.

Approved requests expose a lightweight importer ordering queue payload.

### Pending Product Creation

Operational queue for wines or approved requests that may need Stem product creation. This includes net new products, new vintages, new formats, and possible matches needing review.

### Upcoming Price Changes

Structured view of price change events generated when FOB or calculated frontline changes. It includes an email-friendly summary and CSV export foundation.

## Pricing Logic

All pricing calculations operate at the bottle level.

Users can enter either:

- Bottle FOB
- Case FOB

The pricing engine calculates the missing value from pack size.

### FOB Handling

If bottle FOB is provided:

```text
fob_case = fob_bottle * pack_size
```

If case FOB is provided:

```text
fob_bottle = fob_case / pack_size
```

### Laid-In Cost

Supplier Hub loads `laid_in_per_bottle` from `importers.csv` for the selected supplier/importer. This becomes the default laid-in cost and remains editable.

### Landed Bottle Cost

```text
landed_bottle_cost = fob_bottle + laid_in_per_bottle
```

### Frontline Bottle Price

```text
frontline_bottle_price = CEILING(landed_bottle_cost / 0.68)
```

### Gross Profit Margin

```text
gross_profit_margin =
  (frontline_bottle_price - landed_bottle_cost)
  / frontline_bottle_price
```

If gross profit margin is below 27%, Supplier Hub shows a warning and includes that warning in structured pricing diagnostics.

All pricing outputs remain editable in the UI foundation.

## Best Price Rules

Best price is based on the calculated wholesale frontline bottle price.

```text
IF frontline_bottle_price >= 50:
  no best price; frontline only

IF frontline_bottle_price >= 20 AND frontline_bottle_price <= 49:
  best_price = frontline_bottle_price - 2

IF frontline_bottle_price < 20:
  best_price = frontline_bottle_price - 1
```

Operationally:

- $50 and above: no best price
- $20-$49: frontline minus $2
- Under $20: frontline minus $1

Best price is displayed clearly, remains editable, and is included in structured outputs.

## Wine Name Normalization

Wine name normalization is centralized in `services/normalization_service.py`.

The canonical QuickBooks item naming format is:

```text
Producer Name + Wine Name/Fantasy Name + Vintage or NV + Pack Format
```

Examples:

```text
Domaine Hudelot Baillet Bonnes Mares GC 2023 6/750ml
Dunn Vineyards Howell Mountain Cabernet 2014 6/1.5L
Tor Pure Magic 2022 3/750ml
Neboa Albarino KEG 2024 1/20L
Champagne Savart 1er Cru les Nous 2021 6/750ml
Champagne Pierre Peters Cuvee de Reserve GC NV 12/750ml
Chateau Montrose Saint Estephe 2014 12/375ml
```

### Champagne Rules

All Champagne products must begin with `Champagne`.

Examples:

```text
Champagne Savart 1er Cru les Nous 2021 6/750ml
Champagne Pierre Peters Cuvee de Reserve GC NV 12/750ml
```

### NV Handling

If no vintage exists, Supplier Hub uses `NV`.

### Pack Formatting

Pack formats use `/` as the separator:

```text
12/750ml
6/1.5L
1/20L
```

Rules:

- `ml` is lowercase.
- `L` is uppercase.
- Pack size is preserved.

### Planning SKU Strategy

The normalized display name becomes the canonical QuickBooks item name and `display_name`.

Supplier Hub also generates `planning_sku` separately for future matching logic:

- Lowercase
- Normalized spacing
- Punctuation removed where appropriate
- Pack format preserved
- `NV` preserved as `nv`
- Optional vintage removal supported for future fuzzy matching

This foundation is intended to support future supplier ingestion, duplicate detection, new vintage matching, format matching, QuickBooks item creation, and catalog searching.

## Workflow Overview

The intended workflow is:

```text
Supplier Wines
  -> Rep Request
  -> Approval
  -> Ordering Dashboard
  -> PO Workflow
  -> Optional Stem Product Creation
```

Approval means the request should appear in importer ordering review and remain visible until the next order cycle. It does not mean the item has been ordered or received.

## Request Workflow

Required request fields:

- Account/customer
- Requested quantity
- Needed by date
- Placement type

Placement type options:

- BTG
- List
- Shelf
- Club
- Special Order
- Other

If placement type is `Other`, notes are required.

Optional request fields:

- Notes/comments
- Requester name

Request status values:

- `pending_review`
- `approved`
- `rejected`
- `on_hold`

Fulfillment status values:

- `waiting_for_next_order`
- `added_to_po`
- `ordered`
- `received`
- `cancelled`

MVP approvers are:

- Mark
- Ryan
- John

Approver actions:

- Approve
- Reject
- Place on hold
- Approve as special order
- Approve as new Stem product

The MVP uses simple `is_approver` logic only. It does not implement complex RBAC.

## Price Change Intelligence

Supplier Hub creates a `price_change_event` when either of the following changes:

- FOB
- Calculated frontline bottle price

Price change events include:

- Supplier
- Wine
- Vintage
- Old FOB
- New FOB
- Old frontline
- New frontline
- Old best price
- New best price
- Margin before
- Margin after
- Effective date
- Reason
- Status
- FOB increase flag

Statuses:

- `draft`
- `pending_review`
- `approved`
- `communicated`
- `live`

FOB increases are visually flagged. The current MVP does not send automated emails, but the output is designed for future email-friendly summaries, internal reporting, and team communication workflows.

## Architecture Notes

Supplier Hub follows a modular architecture:

```text
components/supplier_catalog/
  search_wines.py
  add_wine.py
  requests.py
  pending_product_creation.py
  upcoming_price_changes.py
  module.py

services/
  pricing_engine.py
  supplier_catalog_service.py
  request_workflow_service.py
  normalization_service.py
  price_change_service.py

models/
  supplier_available_wine.py
  wine_request.py
  price_change_event.py
```

Guiding architecture principles:

- Keep Streamlit components thin.
- Keep pricing logic in `pricing_engine.py`.
- Keep name normalization centralized in `normalization_service.py`.
- Keep request approval logic in `request_workflow_service.py`.
- Keep price-change detection in `price_change_service.py`.
- Keep internal objects flexible until the Supabase schema is finalized.
- Preserve the distinction between active products, supplier available wines, and requests.

## Future Roadmap

Planned future phases:

- Supplier file upload workflow
- Raw supplier data preservation
- Supplier-specific normalization adapters
- Shared normalization engine expansion
- PDF parsing
- OCR
- AI-assisted extraction
- Supplier catalog automation
- Duplicate detection
- New vintage matching
- New format matching
- Search intelligence
- QuickBooks item creation workflow
- Automated price change communication
- Approval-to-ordering dashboard persistence
- Supabase-backed catalog tables once schema decisions are final

## Development Notes

For future developers and AI-assisted development sessions:

- Do not tightly couple Supplier Hub to an unfinished Supabase schema.
- Do not write destructive database operations from this MVP module.
- Do not overengineer fuzzy matching early.
- Preserve raw supplier data when ingestion is introduced.
- Keep deterministic normalization centralized.
- Add supplier-specific normalization as adapters, not one-off UI logic.
- Keep all pricing calculations bottle-level.
- Do not collapse Supplier Available Wine, Requested Wine, and Stem Active Product into one object.
- Avoid modifying existing ordering workflows unless the integration is explicit and low-risk.
- Approval should create ordering workflow visibility, not automatic PO generation.
- Keep exports and structured outputs clean enough for future email/reporting automation.
