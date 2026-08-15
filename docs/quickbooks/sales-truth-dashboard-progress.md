# QuickBooks Sales Truth Dashboard Progress

## Goal

Build a simple authenticated Stem Intelligence sales dashboard that demonstrates accurate sales by rep and by account using QuickBooks Desktop invoices minus credit memos. This directly addresses the sales team's Vinosmith problem: rep/account sales are inaccurate when Vinosmith credit memos are missing or wrong.

## Product Finding

QuickBooks Desktop can read credit memos from the Stem Wine Company company file through QuickBooks Web Connector and qbXML. The successful `CreditMemoQueryRq` result means "credit memos cannot be read" is not true at the QuickBooks Desktop API level for this environment. If Vinosmith cannot reflect them correctly, that appears to be a Vinosmith limitation, not a QuickBooks limitation.

## Current QBWC Status

- Stem Intelligence QuickBooks Web Connector app is installed in QuickBooks Desktop.
- The app is separate from Vinosmith and Melio.
- Auto-Run is intentionally off for now.
- The first `.qwc` version failed because `IsReadOnly=true` prevented QBWC from writing its internal `FileID` registration.
- Commit `0e84899` changed generated `.qwc` files to `IsReadOnly=false` for setup only. The Stem service remains read-only through a server-side qbXML allowlist.
- The first transaction query attempt failed with `0x80040400` because the generated transaction query XML was malformed for QuickBooks Desktop.
- Commit `d4d0113` fixed the transaction query XML.
- After Render deployed `d4d0113`, QuickBooks Web Connector completed all five proof requests:
  - `CustomerQueryRq`: Status OK
  - `ItemQueryRq`: Status OK
  - `InvoiceQueryRq`: Status OK
  - `CreditMemoQueryRq`: Status OK
  - `ReceivePaymentQueryRq`: Status OK

## Sales Dashboard Implementation

The first dashboard is intentionally proof-oriented and lives inside the authenticated Stem Intelligence app after sign-in.

Implemented pieces:

- `Sales Dashboard` is now the default authenticated home view.
- `Order Review` remains available in the top navigation.
- QBWC responses for invoices, credit memos, and receive payments are parsed and persisted into existing QuickBooks Supabase tables when the Web Connector runs.
- The dashboard summarizes QuickBooks invoice sales, credit memos, and net sales by:
  - sales rep;
  - customer/account.
- The dashboard also shows recent invoice and credit memo headers as a sanity-check sample.

## Important Limitation Of This First Version

The successful QBWC run before this dashboard existed only proved connectivity and returned status checks. It did not persist parsed rows. After this deploy, run the `Stem Intelligence` row in QuickBooks Web Connector again manually so the new parser can populate Supabase.

The current QBWC queue is now a focused daily delivery-date proof pull. Invoice and credit memo header queries default to a 1,000-record cap over the configured transaction window. This still is not yet a full historical sales replacement.

## Daily Delivery-Date Pull Update

- Added SalesRepQueryRq to resolve QuickBooks sales rep initials to the SalesRepEntityRef full name, based on Intuit QuickBooks Desktop SDK SalesRepQuery behavior. The next Web Connector run should overwrite daily invoice/credit memo rows with enriched rep names.
- The August MTD pull returned 505 invoices and timed out in Web Connector, so the next proof is scoped to one delivery day at a time.
- Changed the next Web Connector pull target to delivery date 2026-08-13.
- QuickBooks transaction queries pull 2026-08-13 through 2026-08-14 to catch invoices that may appear the day after delivery.
- The dashboard now filters invoices by QuickBooks ShipDate when present, falling back to invoice transaction date when ShipDate is blank.
- Credit memos are filtered by transaction date for the same daily window.
- The Web Connector now requests only invoice and credit memo headers for the proof dashboard; line items, linked transactions, customers, items, and payments are excluded for now to avoid timeout.

## Inspection Update

- Sales rep enrichment run completed at 2026-08-15T01:30:40.763Z. SalesRepQueryRq returned 28 reps, InvoiceQueryRq returned 139 invoices, CreditMemoQueryRq returned 4 credit memos, and lastError was null.

- Daily delivery proof run completed at 2026-08-15T01:07:50.334Z for delivery date 2026-08-13.
- Web Connector completed 2 of 2 requests and closed cleanly with lastError null.
- The run returned 139 invoice headers and 4 credit memo headers.

