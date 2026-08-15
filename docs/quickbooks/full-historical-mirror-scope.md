# Stem Intelligence QuickBooks Historical Mirror Scope

## North Star

Build a read-only Stem Intelligence financial and operating data mirror that can query as much QuickBooks Desktop data as QuickBooks will allow, going back to the beginning of the Stem Wine Company file. The goal is not to recreate QuickBooks screens. The goal is to make QuickBooks data easier to inspect, reconcile, combine with Vinosmith/catalog data, and visualize in ways QuickBooks does not make easy.

QuickBooks is the first source of truth for financial transactions, balances, vendors, customers, items, sales prices, sales totals, net sales, payments, purchase orders, bills, and accounting reports. Vinosmith follows QuickBooks as the enrichment source for supplier/importer/producer/wine-name/pack-size/FOB/catalog detail, price levels, and additional sales-rep/catalog context.

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
- Invoices, invoice lines, sales prices, and delivery/ship dates.
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
- Price levels.
- Product/catalog identity where QuickBooks item names are insufficient.
- Sales-rep or account context when useful, but QuickBooks remains the financial truth.

### Canonical Sales Date

Sales reporting should use invoice `ShipDate` / delivery date when present. If missing, fall back to invoice transaction date.

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
- Price levels.

Dashboards enabled:

- Sales by producer/importer/supplier.
- Margin by producer/importer/supplier.
- Price-level analysis.
- Item mapping gaps.
- Catalog identity resolution.

## Recommended Build Phases

### Phase 1: Recovery Backbone

- Keep QBWC read-only and queue-based.
- Finish customer/vendor/item/sales/invoice/credit/payment/PO recovery.
- Keep manual Web Connector testing until queue stability is proven.
- Add queue status and record-count visibility in the app.

### Phase 2: Payables Pack

- Add bills, bill lines, vendor credits, bill payments/checks, AP aging snapshots, and vendor balance snapshots.
- Build the first vendor payable dashboard: owed, current, overdue, due soon, credits available.
- Compare against QuickBooks AP Aging Summary, AP Aging Detail, Unpaid Bills Detail, and Vendor Balance Detail.

### Phase 3: Receivables And Cash Pack

- Add AR aging snapshots, deposits, check/deposit detail, bank account balance snapshots.
- Build cash expected vs cash required.
- Compare against QuickBooks AR Aging, Open Invoices, Deposit Detail, and bank balances.

### Phase 4: Inventory And Purchasing Pack

- Add item receipts, inventory adjustments, inventory valuation snapshots.
- Build ordered vs received vs billed vs paid views.
- Tie into Order Review and PO Drafts.

### Phase 5: P&L / Balance Sheet / GL Pack

- Add report snapshot infrastructure for P&L, balance sheet, GL, transaction detail by account.
- Build executive financial dashboards with account/month/vendor/product drilldowns.

### Phase 6: Vinosmith Enrichment Pack

- Connect QuickBooks items/vendors/customers to Vinosmith wines, suppliers/importers, producers, FOBs, and price levels.
- Build wine-native sales, margin, and purchasing dashboards.

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
