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

The current QBWC queue is still a small discovery sample, controlled by `QUICKBOOKS_DESKTOP_DISCOVERY_MAX_RETURNED` and defaulting to 10 records per request. This first dashboard proves the data path and credit memo visibility; it is not yet a full historical sales replacement.

## Next Steps

1. Deploy this dashboard/parser commit to Render.
2. Manually run `Stem Intelligence` in QuickBooks Web Connector once.
3. Confirm `quickbooks_invoices` and `quickbooks_credit_memos` receive rows.
4. Review the Sales Dashboard after sign-in.
5. Add date-window filters and larger pull sizes.
6. Add incremental sync/backfill logic.
7. Add Vinosmith comparison columns to show where Vinosmith sales diverge from QuickBooks net sales.
8. Decide an operating cadence before enabling Auto-Run.

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
