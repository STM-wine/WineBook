# Vinosmith Distributor API Discovery

## Corrected API scope

Cody at Vinosmith clarified that Stem is a **Distributor** on the Vinosmith
Distributor platform. All Stem API calls must use:

`https://vinosmith.com/api/distributor/`

The earlier broad API probing used the wrong API surface. Winery endpoints do not
apply to Stem, and the Vinosmith RADs endpoint represents a Supplier entity that is
not exposed to Distributor accounts. This spike therefore does not call winery or
RADs endpoints.

The relevant read-only Distributor endpoints are:

| Purpose | Endpoint |
| --- | --- |
| Delivered sales/order history | `GET /api/distributor/supplier_orders` |
| Wines/items | `GET /api/distributor/wines` |
| Prices | `GET /api/distributor/prices` |
| Inventory quantities | `GET /api/distributor/inventory` |

Authentication is `Authorization: Bearer <token>`. The token must be loaded only
from the ignored repository-root `.env.local`.

## Safety

- GET requests only.
- No production behavior changes.
- No token output, logging, hardcoding, or committed secrets.
- Raw successful responses are stored only in ignored `tmp/vinosmith/`.
- The existing emailed RB6/RADs workflow remains the production source and fallback.

## Discovery command

Use a recent one-month delivery window:

```bash
python scripts/explore_vinosmith_api.py \
  --delivery-start-date 2026-05-01 \
  --delivery-end-date 2026-05-31
```

The harness calls only the four documented Distributor endpoints. It refuses
`supplier_orders` windows longer than 31 days.

## Existing ingest requirements

### Sales history currently supplied by RADs email

The current pipeline requires product/wine name, bottle quantity, and transaction
date. Product code, account, and case quantity are optional. Sales are normalized
across vintages and aggregated into trailing 30/60/90-day, prior-30-day, and
prior-year windows.

### Inventory currently supplied by RB6 email

The current pipeline requires product/wine name, supplier/importer, and available
inventory. It also uses item code, vintage, pack size, unconfirmed quantity, on
order, FOB/cost, Core/BTG flags, Brand Manager/TDM, and category metadata when
available.

## Authentication and endpoint results

Tested June 9, 2026 using Bearer authentication from ignored repository-root
`.env.local`. Authentication succeeded.

| Endpoint | Result | Live Stem records |
| --- | --- | ---: |
| `GET /api/distributor/supplier_orders` | `200 OK` | 2,823 supplier orders / 9,093 lines |
| `GET /api/distributor/wines` | `200 OK` | 1,791 wines |
| `GET /api/distributor/prices` | `200 OK` | 16,957 prices |
| `GET /api/distributor/inventory` | `200 OK` | 1,789 warehouse inventory rows |

All successful raw JSON is stored under ignored `tmp/vinosmith/`.

### Supplier-order date-filter finding

The request specified May 1-31, 2026, but the response metadata reported April
1-May 31 and returned both months. A second request for May 15-20 returned metadata
for March 21-May 20. The endpoint is currently ignoring
`delivery_start_date` and applying its documented maximum/default 60-day lookback
from `delivery_end_date`.

Any integration must therefore filter `supplier_order.delivery_at` locally to the
requested monthly window and should ask Vinosmith to confirm/fix the start-date
behavior. Historical checkpoints must be based on the locally accepted date range,
not the server's returned collection alone.

## Returned structures

The live responses use these structures:

- `supplier_orders`: `data.supplier_orders[]` containing `account`, `user`,
  `order`, `supplier_order`, and `line_items[]`.
- `wines`: `data.wines[]` containing identity, supplier, vintage, packaging,
  classification, cost, status, producer, and product metadata.
- `prices`: `data.prices[]` containing a `price` and its related `wine`.
- `inventory`: `data.inventory[]` containing `wine`, warehouse-level `inventory`,
  and `warehouse`.

Official markdown docs also expose these query parameters:

- `GET /api/distributor/wines`: `created_since`, `updated_since`, and `include`.
  `include` is documented as a comma-delimited expansion list; the currently
  documented value is `producer:logo`, which adds `logo_url` to the producer
  substructure.
- `GET /api/distributor/supplier_orders`: `delivery_start_date`,
  `delivery_end_date`, and optional `account_id`.
- `GET /api/distributor/prices`: no documented query parameters.
- `GET /api/distributor/inventory`: no documented query parameters.
- `GET /api/distributor/accounts`: `created_since`, `updated_since`, and
  `include_disabled`.
