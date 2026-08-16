# QuickBooks Gross Profit Truth Plan

Date: 2026-08-16

## Goal

Build trustworthy gross profit and gross margin analytics from QuickBooks Desktop, with drilldown from company totals to reps, accounts, invoices, items, producers, suppliers/importers, and individual sale lines.

This is separate from the item-master project. Item data is required for identity and enrichment, but current item cost alone is not enough to prove historical gross profit.

## Current State

The app currently pulls and persists the sales spine:

- `quickbooks_invoices`
- `quickbooks_invoice_lines`
- `quickbooks_credit_memos`
- `quickbooks_credit_memo_lines`
- `quickbooks_customers`
- `quickbooks_sales_reps`
- `quickbooks_items`

Invoice and credit memo lines currently store:

- `item_list_id`
- `item_full_name`
- `description`
- `quantity`
- `unit_of_measure`
- `rate`
- `amount`
- `class_ref`
- `raw_data`

QuickBooks items currently store:

- `purchase_cost`
- `average_cost`
- `sales_price`
- inventory quantities
- accounting refs, including COGS account ref

This supports sales, net sales, quantity, item/account/rep drilldowns, and trend. It does not yet support audited historical gross profit per sale line.

## Key Finding

Current `quickbooks_items.purchase_cost` and `quickbooks_items.average_cost` are current item-master values. They can help estimate margin and flag anomalies, but they are not reliable historical cost-of-goods-sold for a 2024 or 2025 invoice line.

For true gross profit, QuickBooks report outputs or accounting transaction detail must provide the COGS/gross-margin basis.

## Hybrid Margin Bridge While Vinosmith Remains In Use

There may be a faster operational path before full QuickBooks report/ledger margin truth is complete.

Proposed source of truth:

- FOB per item: QuickBooks, if the field is confirmed and persisted.
- Laid-in cost per item, including trucking and tax: QuickBooks, if the field is confirmed and persisted.
- Price sold: QuickBooks invoice and credit memo lines.
- Bill-back/depletion amount on the price or transaction: Vinosmith report/API, not currently imported in the daily report pipeline.

Known Vinosmith price endpoint shape:

- `price.id`
- `price.label`, for example `Frontline`
- `price.default`
- `price.price_cents`
- `price.bill_back_price_cents`
- `price.bill_back_date`
- `wine.id`
- `wine.name`
- `wine.code`

This means the bridge can match Vinosmith price levels to an item by Vinosmith wine ID/code and/or QuickBooks item code mapping, then use only the Vinosmith billback/depletion amount from that price level. FOB and laid-in cost should still come from QuickBooks once confirmed.

### Confirmed Business Rules For The Bridge

Manual price overrides:

- If `manual_price = true`, do not apply Vinosmith billback.
- Manual prices were admin-entered and approved.
- Margin lines should be flagged as manual price and excluded from billback-assisted GP.

Price level changes:

- Vinosmith can keep a price level and adjust billback on that same level over time.
- The key risk is historical drift: if a sale from 2024 joins to a price level whose billback was edited later, today's price record may not equal the billback in effect when the sale happened.
- Sold lines include `price_cents`, which protects sold revenue because the sale line stores the actual price used.
- Sold lines do not appear to include billback amount directly, so billback history depends on whether Vinosmith preserves price-change timestamps/history.
- If the price level still exists and its billback-adjusted margin drops below threshold, Stem should surface a live margin alert.

Billback units:

- `bill_back_price_cents` is per bottle.
- Billback amount for a normal sale line should be `quantity_bottles * bill_back_price_cents`.

Account-specific prices:

- Accounts have price levels attached.
- Billback lives on the price level, not directly on the account.
- Matching should still preserve account context for audit and drilldown, but billback comes from the matched price level.

Credits and returns:

- Credits/returns must reverse revenue and billback.
- A returned line should reduce net sales, effective cost, billback recovery, and gross profit consistently.

QuickBooks cost basis:

- FOB comes from QuickBooks.
- Laid-in cost, including trucking and tax, comes from QuickBooks.
- FOB and laid-in are per bottle and are set together.

QuickBooks/Vinosmith matching:

- QuickBooks invoice lines should match Vinosmith supplier order lines by invoice number, item number/code, quantity, price, delivery date, and account.
- Item numbers are expected to be the same between QuickBooks and Vinosmith.
- Exact joins should receive high confidence; mismatches should be flagged, not silently accepted.

Samples/free goods:

- Lines with a 100% discount should go into a Samples bucket.
- Samples should not be treated as poor-margin normal sales.

Billback GP basis:

- Initial GP should be live economic GP assuming billbacks are earned.
- Collected/booked billback GP can become a later finance view, but it is not the first operating dashboard target.

Confidence:

- Every margin line should carry a confidence/source label.
- The UI can ship useful margin analytics early as long as estimated, manual, sample, and exact-match lines are labeled clearly.

Proposed line formula:

```text
gross_sales = QuickBooks invoice line amount
gross_cost_before_billback = quantity * (qb_fob_per_bottle + qb_laid_in_per_bottle)
billback_recovery = matched_vinosmith_billback_amount
effective_cost = gross_cost_before_billback - billback_recovery
gross_profit = gross_sales - effective_cost
gross_margin_pct = gross_profit / gross_sales
```

For credit memo lines, invert the signs consistently so returns reduce net sales, cost, billback, and gross profit.

This path is likely easier than reconstructing COGS from ledger detail, but only if the join quality is strong enough.

### Required Bridge Checks

1. Confirm where QuickBooks stores FOB.
   - If it is `quickbooks_items.purchase_cost`, document that business meaning.
   - If it is a custom item field, update item parsing because current persistence stores `custom_fields: {}`.
   - If FOB is transaction-specific, item master alone is not enough.

2. Confirm where QuickBooks stores laid-in cost.
   - Current QuickBooks item schema does not have a dedicated `laid_in_cost`, trucking, freight, or tax field.
   - If this exists in QuickBooks custom fields, parse and persist it explicitly.
   - If it is embedded in item name, description, class, or account mapping, do not rely on it without validation.

3. Import the Vinosmith bill-back report/source.
   - Current Vinosmith API discovery found `prices[].price.bill_back_price_cents`, but live order lines did not expose `price_id`, preventing an exact line-to-price join.
   - The current daily RB6/RADs ingest does not import billback/depletion amounts into `reorder_recommendations`.
   - The parser now accepts `bill_back_date` from the Vinosmith price endpoint and normalizes it into `vinosmith_prices.bill_back_at`.
   - If an emailed Vinosmith report includes billback by transaction/line/price, ingest that report as a first-class source.

4. Preserve confidence on every calculated margin line.
   - `qb_price_qb_cost_vinosmith_exact_billback`: exact transaction/line/price match.
   - `qb_price_qb_cost_vinosmith_effective_price_billback`: matched by item/date/price/effective period.
   - `qb_price_qb_cost_vinosmith_item_billback`: matched by item only.
   - `qb_price_qb_cost_manual_no_billback`: manual price override; no billback expected.
   - `sample_100_percent_discount`: sample/free-goods bucket; not normal GP.
   - `qb_price_qb_cost_no_billback`: billback unavailable.
   - `qb_price_current_item_cost_estimate`: fallback estimate only.

5. Reconcile against QuickBooks reports anyway.
   - The hybrid bridge can be the useful operating model, but it still needs comparison against Sales by Item Summary, P&L COGS, and any available QuickBooks margin reports.

### Hybrid Bridge Data Model

Add or extend a margin mart with explicit cost components:

- `sales_date`
- `txn_id`
- `txn_line_id`
- `transaction_type`
- `customer_list_id`
- `customer_full_name`
- `sales_rep`
- `item_list_id`
- `item_full_name`
- `quantity`
- `qb_unit_price`
- `qb_gross_sales`
- `qb_fob_per_bottle`
- `qb_laid_in_per_bottle`
- `qb_trucking_per_bottle`
- `qb_tax_per_bottle`
- `gross_cost_before_billback`
- `vinosmith_billback_source_id`
- `vinosmith_billback_per_bottle`
- `vinosmith_billback_amount`
- `effective_cost`
- `gross_profit`
- `gross_margin_pct`
- `margin_source`
- `margin_confidence`
- `diagnostics`

This model separates the economics:

- sales price from QuickBooks
- base cost from QuickBooks
- freight/tax/laid-in from QuickBooks
- supplier recovery/billback from Vinosmith

