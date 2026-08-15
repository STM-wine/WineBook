# Stem Intelligence QuickBooks Historical Mirror Scope

## North Star

Build a read-only Stem Intelligence financial and operating data mirror that can query as much QuickBooks Desktop data as QuickBooks will allow, going back to the beginning of the Stem Wine Company file. The goal is not to recreate QuickBooks screens. The goal is to make QuickBooks data easier to inspect, reconcile, combine with Vinosmith/catalog data, and visualize in ways QuickBooks does not make easy.

QuickBooks is the first source of truth for financial transactions, balances, vendors, customers, items, realized invoice prices, sales totals, net sales, payments, purchase orders, bills, and accounting reports. Vinosmith follows QuickBooks as the enrichment source for supplier/importer/producer/wine-name/pack-size/FOB/catalog detail, current selling prices, price levels, and additional sales-rep/catalog context.

## Operating Assumptions

- Company file: Stem Wine Company.
- Backfill start: as far back as QuickBooks will allow, currently modeled from `2018-08-14`.
- Access model: QuickBooks Desktop Web Connector, read-only qbXML requests only.
- Normal Web Connector operation should not require Single-User Mode after initial authorization.
- Recovery must be restartable, queue-based, and safe to run in small chunks.
- Raw QuickBooks XML should be retained during recovery so responses can be re-parsed without asking QuickBooks again.
- Credit card fields and SSNs are out of scope. Normal customer/vendor operating fields are in scope.

## Current Implementation

The current Web Connector service already supports a restartable recovery queue using `source_sync_checkpoints`.

Currently queued/recovered:

- Sales reps: `SalesRepQueryRq`, used for rep-name resolution and raw response capture.
- Customers: `CustomerQueryRq` into `quickbooks_customers`.
- Vendors/suppliers: `VendorQueryRq` into `quickbooks_vendors`.
- Items: `ItemQueryRq` into `quickbooks_items`.
- Invoices: daily `InvoiceQueryRq` jobs into `quickbooks_invoices` and `quickbooks_invoice_lines`.
- Credit memos: daily `CreditMemoQueryRq` jobs into `quickbooks_credit_memos` and `quickbooks_credit_memo_lines`.
- Receive payments: monthly `ReceivePaymentQueryRq` jobs into `quickbooks_receive_payments`.
- Purchase orders: monthly `PurchaseOrderQueryRq` jobs into `quickbooks_purchase_orders` and `quickbooks_purchase_order_lines`.
- Deleted transactions: monthly `TxnDeletedQueryRq` jobs captured as raw responses pending a first-class ledger table.

## Source-Of-Truth Rules

### QuickBooks First

QuickBooks should be treated as the source of truth for:

- Customers and customer balances.
- Vendors/suppliers and vendor balances.
- Items and QuickBooks item identity.
- Sales reps where attached to QuickBooks transactions.
- Invoices, invoice lines, realized transaction prices, and delivery/ship dates.
- Credit memos and credit memo lines.
- Receive payments.
- Purchase orders and purchase order lines.
- Bills, vendor credits, bill payments, checks, deposits, journals, account balances, P&L, balance sheet, and cashflow once added.
- Total sales and net sales.

### Vinosmith Second

Vinosmith should enrich or reconcile:

- Supplier/importer naming when richer than QuickBooks vendor names.
- Producers.
- Wine names and catalog metadata.
- Pack size and bottle size.
- FOBs.
- Current item selling prices and price levels.
- Product/catalog identity where QuickBooks item names are insufficient.
- Sales-rep or account context when useful, but QuickBooks remains the financial truth.

### Canonical Sales Date

Sales reporting should use invoice `ShipDate` / delivery date when present. If missing, fall back to invoice transaction date.

## CFO Priority Stack

This build should prioritize operating questions in the order a CFO would need them answered. The technical recovery order can still be adjusted for safety, but product decisions should follow this priority stack.

### 1. Accurate Sales Data By Rep And Account

This is the highest-priority business problem because sales comp, sales coaching, account ownership, customer health, and trust in the system all depend on it.

Required data:

- Invoices and invoice lines.
- Credit memos and credit memo lines.
- Customers/accounts.
- Sales reps.
- Account-to-rep assignment history with effective dates.
- Delivery/ShipDate as the canonical sales date.
- Transaction date as fallback when delivery date is missing.