- After Render deployed diagnostics, a follow-up QBWC run completed at `2026-08-15T00:49:07.370Z` with `lastError: null`.
- Live status reported `persistenceConfigured: true`.
- The follow-up run returned `recordCount: 10` for invoices, `recordCount: 10` for credit memos, and `recordCount: 10` for payments.
- This means QuickBooks returned sales records and the server had the private Supabase persistence configuration available during the run.

- The post-deploy QBWC run completed successfully with all five request types reporting `Status OK` and `lastError: null`.
- The public Supabase API correctly denies anonymous reads of the QuickBooks tables, so table counts cannot be inspected from the local anon key.
- Added safe diagnostics to the Web Connector status payload: `persistenceConfigured` and per-response `recordCount`.
- Changed missing service-role persistence config from a silent skip into a visible Web Connector session error for future runs.

## Recovery Queue Implementation

- Added a QuickBooks recovery queue using the existing private source_sync_checkpoints table.
- The queue seeds sales reps, customers, vendors, items, one daily invoice job, one daily credit memo job, and monthly receive payment, purchase order, and deleted-transaction jobs from 2018-08-14 through 2026-08-14 by default.
- Web Connector now claims one recovery job per session, so long historical recovery runs are broken into small safe requests.
- Invoice and credit memo recovery jobs also pull SalesRepQueryRq in the same session so rep initials can be resolved to full names during persistence.
- Historical invoice, credit memo, and purchase order jobs now request line items and linked transactions; the proof dashboard fallback remains scoped separately.
- CustomerQueryRq, VendorQueryRq, ItemQueryRq, PurchaseOrderQueryRq, invoice, credit memo, and receive payment responses persist into the existing QuickBooks tables.
- TxnDeletedQueryRq responses are captured as raw QuickBooks responses for audit/reprocessing while a first-class deleted-transaction table is still pending.
- Jobs store iterator continuation state in source_sync_checkpoints.cursor_data and record counts/status diagnostics in source_sync_checkpoints.diagnostics.
- Fixed queue status/claiming after the first expanded run showed Supabase's default 1,000-row select limit was undercounting total queue progress and the claimer could skip higher-priority resource rows. Status now uses exact count queries and claims jobs by resource priority directly.
- Changed recovery claiming to work backward from the current backfill end date instead of forward from 2018. The queue now defaults the backfill end to the current server date unless `QUICKBOOKS_RECOVERY_BACKFILL_END` is set, prioritizes current-year YTD first, then all of 2025, then older history, and walks invoice/credit-memo jobs by newest sales dates so early manual runs produce useful net-sales facts quickly.
- After validating real `2026-08-14` invoice and credit memo reads, changed current-year YTD and 2025 sales-truth recovery from daily jobs to 7-day windows. Auto-seeding now inserts weekly invoice/credit-memo checkpoints for those priority windows and marks still-pending daily sales jobs inside those windows as completed/superseded, while keeping completed daily proof jobs intact.
- After the first larger weekly invoice run returned exactly the 200-record cap, changed first-page recovery requests to start QuickBooks iterators and bumped weekly sales checkpoint keys to `weekv2:*` so capped weekly windows are re-queued with continuation support.
- Adjusted the recovery order to finish current-year YTD sales back to Jan. 1 first, then pull QuickBooks items before continuing into 2025 sales history. This keeps the Sales Truth Pack moving while bringing item/product truth forward for ordering work.
- QuickBooks iterator IDs are session-scoped. After an attempted cross-session continuation returned status `3391`, changed Web Connector recovery sessions to append iterator continuation requests before closing the same session, fail QuickBooks `Error` statuses instead of completing them, and bumped weekly sales checkpoint keys to `weekv3:*` so the capped Aug. 6-12 invoice window is re-run with in-session continuation.
- After several clean one-week YTD recovery runs, added an idempotent consolidation step that merges only still-pending `weekv3:*` sales-truth rows into two-week `span2v1:*` jobs. Already completed weekly windows stay intact, while the remaining YTD and 2025 sales pulls move faster without switching to risky month-sized requests.

## Current Recovery Handoff

