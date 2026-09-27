# Production loading-performance release — September 26, 2026

The user explicitly authorized committing and pushing to `main` and deploying directly. This replaced the original staging-first/no-production instruction. Production is `https://stmhq.com`, Supabase project `hpnvlxvnzpojpfepcerl`, Render web service `srv-d87q9199rddc73arv2g0`.

## Code and database

- `0297705`: coordinated loading/read-model implementation and audit-deletion repair; all original changes are one release commit, grouped for review in the implementation report.
- `6c34fdf`: batch product snapshot uploads and Node 24 worker runtime.
- `541502e`: restore the finalized-period calculation basis, add stored-rollup invalidation and require workers to claim only supported formula versions.
- `0c92e9d`: limit the background worker to two concurrent database requests.
- Previous web release: `cfd14432e01bf497607ec50518b18e7b1106ba40`.
- Applied the five original migrations together in a transaction, including migration-history records. Then applied `20260926210000_batched_product_publication.sql` in a separate transaction after the production issue described below. A seventh migration, `20260926220000_invalidate_stored_margin_snapshots.sql`, adds finalized-rollup invalidation and formula-specific worker claims. All seven migration-history entries were verified.
- Source/business safety mutation tests ran only against disposable local databases. Production writes were schema/history, derived snapshot jobs/records and deployment configuration. The existing source loader also expired abandoned QuickBooks sync sessions through its preexisting check. No test orders, approvals or catalog edits were created.

## Deployment findings and fixes

The initial full-product upload contained approximately 17.6 MB of JSON. Two upload attempts received Cloudflare 521 and were followed by temporary Supabase unavailability. This is observed correlation; database/platform logs were not obtained to prove the precise failure mechanism. Smaller uploads eliminate the observed failure.

The worker now stages at most 200 rows per request, then publishes only after the exact unique row count is verified. Readers require a completed job. Staged records are invisible through the read API. Lease ownership, expiry, business date and source version remain enforced; reclaimed work replaces its abandoned staged rows. Uploading all 8,882 records and completing publication succeeded in 43.234 seconds from this computer, including source assembly and upload. This is background preparation time, not page-load time.

Render’s initial Node 20 worker failed because the installed Supabase client requires a WebSocket implementation. The worker now uses Node 24, matching local verification. Render service `winebook-read-models` (`srv-das7o6d9fdbs73c7jjtg`) uses the 0.5 CPU / 512 MB plan at $7/month, root `apps/web`, build `npm ci --include=dev --ignore-scripts`, start `npm run read-models:watch`. Credentials are server-only environment settings.

The corrected worker deployment is `dep-das7r58jo6nc73aj7ge0`, commit `6c34fdf`. It was verified Live before web deployment began. Current and prior-year previous-day, MTD and YTD margin jobs completed. Ordering completed with 82 supplier groups and no source warning. The product generation contains all 8,882 active/inactive records. Old source generations were rejected as obsolete during preparation rather than relabeled current.

The first web deployment of `6c34fdf` went Live, then authenticated Home verification caught a historical GP discrepancy (31.2% previously versus 32.6% after live recalculation, including the existing accrual). The web service was rolled back to `cfd1443` immediately while correcting this. Commit `541502e` retains stored totals through the unchanged 124-day boundary and calculates only the recent portion. The snapshot formula changed so old erroneous results cannot be reused. Real-source comparisons against the prior implementation match for historical MTD and mixed stored/live current YTD, including company and business-line totals. Four regression tests cover finalized, mixed, recent and unavailable-history cases.

The corrected calculation worker went Live at `541502e` (`dep-das81lt9fdbs73c8t9qg`). Formula-specific claims prevent an older worker from producing a result under a newer formula label during rolling deployment.

Ordering refreshes continued to hit SQL statement timeouts after the concurrent source sync ended. Instrumented reads identified the QuickBooks sales-window RPC and item reads timing out during a burst of parallel requests; the same queries succeeded individually. Commit `0c92e9d` bounds worker database concurrency to two requests and releases permits on success or failure. A real-source snapshot build and guarded publication succeeded in 23.169 seconds; a second read-only build completed in 8.522 seconds, both with 82 suppliers and no source warning. These are individual background-work samples, not browser timings.