Important modeling requirement:

- If a rep took over an account mid-year, reporting must be able to answer both questions: who owns the account now, and who owned the account at the time of sale.
- This likely needs a `sales_rep_account_assignments` table or equivalent history table sourced from QuickBooks, Vinosmith, manual admin changes, or a controlled upload if neither system has reliable history.

Primary dashboards:

- Net sales by rep.
- Net sales by account.
- Credits by rep/account.
- Rep account-book history.
- Account transition impact.
- Vinosmith vs QuickBooks sales discrepancy proof.

### 2. Item And Product Information

QuickBooks should be the first source for item identity and anything it accurately stores. Vinosmith should enrich item records into wine-native product records.

Required data:

- QuickBooks items.
- Item active/inactive status.
- Item descriptions and accounting references.
- Vinosmith wine/catalog metadata.
- Supplier/importer/producer.
- Wine name, vintage, pack size, bottle size.
- FOB and catalog availability.
- Current item selling price and price levels from Vinosmith.

Important modeling requirement:

- Historical realized sale price comes from QuickBooks invoice lines.
- Current/list selling price and price levels come from Vinosmith.
- A crosswalk must connect QuickBooks items to Vinosmith wines/catalog records before product-level reporting is trusted.

Primary dashboards:

- Item master browser.
- Product mapping gaps.
- Sales by item/product/producer/importer.
- Active vs inactive item cleanup.
- Price-level visibility from Vinosmith.

### 3. Product Costs, Margin, Discounts, And Supplier Billbacks

Once sales and product identity are reliable, the next priority is profitability and leakage.

Required data:

- Item costs from QuickBooks where reliable.
- FOB and supplier cost detail from Vinosmith/catalog where richer.
- Purchase orders and purchase order lines.
- Bills and bill lines.
- Vendor credits.
- Invoice line realized sales prices.
- Credit memo line reductions.
- Discounts, samples, depletion allowances, and supplier billbacks.

Important modeling requirement:

- Gross profit should be explainable at item, invoice, customer, rep, supplier/importer, and producer levels.
- Supplier billbacks for samples, depletion allowances, or incentives need explicit tracking. If QuickBooks records them as vendor credits, bills, journal entries, or classes/accounts, those must be mapped into a normalized allowance/billback view.
- Discounts must be separated from credit memos and from free/sample goods so margin reports do not blur different business events.

Primary dashboards:

- Gross margin by rep/account/item/producer/importer.
- Discount leakage.
- Sample/depletion allowance tracker.
- Supplier billback receivable/collection status.
- Net profit margin after credits, discounts, and allowances where data supports it.

### 4. Expenses

Expenses come before broad financial dashboards because leadership needs to see where money is going before cashflow or P&L visualizations can be trusted.

Required data:

- Chart of accounts.
- Bills and bill lines.
- Checks and check lines.
- Credit card charges and credits.
- Journal entries.
- Classes.
- General ledger detail.
- Vendor/account mappings.

Primary dashboards:

- Expenses by account.
- Expenses by vendor.
- Expense trends by month/quarter/year.
- Unusual expense detection.
- COGS vs operating expense split.
- Supplier-specific expense and allowance views.

### 5. Finance Operating Stack

After sales, item truth, margin, and expenses are grounded, build the larger finance command center.

Required areas:

- Bills and payables.
- Receivables and customer balances.
- Purchasing and receiving.
- Inventory.
- Cashflow.
- P&L.
- Balance sheet.
- Debt/liabilities.
- Audit/deleted/voided transaction tracking.

Primary dashboards:

- Vendor payables: owed, current, overdue, due soon.
- Customer receivables: open, current, overdue.
- Ordered vs received vs billed vs paid.
- Inventory value and turns.
- Cash expected vs cash required.
- P&L by month/quarter/year.
- Balance sheet and debt/liability snapshots.

## Target Data Domains

### 1. Foundation Lists

Purpose: shared dimensions for every downstream dashboard.

Target tables:

- `quickbooks_accounts`
- `quickbooks_classes`
- `quickbooks_terms`
- `quickbooks_payment_methods`
- `quickbooks_sales_reps`
- `quickbooks_customers`
- `quickbooks_vendors`
- `quickbooks_items`