- Nightly stopping point: the live status endpoint showed `pending: 5024`, `completed: 1715`, `failed: 0`, and `running: 0`.
- Web Connector Auto-Run remains off. Recovery is still manual-run only.
- Current YTD sales recovery has completed backward through the `2026-04-09` to `2026-04-22` invoice and credit memo window.
- Next queued job is `quickbooks_invoices` for `span2v1:2026-03-26:2026-04-08`.
- QuickBooks items have not been pulled yet. The queue is still set to finish YTD sales back to Jan. 1 first, then run `quickbooks_items`, then continue into 2025 sales.
- Two-week windows are working cleanly. Completed `span2v1` invoice windows so far:
  - `2026-06-18` to `2026-07-01`: 538 invoices; matching credit memos: 13.
  - `2026-06-04` to `2026-06-17`: 602 invoices; matching credit memos: 17.
  - `2026-05-21` to `2026-06-03`: 604 invoices; matching credit memos: 20.
  - `2026-05-07` to `2026-05-20`: 630 invoices; matching credit memos: 18.
  - `2026-04-23` to `2026-05-06`: 711 invoices; matching credit memos: 21.
  - `2026-04-09` to `2026-04-22`: 710 invoices; matching credit memos: 23.
- Completed one-week YTD windows before the two-week consolidation:
  - `2026-08-13` to `2026-08-15`: 139 invoices; matching credit memos: 4.
  - `2026-08-06` to `2026-08-12`: 252 invoices; matching credit memos: 9.
  - `2026-07-30` to `2026-08-05`: 239 invoices; matching credit memos: 12.
  - `2026-07-23` to `2026-07-29`: 245 invoices; matching credit memos: 13.
  - `2026-07-16` to `2026-07-22`: 251 invoices; matching credit memos: 8.
  - `2026-07-09` to `2026-07-15`: 220 invoices; matching credit memos: 9.
  - `2026-07-02` to `2026-07-08`: 205 invoices; matching credit memos: 7.

## Historical Mirror Source Rules

- Goal: read-only QuickBooks historical mirror as far back as the Stem Wine Company QuickBooks file will allow.
- There is one active QuickBooks company file: Stem Wine Company.
- QuickBooks is the first source for customers, vendors/suppliers, items, sales reps, invoices, credit memos, payments, purchase orders, sales price, total sales, and net sales.
- Canonical sales date is invoice delivery/ShipDate when present, falling back to transaction date.
- Vinosmith follows QuickBooks for supplier/importer/producer/wine-name/pack-size/FOB/catalog detail, sales rep enrichment, and price levels.
- Credit card fields and SSNs are intentionally out of scope; normal customer/vendor operating data is in scope.
- Raw QuickBooks XML should be retained during recovery so records can be re-parsed without re-querying QuickBooks.

## Next Steps

1. Resume manual Web Connector runs at `span2v1:2026-03-26:2026-04-08`.
2. Continue paired invoice and credit memo checks until YTD reaches Jan. 1, 2026.
3. Confirm the queued `quickbooks_items` pull runs immediately after YTD sales completes.
4. Start Sales Truth Pack validation from the recovered 2026 YTD invoice and credit memo data.
5. Keep Auto-Run off until the manual two-week queue cadence is fully reviewed.

## Guardrails

- No QuickBooks write-back is implemented.
- The service still blocks `AddRq`, `ModRq`, and `DelRq` qbXML requests.
- Keep Web Connector Auto-Run off until the sync cadence and data volume are reviewed.

## Implementation Update

- Added `apps/web/src/lib/integrations/quickbooks-response-persistence.ts` to parse QBWC invoice, credit memo, and receive payment responses and upsert them into existing QuickBooks tables.
- Added `apps/web/src/lib/supabase/quickbooks-sales-dashboard.ts` to summarize invoices minus credit memos by rep and account.
- Added `apps/web/src/components/sales-dashboard-view.tsx` as the authenticated Sales Dashboard UI.
- Updated the primary dashboard navigation so `Sales Dashboard` is the default view after sign-in.
- Added scoped dashboard CSS in `apps/web/src/app/globals.css`.

## Validation

- `npm ci` completed after network approval.
- `npm run typecheck` passed.
- Commit `7fe077a` was pushed to `main`.
- After the deploy, the `Stem Intelligence` QuickBooks Web Connector row was run manually.
- The live connector status endpoint showed a completed session at `2026-08-15T00:39:57.232Z` with `requestCount: 5`, `completedRequestCount: 5`, and `lastError: null`.
- The post-dashboard run returned `Status OK` for `CustomerQueryRq`, `ItemQueryRq`, `InvoiceQueryRq`, `CreditMemoQueryRq`, and `ReceivePaymentQueryRq`.
