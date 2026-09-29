# Homepage GP audit — September 29, 2026

## Findings and decisions

Checked live MTD and YTD homepage cards, source-generation 8152 snapshots, 41,307 individual 2026 QuickBooks-derived lines, invoice/credit header reconciliation, and all 148 historical daily company rollups for Jan 1–May 28. Recent QuickBooks header and line revenue reconciled to the cent; snapshot arithmetic and weighted YTD merging were correct. Existing Stem headline cards add a 1.1% sample reimbursement estimate; the business-line split shows base GP. GRW has no sample accrual.

Found two errors/measurement problems:

- Paid QuickBooks lines were excluded as samples when a Vinosmith quantity match had a zero custom price. Three MTD lines (STM126399/TWI000021, STM126563/LIE000036, STM127007/DWI000025) total $3,954 sales and $1,286.082 base GP. Across the recent May 29–Sep 29 segment, net excluded revenue was $8,983.11 and base GP $2,771.99.
- Warehouse Storage Rent, Customer Deposit and generic CREDIT MEMO items affected the GP denominator despite contributing no GP. User explicitly chose to exclude non-wine items from wine GP. Total sales remain intact; GP and sample accrual use a separate wine-sales denominator. Unknown-cost wines are not automatically excluded.

The user explicitly chose to **preserve historical cost basis**. Rebuilding Jan–May at current costs would change base GP by about $9,990.26 before these fixes. Therefore, no historical wine costs, GP dollar amounts, sample costs, or sales amounts are recalculated. Historical non-wine exclusion metadata can be repaired from the corresponding QuickBooks source lines without repricing wines.

## Remaining historical exception

Jan–May stored sample buckets contain **$16,505.77 of net paid sales** that remain excluded. Original line-level costs are not retained in these daily aggregates, so correcting their GP with today's costs would violate the user's decision. These older paid-sample errors are explicitly deferred for separate reconciliation. YTD is therefore **not certified fully reconciled**, despite the displayed percentage rounding to the same value. Prior-year sample classification likewise remains on its historical basis.

## Implementation

QuickBooks zero-dollar status controls sample classification when its amount is known. Conflicting zero/100%-discount Vinosmith entries cannot supply an inferred billback. Explicit non-wine entries get their own classification; total revenue and document counts are retained, while the GP numerator, denominator and 1.1% accrual exclude them. Live, stored, merged, rep/account, and headline-card paths carry the wine denominator. Snapshot formula version changes to `snapshot-v3-wine-gp` to avoid reusing prior snapshots.

`repair-historical-wine-gp-exclusions.mjs` defaults to read-only, verifies historical no-cost provenance, saves complete before-images, and only changes classification metadata and GP ratios. It does not recalculate frozen dollar values. Dry run found 1,058 affected stored rows across company, rep, account and rep-account scopes. Company exclusions: 2025 net -$4,506.68; Jan–May 2026 net -$12,531.49. Complete audit source captures and repair backups are ignored local files under `tmp/`, not committed customer records.

## Expected results using source generation 8152

| Stem | MTD | YTD (historical exceptions retained) |
|---|---:|---:|
| Total net sales | $739,303.70 | $7,556,214.69 |
| Wine GP net sales | $739,178.55 | $7,567,854.01 |
| Base GP | $210,138.51 | $2,126,217.76 |
| 1.1% sample accrual | $8,130.96 | $83,246.39 |
| Headline GP dollars | $218,269.47 | $2,209,464.15 |
| Headline GP% | 29.5287% → **29.5%** | 29.1954% → **29.2%** |

GRW remains MTD 17.4510% → 17.5%, YTD 11.0382% → 11.0%.

## Validation and release

302 tests in 52 files passed, plus all three focused GP engine tests, typecheck and production build. Regression coverage includes paid wines matched to zero-price Vinosmith lines, real samples, explicit non-wine exclusions, unknown-cost wines, separate revenue/GP denominators, historical GP preservation, weighted period merging, and headline sample accrual. Production repair/deployment verification will be recorded below.