QuickBooks requests/reports:

- `AccountQueryRq`
- `ClassQueryRq`
- `TermsQueryRq`
- `PaymentMethodQueryRq`
- `SalesRepQueryRq`
- `CustomerQueryRq`
- `VendorQueryRq`
- `ItemQueryRq`

Dashboards enabled:

- Entity browser.
- Customer/vendor/item health checks.
- Mapping coverage between QuickBooks and Vinosmith.

### 2. Sales And Receivables

Purpose: accurate sales, credits, payments, open receivables, and customer aging.

Existing/target tables:

- `quickbooks_invoices`
- `quickbooks_invoice_lines`
- `quickbooks_credit_memos`
- `quickbooks_credit_memo_lines`
- `quickbooks_receive_payments`
- `quickbooks_deposits`
- `quickbooks_ar_aging_snapshots`
- `quickbooks_report_snapshots`
- `quickbooks_report_rows`

QuickBooks requests/reports:

- `InvoiceQueryRq`
- `CreditMemoQueryRq`
- `ReceivePaymentQueryRq`
- `DepositQueryRq`
- `AgingReportQueryRq`: AR Aging Summary / Detail
- `GeneralDetailReportQueryRq`: Open Invoices, Sales by Rep Detail, Sales by Customer Detail, Sales by Item Detail

Dashboards enabled:

- Sales by rep.
- Sales by account.
- Net sales after credit memos.
- Sales by item/product/producer/importer after Vinosmith mapping.
- Customer balance and collections view.
- Open invoices and overdue receivables.

### 3. Payables And Vendor Debt

Purpose: show exactly how much Stem owes each vendor/supplier, how much is current, and how much is overdue.

Target tables:

- `quickbooks_bills`
- `quickbooks_bill_lines`
- `quickbooks_vendor_credits`
- `quickbooks_vendor_credit_lines`
- `quickbooks_bill_payments`
- `quickbooks_checks`
- `quickbooks_check_lines`
- `quickbooks_ap_aging_snapshots`
- `quickbooks_vendor_balance_snapshots`

QuickBooks requests/reports:

- `BillQueryRq`
- `VendorCreditQueryRq`
- `BillPaymentCheckQueryRq`
- `BillPaymentCreditCardQueryRq`
- `CheckQueryRq`
- `AgingReportQueryRq`: AP Aging Summary / Detail
- `GeneralDetailReportQueryRq`: Unpaid Bills Detail, Vendor Balance Detail, Expense by Vendor Detail, Transaction List by Vendor

Dashboards enabled:

- Amount owed by vendor/supplier.
- Current vs overdue payables.
- Due-date calendar.
- Cash required for upcoming vendor payments.
- Vendor credits available.
- Bills not tied cleanly to purchase orders.
- Vendor debt trend over time.

### 4. Purchasing And Receiving

Purpose: show ordered, received, billed, and paid status by vendor/item.

Existing/target tables:

- `quickbooks_purchase_orders`
- `quickbooks_purchase_order_lines`
- `quickbooks_item_receipts`
- `quickbooks_item_receipt_lines`
- `quickbooks_bills`
- `quickbooks_bill_lines`

QuickBooks requests/reports:

- `PurchaseOrderQueryRq`
- `ItemReceiptQueryRq`
- `BillQueryRq`
- `GeneralDetailReportQueryRq`: Open POs, Purchase by Vendor Detail, Purchase by Item Detail

Dashboards enabled:

- Open POs by vendor.
- Ordered vs received vs billed vs paid.
- Vendor fill-rate and receipt timing.
- PO aging.
- Incoming inventory expectations.
- Buying workflow context inside Order Review.

### 5. Inventory And Product Economics

Purpose: value inventory, inspect movement, and connect stock to sales/purchasing.

Target tables:

- `quickbooks_inventory_snapshots`
- `quickbooks_inventory_adjustments`
- `quickbooks_inventory_adjustment_lines`
- `quickbooks_inventory_valuation_snapshots`
- `quickbooks_item_receipts`
- `quickbooks_item_receipt_lines`

QuickBooks requests/reports:

- `ItemQueryRq`
- `InventoryAdjustmentQueryRq`
- `ItemReceiptQueryRq`
- `GeneralDetailReportQueryRq`: Inventory Valuation Detail, Sales by Item Detail, Purchase by Item Detail

Dashboards enabled:

- Inventory value by item/supplier/producer/importer.
- Units on hand, on order, and committed.
- Inventory turns.
- Dead/slow stock.
- Margin and velocity once mapped to Vinosmith/catalog metadata.

### 6. Cash, Banking, And Liquidity

Purpose: show what cash is available, what cash is expected, and what cash is needed.

Target tables:

- `quickbooks_bank_accounts`
- `quickbooks_account_balance_snapshots`
- `quickbooks_deposits`
- `quickbooks_checks`
- `quickbooks_credit_card_charges`
- `quickbooks_credit_card_credits`
- `quickbooks_cashflow_snapshots`

QuickBooks requests/reports:

- `AccountQueryRq`
- `DepositQueryRq`
- `CheckQueryRq`
- `CreditCardChargeQueryRq`
- `CreditCardCreditQueryRq`
- `GeneralSummaryReportQueryRq`: cashflow-style reports where supported
- `GeneralDetailReportQueryRq`: Check Detail, Deposit Detail, Transaction Detail by Account

Dashboards enabled:

- Cash position.
- Expected incoming cash from receivables.
- Required outgoing cash from payables.
- Short-term liquidity forecast.
- Bank account movement.

### 7. P&L, Balance Sheet, And General Ledger

Purpose: support executive financial dashboards that can be sliced differently than QuickBooks.

Target tables:

- `quickbooks_general_ledger_entries`
- `quickbooks_journal_entries`
- `quickbooks_journal_entry_lines`
- `quickbooks_profit_and_loss_snapshots`
- `quickbooks_balance_sheet_snapshots`
- `quickbooks_report_snapshots`
- `quickbooks_report_rows`

QuickBooks requests/reports:

- `JournalEntryQueryRq`
- `GeneralDetailReportQueryRq`: General Ledger, Profit and Loss Detail, Transaction Detail by Account
- `GeneralSummaryReportQueryRq`: Profit and Loss Standard, Balance Sheet Standard, Statement of Cash Flows where supported

Dashboards enabled:

- P&L by month/quarter/year.
- Gross revenue, credits, net revenue, COGS, gross margin, operating expenses.
- Balance sheet snapshots.
- Debt/liability view.
- Account-level drilldowns.

### 8. Deletions, Voids, And Auditability

Purpose: keep historical analytics from drifting when QuickBooks records are deleted, voided, or changed.

Target tables:

- `quickbooks_txn_deleted`
- `quickbooks_audit_trail_snapshots`
- `source_api_responses`
- `source_sync_checkpoints`

QuickBooks requests/reports:

- `TxnDeletedQueryRq`
- `GeneralDetailReportQueryRq`: Audit Trail
- Per-transaction modified-date queries for incremental refreshes

Dashboards enabled:

- Deleted transaction ledger.
- Void/change detection.
- Recovery job health.
- Data freshness and reconciliation status.

### 9. Vinosmith And Catalog Enrichment

Purpose: make QuickBooks finance data wine-native.

Target tables:

- `vinosmith_wines`
- `vinosmith_supplier_orders`
- `vinosmith_supplier_order_lines`
- `supplier_catalog_wines`
- `supplier_catalog_price_levels`
- `quickbooks_vinosmith_item_links`
- `vendor_supplier_links`
- `producer_importer_links`
- `product_identity_resolution`

Vinosmith source areas:

- Wines/catalog.
- Supplier orders.
- Importer/supplier names.
- Producers.
- Pack size and bottle size.
- FOB.
- Current item selling prices and price levels.

Dashboards enabled:

- Sales by producer/importer/supplier.
- Margin by producer/importer/supplier.
- Price-level analysis.
- Item mapping gaps.
- Catalog identity resolution.

## Recommended Build Phases

### Phase 1: Sales Truth Pack