That separation is important because it lets leadership see normal GP, billback-assisted GP, and leakage when billbacks are missing or unmatched.

## Official QuickBooks SDK Signals

QuickBooks Desktop SDK report queries are the likely correct source for margin truth:

- Intuit's report list says `GeneralDetailReportQueryRq` supports reports including `SalesByItemDetail`, `SalesByRepDetail`, `SalesByCustomerDetail`, `ProfitAndLossDetail`, `InventoryValuationDetail`, and `TransactionDetailByAccount`.
- Intuit's report list says `GeneralSummaryReportQueryRq` supports `SalesByItemSummary`, `SalesByCustomerSummary`, `SalesByRepSummary`, and P&L reports.
- Intuit's report request reference says Sales by Item Summary has default subcolumns including quantity, amount, average price, average cost, COGS, gross margin, and gross margin percent.
- Intuit's General Detail report reference says detail reports can include columns such as `TxnID`, `Item`, `Quantity`, `Amount`, `AverageCost`, `CostPrice`, `SalesRep`, and related transaction/report columns, depending on report support.

References:

- https://developer.intuit.com/app/developer/qbdesktop/docs/additional-reference/reports-that-can-be-requested-with-the-sdk
- https://developer.intuit.com/app/developer/qbdesktop/docs/additional-reference/report-request-reference
- https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/generaldetailreportquery
- https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/generalsummaryreportquery

## Required Historical Pull

The sales history pull should include both 2025 and 2024:

- 2025 full calendar year for current YOY ordering and sales trend comparisons.
- 2024 full calendar year to establish a deeper trend baseline and validate seasonality.
- Current year to date for active dashboards.

Minimum transaction sources:

- Invoices with line items.
- Credit memos with line items.
- Customers.
- Sales reps.
- Items.

Additional margin-truth sources to add:

- Sales by Item Summary report by month/year.
- Sales by Item Detail report with transaction IDs if usable.
- Sales by Customer Summary or Detail.
- Sales by Rep Summary or Detail.
- Profit and Loss Standard / Detail by month.
- Transaction Detail by Account or General Ledger filtered to income and COGS accounts.
- Inventory Valuation Detail/Summary for cost sanity checks.

## Source Hierarchy For Gross Profit

Use a tiered truth model instead of one blended number.

### Tier 1: QuickBooks Reported Gross Profit

Preferred when available from QuickBooks reports.

Fields:

- sales amount
- quantity
- average cost
- COGS
- gross margin dollars
- gross margin percent

Use cases:

- official item margin
- company/item/account/rep margin dashboards
- reconciliation to QuickBooks UI reports

Risk:

- report rows may aggregate differently than transaction queries.
- detail report columns may vary by report type and QuickBooks edition.
- parsing report XML is more complex than transaction XML.

### Tier 2: Ledger/COGS Detail

Use when report summaries are insufficient for drilldown.

Fields:

- transaction ID
- date
- account
- split account
- item/customer/name
- debit/credit/amount
- transaction type

Use cases:

- reconcile sales revenue to COGS accounts.
- validate P&L.
- drill into unusual margin.

Risk:

- joining ledger COGS back to invoice lines may be imperfect.
- some COGS may be posted through adjustments, journals, or inventory transactions rather than direct invoice-line records.

### Tier 3: Reconstructed Cost Estimate

Use only as fallback or diagnostic.

Formula examples:

- invoice line revenue = line amount
- estimated cost = quantity * item average cost as of latest item pull
- estimated gross profit = revenue - estimated cost

Risk:

- current item cost may differ from cost at sale date.
- inventory costing method and timing can make historical estimates wrong.

This tier must be labeled clearly as estimated, not official GP.

## Data Model Needs

Add generic report persistence before building the GP dashboard:

- `quickbooks_report_snapshots`
- `quickbooks_report_rows`
- optionally normalized report-specific mart tables after the report XML shape is understood

Suggested report snapshot fields:

- `id`
- `source_system`
- `report_request_type`
- `report_type`
- `report_basis`
- `date_from`
- `date_to`
- `summarize_rows_by`
- `summarize_columns_by`
- `include_columns`
- `raw_response_id`
- `report_title`
- `report_subtitle`
- `num_rows`
- `num_columns`
- `raw_data`
- `created_at`