- `GET /api/distributor/users`: no documented query parameters.
- `GET /api/distributor/wine_prearrivals`: no documented query parameters.
- `GET /api/distributor/wines/{wine_id}`: single-wine detail, with the same
  `include` expansion style as the full wines endpoint.
- `GET /api/distributor/wines/{wine_id}/prices` and
  `GET /api/distributor/wines/{wine_id}/inventory`: targeted per-wine enrichment
  endpoints. These should be used later for selected wine IDs rather than as the
  first broad rescue pass.

The rescue runner supports safe parameter probing with `--query-param`. Use
`--no-normalized-writes` for experiments so new parameter combinations save raw
JSON and response metadata without mutating cache tables:

```bash
python scripts/sync_vinosmith_rescue.py \
  --resource wines \
  --query-param wines.include=producer:logo \
  --no-normalized-writes \
  --require-supabase
```

The first expanded raw rescue pass should capture accounts, users, and
pre-arrivals as source metadata:

```bash
python scripts/sync_vinosmith_rescue.py \
  --resource accounts \
  --query-param accounts.include_disabled=true \
  --resource users \
  --resource wine_prearrivals \
  --no-normalized-writes \
  --require-supabase
```

After applying `supabase/migrations/20260615191800_vinosmith_accounts_users.sql`,
omit `--no-normalized-writes` to populate the private normalized account and user
cache tables:

```bash
python scripts/sync_vinosmith_rescue.py \
  --resource accounts \
  --query-param accounts.include_disabled=true \
  --resource users \
  --require-supabase
```

For supplier-order rescue, the runner can now split a larger historical range
into calendar-month API requests while keeping one source sync run, one
checkpoint per requested month, and one raw JSON file per requested month:

```bash
python scripts/sync_vinosmith_rescue.py \
  --resource supplier_orders \
  --backfill-start-date 2023-01-01 \
  --backfill-end-date 2026-05-31 \
  --sync-type historical_backfill \
  --require-supabase
```

If a supplier-order month is slow or Render Shell appears unstable, add
`--backfill-window-days 7` to split the same historical range into weekly
requests without changing the local filtering or upsert behavior.

Important live-account differences from the examples:

- Entity and line IDs are strings.
- Line `quantity`, `discount`, and `commission_rate` are numeric values.
- The line key is `id`, not the documented `line_item_id`.
- Live order lines do not contain `price_id` or a line-level inventory object.
- Live line wines additionally include importer, producer, and product family.
- Inventory includes a direct `available` field and `end_of_stock`.
- Prices include active/disabled/effective-date, premise, marketplace, minimum and
  maximum quantity, reference discount, and external identifier fields.

Saved samples:

- `tmp/vinosmith/supplier-orders-sample.json`
- `tmp/vinosmith/wines-sample.json`
- `tmp/vinosmith/prices-sample.json`
- `tmp/vinosmith/inventory-sample.json`

## Sales mapping

| Current sales/RADs-needed field | `supplier_orders` API field | Match status | Notes |
| --- | --- | --- | --- |
| Wine/item | `line_items[].wine.id`, `.name`, `.code` | Live match | Present on all 9,093 lines. Stable IDs/codes are stronger than normalized-name joins. |
| Vintage | `line_items[].wine.vintage` | Live partial match | Present on 8,215 lines; null for 878 non-vintage or missing-vintage lines. |
| Pack size | `line_items[].wine.unit_set` | Live match | Present on every line; values include 1, 3, 6, 12, 20, and 24. |
| Account/customer | `account.id`, `account.name` | Live match | Present on every order. |
| Rep/user | `user.id`, `.email`, `.full_name` | Live match | Present on every order. |
| Invoice/order/delivery date | `supplier_order.invoice_number`, `order.id`, `supplier_order.delivery_at` | Live match | Order, confirmed, paid, due, and delivery dates are available. Use delivery date and filter locally. |
| Quantity sold | `line_items[].quantity * wine.unit_set` | Reconstructable with validation | Quantity is an integer-valued float and behaves like case quantity because line total usually equals quantity times case price. Convert to bottles using `unit_set`; validate exceptions and non-case products. |
| Sales dollars | `line_items[].total_cents`; order-level `supplier_order.total_cents` | Live match | Line totals exist on every line. 988 positive-quantity lines have zero totals and require sample/free-goods review. |
| FOB | Join line wine ID to `wines[].fob_price` | Reconstructable | Current FOB exists for 1,788/1,791 wines; historical-at-sale FOB is not provided. |
| Laid-in cost | Not returned | Missing | Continue using Stem logistics/freight inputs unless Vinosmith identifies another endpoint. |
| Bill-back | `prices[].price.bill_back_price_cents`; price effective fields | Partial | 963 price records have bill-back values, but live order lines omit `price_id`, preventing an exact price-record join. |
| Supplier/importer | `line_items[].wine.importer.name`; wine join to `supplier_id` | Live match | Importer is present on every line; catalog provides numeric supplier ID. |