- Keep QBWC read-only and queue-based.
- Finish invoice, credit memo, customer/account, sales rep, and receive payment recovery.
- Add or design account-to-rep assignment history with effective dates.
- Keep manual Web Connector testing until queue stability is proven.
- Build the primary sales dashboard around net sales by rep and account using delivery/ShipDate.
- Compare against QuickBooks Sales by Rep, Sales by Customer, Sales by Item, and Open Invoices.

### Phase 2: Item And Product Truth Pack

- Finish QuickBooks item recovery and item-line persistence.
- Connect QuickBooks items to Vinosmith wines/catalog records.
- Treat QuickBooks invoice-line prices as realized historical sale prices.
- Treat Vinosmith as the source for current/list selling prices and price levels.
- Build item/product mapping dashboards before margin reporting depends on them.

### Phase 3: Cost, Margin, Discounts, And Billback Pack

- Add bills, bill lines, vendor credits, purchase orders, item receipts, and any reliable item-cost fields.
- Model discounts, samples, depletion allowances, supplier billbacks, and vendor credits separately.
- Build gross margin and leakage dashboards by rep, account, item, producer, importer, and supplier.
- Compare against QuickBooks Purchase by Item, Purchase by Vendor, sales reports, and relevant account detail.

### Phase 4: Expense Pack

- Add accounts, classes, checks, credit card charges/credits, journal entries, and general ledger detail.
- Build expense dashboards by account, vendor, class, and period.
- Separate COGS, operating expenses, supplier allowances, and unusual/non-recurring expenses.

### Phase 5: Finance Operating Stack

- Add AP aging, AR aging, vendor balances, customer balances, deposits, inventory valuation, cash/bank snapshots, P&L, balance sheet, and cashflow report snapshots.
- Build vendor payables, customer receivables, purchasing/receiving, inventory, cashflow, P&L, balance sheet, and debt/liability dashboards.
- Compare every dashboard against the matching QuickBooks report before treating it as operational truth.

### Phase 6: Automation And Executive Layer

- Add queue status and record-count visibility in the app.
- Add reconciliation health checks.
- Add executive summaries and exception alerts.
- Decide whether Web Connector Auto-Run can safely replace manual runs.

## Reconciliation Reports

Use QuickBooks reports as the official accuracy checks.

Sales:

- Sales by Rep Detail / Summary.
- Sales by Customer Detail.
- Sales by Item Detail.
- Open Invoices.

Payables:

- AP Aging Summary.
- AP Aging Detail.
- Unpaid Bills Detail.
- Vendor Balance Detail.
- Transaction List by Vendor.

Purchasing:

- Open POs.
- Purchase by Vendor Detail.
- Purchase by Item Detail.

Inventory:

- Inventory Valuation Detail.
- Inventory Stock Status reports if available through SDK/report query.

Financials:

- Profit and Loss Standard / Detail.
- Balance Sheet Standard / Detail.
- General Ledger.
- Transaction Detail by Account.
- Statement of Cash Flows where available.

## Guardrails

- No QuickBooks write-back unless explicitly designed and approved later.
- Server-side qbXML allowlist must continue blocking add/modify/delete requests.
- Keep Web Connector Auto-Run off until manual queue runs are stable.
- Avoid credit card and SSN fields.
- Prefer raw capture plus parsed tables for every new source area.
- Every new recovery domain should have a QuickBooks report used as a reconciliation check.

## Open Decisions

- Exact historical start date if QuickBooks exposes data earlier than `2018-08-14`.
- Whether to create monthly, weekly, or daily queue windows for each high-volume transaction type.
- How long the remote desktop can safely keep QuickBooks and Web Connector open.
- Which dashboard should be first after the Payables Pack: vendor debt, cashflow, or executive P&L.
- How long raw XML should be retained after the historical recovery completes.

## Official QuickBooks SDK References

- Reports available through the QuickBooks Desktop SDK: https://developer.intuit.com/app/developer/qbdesktop/docs/additional-reference/reports-that-can-be-requested-with-the-sdk
- GeneralDetailReportQuery: https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/generaldetailreportquery
- BillQuery: https://developer.intuit.com/app/developer/qbdesktop/docs/api-reference/qbdesktop/billquery
- Objects and operations accessible through the SDK: https://developer.intuit.com/app/developer/qbdesktop/docs/additional-reference/quickbooks-objects-and-operations-accessible-with-the-sdk