The final worker deployment `dep-das8bbm0tbcc73e8vl90` is Live at `0c92e9d7209bb7a904ae8e882f6d5fb355556059`. After deployment, its normal scheduled ordering job `active:5968259` completed automatically at 02:56:49 UTC (September 27), source version 267, with no error. No local watch worker was running.

## Validation

- Final worker-concurrency change: **235 tests / 40 files pass**, including concurrency bounds and permit release after failures; JavaScript syntax and diff checks pass. The web code is unchanged from the verified `541502e` production build.
- Original release: 229 web tests / 38 files, typecheck, optimized Next.js production build and diff checks passed.
- After historical fix: all 233 web tests / 39 files, typecheck and optimized production build passed. Full disposable database comparison passes with all 72 migrations, including checks that unversioned/wrong-formula workers cannot claim jobs.
- After batch fix: JavaScript syntax/diff checks and the full disposable database comparison passed. All 71 current migrations apply; corrected multi-buyer, deletion-integrity, product-read-model and PO-summary SQL suites pass. Expanded batch tests cover hidden incomplete uploads, incomplete-count rejection, duplicate upload retries, completed-record protection, expired/wrong/reclaimed leases, source invalidation and service-only grants. The original 65-migration deletion failure remains the expected baseline control.
- Real production Supabase reader checks, run from this computer with server-side credentials: first 75 rows 687 ms / 104,355 serialized bytes; full counts 715 ms; one detail 155 ms; one search 269 ms. These are individual network-backed server-reader samples, not browser paint timings, not a p95, and not measured from Render.
- Full include-inactive export was read across nine pages and checked against the complete count: **8,882 records, 8,882 unique IDs**, no missing/duplicate IDs. Every response reported the snapshot current. Individual export-page samples ranged from 632 to 1,074 ms.

## Live web verification

Final web deployment `dep-das84cl9fdbs73c98hug` is Live at `541502e76f6cf19cefee0592a745f862a9941f14`. Authenticated Safari checks on `https://stmhq.com` passed:

- Home displays sales first with loading feedback, then hydrates margins. Current Stem GP is 29.5%, prior-year 31.2%, delta −1.8 points, matching the historical calculation basis. The rep breakdown loads on demand.
- Products displays 75 of 1,894 active matches. Next-page pagination works, prior rows remain visible during refresh, the Illahe search returns eight results with scoped counts, and opening a product loads its detailed source/cost/pricing panels.
- Order Summary displays 82 supplier summaries (15,054 recommended bottles, 1,968 approved outstanding). Opening Illahe loads its eight SKUs on demand.
- PO Drafts displays five drafts, 23 lines and 1,392 bottles. Opening Occidental loads its two lines and existing notes/history.
- Freight displays its aggregates and pickup rows, including 15,054 suggested bottles and $9,853.92 freight.

- Supplier Hub scoped to Illahe loads its complete saved supplier catalog (one wine), counts and existing pricing/match status.

These checks were read-only. Production approval/PO mutation flows were not exercised.

A concurrent Vinosmith rescue sync ran from 02:34:23 to 02:37:39 UTC (September 27). It was not initiated by this release. Source changes correctly rejected intermediate generations. Some ordering queries timed out during rebuilding; subsequent retries completed. Afterward, product source version 613 contained 8,882 records, all six margin ranges completed under the corrected formula at version 668, and ordering version 267 completed with 82 suppliers and no warning at 02:41:39 UTC. Source-version numbers are observations, not fixed configuration.

An unauthenticated request to the Products API returned HTTP 401. No browser service-role access was introduced.

## Limits

The 300–500 ms feedback and first-usable p95 under 3 seconds targets remain unproven. There was no two-buyer end-to-end production mutation test or 100-interaction browser measurement campaign. Existing correctness regression coverage is documented above. Production rollout does not change these evidence limits.

Rollback can restore the prior compatible web build and stop the worker while retaining the additive schema and completed snapshots. No guarded approval/PO transaction function was replaced.