Additional live fields include line price, discount, manual-price flag, commission,
notes, order addresses, PO number, warehouse, payment status, balance due, and
delivery status. There is no explicit sample flag. The May response contains 23
`pending` orders and 2,800 `sent-to-warehouse` orders; normalized sales should
initially include only the confirmed delivered status agreed with Vinosmith.

**RADs replacement conclusion:** `supplier_orders` is sufficient to reconstruct the
sales inputs needed by the ordering calculator, but it is not a drop-in RADs file.
Normalization must locally enforce the requested date window, choose eligible
delivery statuses, convert case quantities to bottles, and define treatment of
zero-dollar/free lines, discounts, returns, and non-case products. Run API/email
parity before replacement.

## Inventory mapping

| Current inventory/RB6-needed field | Inventory/wines/prices API field | Match status | Notes |
| --- | --- | --- | --- |
| Item code / SKU | `inventory[].wine.code`; `wines[].code` | Live match | Wine IDs and codes are present throughout. Inventory's external `product_code` is blank/null in this account. |
| Wine name | `inventory[].wine.name`; `wines[].name` | Live match | Present on every catalog and inventory row. |
| Vintage | `inventory[].wine.vintage`; `wines[].vintage` | Live partial match | Present for 1,657/1,791 catalog wines. |
| Pack size | `wines[].unit_set` | Live match | Present on all wines. |
| Bottle size | `wines[].bottle_size`, `.bottle_size_label` | Live near-complete match | Twelve wines have blank bottle size. |
| Supplier/importer | `wines[].supplier_id`, `.importer`, `.producer` | Live near-complete match | Importer present for 1,790 wines; 87 distinct importers. Preserve producer separately. |
| Inventory on hand | `inventory[].inventory.on_hand` | Live match | Decimal string, one STEM warehouse row per inventory wine. |
| Available inventory | `inventory[].inventory.available` | Live match, parity required | Direct value exists. It often equals on-hand minus hold and sometimes also pending sync, but not universally; use the API value rather than re-derive it. |
| Unconfirmed line item quantity | `on_hold`, `on_pending_sync` candidates | Uncertain | Available already incorporates these inconsistently. Compare same-day RB6 before mapping either field to RB6 unconfirmed quantity. |
| On order quantity | `inventory[].inventory.on_order` | Live match | Nonzero for 79 wines; `on_future` and `on_pending_sync` are separately exposed. |
| Cost / price | `wines[].fob_price`; `prices[].price.price_cents` | Live match with distinctions | FOB is nonzero for 1,788 wines. Price endpoint contains active selling tiers and bill-backs, not laid-in cost. |
| Active/orderable/Core flags | `wines[].active`, `.orderable`, `.core`, `.admin_only`, `.inventory_item` | Live match | 209 wines are Core; no explicit BTG field exists. |

Other useful wine fields include `external_identifier_1`, category, UPC, country,
region, appellation, pre-arrival date/quantity, organic/sustainable flags, producer,
and timestamps. `external_identifier_1` is a strong candidate for the current RB6
`Wine: External ID (1)` / Brand Manager field and is populated on 1,765 wines.

Join coverage is strong: 1,789 of 1,791 catalog wines have inventory and prices.
Of 1,026 unique wines sold in the returned orders, 1,010 are in the current wine
and inventory collections and all 1,026 have price records. The 16 historical
order wines absent from the current catalog/inventory must remain resolvable from
the order-line snapshots.

**RB6 replacement conclusion:** wines + inventory + prices can reconstruct most
RB6 inputs, but not yet with proven parity. The API directly covers identity,
supplier, vintage, pack/bottle size, available/on-hand/on-order inventory, FOB,
Core, active/orderable, external ID, and category. BTG, laid-in cost, and exact
unconfirmed-quantity semantics are missing or uncertain.

