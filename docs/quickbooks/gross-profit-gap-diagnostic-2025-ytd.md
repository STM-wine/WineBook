# Gross Profit Gap Diagnostic: 2025 Through YTD 2026

Date: 2026-08-16

## Scope

Read-only diagnostic comparing QuickBooks invoice lines to cached Vinosmith sold lines and Vinosmith price levels for `2025-01-01` through `2026-08-16`.

## Headline Results

- QuickBooks invoices loaded: 25,776.
- QuickBooks invoice lines analyzed in the detailed gap pass: 70,147.
- Vinosmith order headers loaded: 21,806.
- Vinosmith order lines loaded: 58,804.
- Vinosmith prices for sold wines loaded: 5,271.
- Matched QuickBooks invoice lines: 53,819.
- Unmatched QuickBooks invoice lines: 16,328.

The path works, but the largest gap is source coverage, not item matching.

## Unmatched QuickBooks Line Buckets

| Gap | Lines | Line amount |
| --- | ---: | ---: |
| Zero-dollar invoice not in Vinosmith | 8,758 | $0.00 |
| Invoice not in Vinosmith | 7,267 | $1,675,842.42 |
| Quantity mismatch | 229 | $60,096.52 |
| Item code not on Vinosmith invoice | 6 | $19,357.77 |
| Zero-dollar quantity mismatch | 2 | $0.00 |

## Monthly Vinosmith Coverage Gaps

The largest missing-in-Vinosmith invoice coverage appears in:

- 2026-07: 2,200 of 2,200 QuickBooks invoices missing from Vinosmith cache.
- 2026-08: 967 of 967 QuickBooks invoices missing from Vinosmith cache.
- 2026-06: 1,146 of 2,458 QuickBooks invoices missing from Vinosmith cache.
- 2025-04: 320 of 345 QuickBooks invoices missing from Vinosmith cache.

This strongly indicates Vinosmith supplier-order cache backfill/refresh gaps for those periods.

## Price/Billback Matching For Matched Lines

| Price match result | Lines |
| --- | ---: |
| Exact wine + label + price match | 41,160 |
| Recoverable by unique wine + label with current price mismatch | 5,529 |
| Sample/free goods | 4,376 |
| No matching price label | 2,404 |
| Manual price, no billback expected | 410 |
| Ambiguous/unknown label match | 6 |

Exact price matches split into:

- Zero billback: 32,970.
- Positive billback: 8,190.

The unique wine + label fallback can recover another 5,529 rows, including 873 rows with positive billback, but those rows must be labeled lower-confidence because the sold price differs from the current Vinosmith price row.

## Recommended Next Repairs

1. Refill Vinosmith supplier-order cache for the missing coverage periods:
   - 2025-04
   - 2026-06
   - 2026-07
   - 2026-08 through current date
2. Re-run the workflow proof after backfill. Expected improvement is mostly invoice-line match rate, not price logic.
3. Keep exact price match as high confidence.
4. Allow unique wine + label fallback as lower confidence when price cents changed.
5. Keep manual prices and samples in separate buckets.
6. Investigate the small quantity mismatch and item-code mismatch buckets after source coverage is repaired.

## Post-Backfill Result

After REST backfilling Vinosmith supplier orders for 2025-04, 2026-06, 2026-07, and 2026-08 through 2026-08-16:

- Backfill worker: `scripts/backfill_vinosmith_supplier_orders_rest.py`.
- Reason for REST worker: current Supabase `sb_secret` keys work through PostgREST, while the older Python Supabase client rejects that key format.
- QuickBooks invoice lines: 70,147.
- Vinosmith order headers: 23,879.
- Vinosmith order lines: 64,468.
- All-line match rate: 86.47%.
- Positive-revenue QuickBooks invoice lines: 57,057.
- Positive-revenue matched lines: 55,451.
- Positive-revenue line match rate: 97.19%.
- Positive-revenue amount match rate: 96.99%.

Remaining unmatched buckets:

| Gap | Lines | Line amount |
| --- | ---: | ---: |
| Zero/negative invoice not in Vinosmith | 7,885 | $0.00 |
| Positive invoice not in Vinosmith | 1,321 | $328,022.04 |
| Quantity mismatch | 279 | $75,695.92 |
| Item not on Vinosmith invoice | 6 | $19,357.77 |
| Zero/negative quantity mismatch | 2 | $0.00 |

The biggest remaining zero-dollar bucket is sample-account activity. Top accounts include `SAMPLES - RB`, `SAMPLES - SCOTT`, `SAMPLES - SAMANTHA`, `SAMPLES - KRISTIN`, `SAMPLES - SARIYA`, and other sample accounts.

The biggest remaining positive missing-in-Vinosmith bucket includes internal or special accounts such as `Stem Owner Wine - Ryan`, `Stem Owner Wine - Mark`, and normal accounts that need exception review.

## Credit Workflow Caveat

Vinosmith is not a stable historical sales-line ledger when returns/credits happen. In the current operational workflow, an item may be deleted from the Vinosmith invoice so that Vinosmith matches QuickBooks after a credit. That means missing or mismatched Vinosmith lines can be legitimate artifacts of the credit workflow, not necessarily bad imports.

Workflow implication:

- QuickBooks remains the source of truth for original invoice lines, credit memo lines, net sales, returned quantity, period attribution, rep/account/item financial truth, and margin reversal.
- Vinosmith is used for operational enrichment and price-level/billback inference when the sold line is still present.
- Missing Vinosmith lines on credited/returned items should be bucketed as expected credit-workflow exceptions when confirmed.
- Do not chase 100% Vinosmith line match as the success criterion.
- The practical target is high coverage for normal positive-revenue wine sales plus clear confidence and exception buckets.

Current conclusion:

The workflow is strong enough to move from source-coverage repair into a GP proof/mart design. Positive-revenue line coverage is already about 97%, and the remaining gaps are small enough to handle with explicit exception buckets.
