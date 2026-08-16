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