## Recommended sync architecture

Vinosmith should feed a local database/cache. The application and ordering
calculator should read normalized local data, not fetch all Vinosmith history on
each app load. The existing emailed-report workflow remains the fallback until API
parity is proven.

### Historical backfill

1. Backfill `supplier_orders` from January 1, 2023 through the most recent completed
   month, then fetch the current partial month through today.
2. Use `--backfill-start-date` and `--backfill-end-date` so the rescue worker
   requests one calendar month at a time and records a checkpoint for each
   requested month.
3. Always filter returned rows locally using `supplier_order.delivery_at`. The live
   May 1-31 request returned April 1-May 31, and a May 15-20 request returned March
   21-May 20. The API date range may therefore be broader than requested.
4. Upsert headers and lines by stable Vinosmith identifiers. Overlapping responses
   must not create duplicates.
5. Mark a historical month complete only after local filtering, normalization,
   upsert, count diagnostics, and raw-response retention succeed.
6. Do not repeatedly retrieve completed historical months after the initial
   backfill unless a targeted repair or parity investigation requires it.

### Daily refresh

Run one daily sync after backfill. Request a rolling 14-day window ending today,
but expect the current API behavior to return approximately 60 days ending on the
requested end date. Until Cody clarifies or fixes the filter behavior, safely
upsert all returned rows from that recent 60-day response and separately record
the requested and returned ranges.

This is still a bounded recent refresh, not a full-history read. The overlap is
useful because orders can be edited after first delivery: statuses, credits,
returns, quantities, delivery dates, and payment fields may change. Upsert existing
records and replace/update their mutable fields rather than appending blindly.
Blind append would duplicate every overlapping order and preserve stale versions.

Wines should use `updated_since` incremental pulls after an initial full fetch when
that filter is verified. Prices currently expose no documented incremental filter,
so refresh the active price collection on a controlled schedule. Inventory is a
point-in-time quantity feed and should be snapshotted daily.

### Proposed local normalized data model

1. `raw_vinosmith_api_responses`
   - Endpoint, requested parameters, returned metadata/range, fetched timestamp,
     HTTP status, checksum, schema version, and local/object-storage path.
   - Immutable audit records; raw JSON does not drive application queries directly.
2. `vinosmith_order_headers`
   - Supplier-order ID, parent order ID, invoice/PO numbers, account ID, user/rep
     ID, order/confirmed/delivery/due/paid dates, delivery/payment status,
     warehouse, totals, balance, addresses, first-seen, and last-seen timestamps.
3. `vinosmith_order_lines`
   - Line ID, supplier-order ID, wine ID/code snapshot, importer/producer snapshot,
     quantity, unit set, normalized bottle quantity, price/total cents, discount,
     manual-price flag, commission, notes, first-seen, and last-seen timestamps.
4. `vinosmith_wines`
   - Wine ID, code, name, vintage, supplier ID/importer, producer, unit set, bottle
     size, FOB, external identifier, category, Core/active/orderable/admin/inventory
     flags, created/updated timestamps, and last synced timestamp.
5. `vinosmith_prices`
   - Price ID, wine ID, label/type, price cents, bill-back amount/date, effective
     dates, account applicability, premise, quantity thresholds, active/default
     flags, and last synced timestamp.
6. `vinosmith_inventory_snapshots`
   - Snapshot timestamp/date, wine ID, warehouse ID, available, on-hand, on-hold,
     on-order, on-future, pending-sync, end-of-stock, bin/UOM metadata, and raw
     response ID.

Normalized records should retain source-response IDs or fetch timestamps so any
parity mismatch can be traced back to exact raw input.

### Stable keys and joins

The live Stem sample contained:

- 2,823 unique `supplier_order.id` values: primary key for order headers.
- 2,823 unique `order.id` values: retain as the parent/general order identifier.
- 9,093 unique `line_items[].id` values: primary key for normalized order lines.
- `wine.id` on every order line: primary join to wines, prices, and inventory.
- `wine.code` on every line: useful external/business key and fallback join.
- `account.id` and `user.id` on every order header: joins to customer and rep
  dimensions if those resources are added later.
- `price.id` on price records: primary key for prices. Live order lines did not
  expose `price_id`, so price attribution must use wine, label, amount, account
  applicability, and effective dates unless Vinosmith adds that link.