Suggested report row fields:

- `id`
- `report_snapshot_id`
- `row_sequence`
- `row_kind`
- `row_type`
- `row_value`
- `parent_row_sequence`
- `columns`
- `raw_data`

Then build a curated mart/view:

- `quickbooks_sales_margin_lines`

Candidate fields:

- `sales_date`
- `txn_date`
- `txn_id`
- `txn_line_id`
- `ref_number`
- `transaction_type`
- `customer_list_id`
- `customer_full_name`
- `sales_rep`
- `item_list_id`
- `item_full_name`
- `quantity`
- `gross_sales`
- `credit_amount`
- `net_sales`
- `reported_cogs`
- `reported_gross_profit`
- `reported_gross_margin_pct`
- `estimated_cogs`
- `estimated_gross_profit`
- `estimated_gross_margin_pct`
- `margin_source`
- `margin_confidence`
- `diagnostics`

## Dashboard Requirements

The gross profit dashboard must drill down in both directions:

- company -> rep -> account -> invoice -> line
- company -> supplier/importer -> producer -> item -> account/rep/invoice
- company -> item -> accounts buying -> reps selling -> transaction lines

Required metrics:

- gross sales
- credit memos
- net sales
- units/bottles/cases
- COGS
- gross profit dollars
- gross margin percent
- average selling price
- average cost
- credit rate
- margin trend by month
- YOY net sales and GP
- account/product/reps moving up or down

Required filters:

- date range
- year preset: current YTD, 2025, 2024
- rep
- account
- item
- producer
- supplier/importer
- transaction type
- margin confidence/source

## Validation And Reconciliation

Do not trust GP dashboards until they reconcile against QuickBooks UI reports.

Initial reconciliation reports:

- Sales by Item Summary for 2025 and 2024.
- Sales by Rep Summary for 2025 and 2024.
- Sales by Customer Summary for 2025 and 2024.
- Profit and Loss Standard by month for 2025 and 2024.
- Inventory Valuation Summary/Detail around selected periods.

Acceptance checks:

- Net sales from transaction tables matches QuickBooks sales reports within a documented tolerance.
- Credit memo totals match QuickBooks credit reporting.
- COGS from report mart matches P&L COGS totals.
- Gross profit by item sums to company gross profit for the same date/basis, or differences are explained.
- At least 10 high-value invoices can drill from dashboard line -> QuickBooks invoice/report evidence.
- Every margin number has a `margin_source`: `qb_reported`, `ledger_reconciled`, or `estimated_current_item_cost`.

## Implementation Phases

### Phase 1: Finish Sales History

- Pull 2025 invoices and credit memos.
- Pull 2024 invoices and credit memos.
- Keep line items enabled.
- Verify row counts and latest/earliest transaction dates.

### Phase 2: Report Query Discovery

- Add read-only allowlist support for `GeneralSummaryReportQueryRq` and `GeneralDetailReportQueryRq`.
- Build minimal qbXML builders for:
  - `SalesByItemSummary`
  - `SalesByCustomerSummary`
  - `SalesByRepSummary`
  - `ProfitAndLossStandard`
  - `SalesByItemDetail`
  - `TransactionDetailByAccount`
- Capture raw report responses first.
- Parse report column descriptors and rows generically.

### Phase 3: Persist Report Snapshots

- Add report snapshot/row tables.
- Persist raw report metadata and normalized rows.
- Keep report pulls in separate recovery queue resources so they cannot interrupt invoice/credit memo history pulls.

### Phase 4: Build Margin Mart

- Join invoices/credit memos to report-derived COGS/margin where possible.
- Preserve estimate-only fallback separately.
- Add confidence and diagnostics.

### Phase 5: Dashboard

- Extend Sales Dashboard into Sales + Margin.
- Add drilldowns to account, rep, item, producer, supplier/importer, invoice, and line level.
- Clearly label unavailable or estimated GP.

## Current Answer To "Are We Pulling Enough Item Data?"

For sales trend: yes, once 2025 and 2024 sales history are complete.

For ordering item identity: mostly yes, with known mapping risks.

For true gross profit per sale: no. Item data alone is not enough. We need QuickBooks-reported COGS/gross-margin data from report queries or ledger/COGS detail before treating GP as real.