- Inventory grain is `wine.id + warehouse.id + snapshot timestamp/date`.

Although line IDs were present and unique in this sample, confirm with Cody that
they are stable across repeated pulls and edits. If a future response omits a line
ID, use a deterministic fallback hash of supplier-order ID, wine ID/code, line
position when available, quantity, price, and line total. That fallback is weaker:
duplicate identical lines and mutable quantities/prices can make it ambiguous, so
it should trigger a diagnostic rather than silently merging uncertain records.

Historical order wines absent from the current wine collection must remain
queryable from the wine snapshot embedded on each order line. Current wine ID is
the preferred join to catalog, prices, and inventory; wine code is the fallback.

### Remaining questions for Cody

1. Why did `supplier_orders` ignore the requested May 1 start date and return April
   1-May 31?
2. What is the intended date-filter behavior, including default and maximum range?
3. Which date field does `delivery_start_date` actually filter?
4. Are `line_items[].id` values guaranteed stable across repeated pulls, edits,
   credits, and returns?
5. How should zero-dollar/free/sample lines, credits, returns, cancellations, and
   pending statuses be interpreted for depletion/sales reporting?
6. What exactly do inventory `available`, `on_hand`, `on_hold`, `on_order`,
   `on_future`, and `on_pending_sync` mean, and which correspond to RB6 available
   and unconfirmed quantities?
7. Is laid-in cost available through another Distributor endpoint?
8. Is historical-at-sale FOB available, or is `wines[].fob_price` only the current
   value?

### Final readiness note

This branch is a successful discovery spike: Distributor authentication works, all
four confirmed endpoints return Stem data, and the likely normalization path is
documented. Do not write these API records to Supabase yet.

The next build should be a local-only normalizer plus parity report against matching
emailed RB6/RADs files. It should prove delivery-window, status, quantity,
free-goods, inventory, FOB, and SKU parity before any production sync or email
workflow replacement.

## Source-of-truth strategy

Vinosmith is currently the best available operating source for item/wine master
data, inventory quantities, prices, and supplier-order/sales history. This does not
mean Vinosmith should become Stem's permanent or exclusive source of truth.

Stem's application should likely own ordering logic, manual overrides, logic
settings, BTG flags when they are not cleanly available from Vinosmith, and future
learned recommendations or ML feedback loops.

QuickBooks should be evaluated next as a possible source for financial truth,
invoices, COGS, payments, and independent sales-history validation. The long-term
source-of-truth decision should compare Vinosmith, QuickBooks, and the current
emailed reports for completeness, semantics, historical accuracy, and operational
reliability.

BTG is not currently confirmed as a first-class Vinosmith API field.
`/api/distributor/wines` includes `external_identifier_1`, which could serve as a
temporary Vinosmith-side flag if needed. The preferred long-term path may be to
store BTG as a Stem-owned field in the ordering app or logic-settings layer.

`/api/distributor/wines` also includes `core` and `fob_price`. These fields are
available from Vinosmith, but parity work must still confirm that they match Stem's
exact business meaning.

The integration should avoid hardwiring the app to Vinosmith report formats. The
better path is to normalize source data into Stem-owned tables and let the ordering
logic read from those normalized tables.

## Viability conclusion and smallest safe build

Authentication and endpoint access are fully viable. Data replacement is
**partially viable and requires normalization/reconstruction**:

- `supplier_orders` can replace the calculator's RADs inputs after explicit
  transformations and parity testing.
- wines + inventory + prices can replace most RB6 inputs, with a small set of
  missing/uncertain business fields.

The smallest safe next build is the local, non-production normalization command
described above. It should:

1. read the four ignored sample files;
2. write normalized local dev files for wines, prices, inventory snapshots, and
   delivered order lines;
3. locally filter May 1-31 and exclude pending orders;
4. convert order quantity to bottles using `unit_set`;
5. emit parity diagnostics against same-window RB6/RADs email files without
   writing to Supabase or changing the scheduled worker.

Resolve quantity/free-goods/status/date-filter semantics with Cody from the parity
results before building a production sync.

## Official documentation

- [Supplier orders](https://vinosmith.readme.io/reference/fetch-3)
- [Wines](https://vinosmith.readme.io/reference/fetch)
- [Prices](https://vinosmith.readme.io/reference/fetch-all-prices)
- [Inventory](https://vinosmith.readme.io/reference/fetch-all)
