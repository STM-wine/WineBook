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

The final worker deployment `dep-das8bbm0tbcc73e8vl90` is Live at `0c92e9d7209bb7a904ae8e882f6d5fb355556059`. During the rolling-deployment overlap, the outgoing worker completed normal ordering job `active:5968259` at 02:56:49 UTC (September 27). The new worker’s next normal job, `active:5968260`, hit a SQL statement timeout on its first attempt, then retried automatically and completed at 03:02:05 UTC, source version 267, with no final error. This refreshed the snapshot before the previous one’s ten-minute serving window expired. No local watch worker was running. The concurrency limit does **not** eliminate all intermittent database timeouts; automatic recovery was verified, but sustained refresh reliability remains a production limitation.

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

Web Auto-Deploy was temporarily disabled for the controlled rollout and restored to its original **On Commit** setting after the release documentation was pushed. Release commits use `[skip render]`; the web and worker deployments above were started manually.

## Limits

The 300–500 ms feedback and first-usable p95 under 3 seconds targets remain unproven. There was no two-buyer end-to-end production mutation test or 100-interaction browser measurement campaign. Existing correctness regression coverage is documented above. Production rollout does not change these evidence limits.

Rollback can restore the prior compatible web build and stop the worker while retaining the additive schema and completed snapshots. No guarded approval/PO transaction function was replaced.

## Follow-up: Order Summary stopped on a recoverable timeout

The user reported Order Summary unavailable shortly after release. Authenticated Safari reproduced a terminal “canceling statement due to statement timeout” message with a Retry button. The worker had already recovered and published source version 269, but the browser had stopped polling on the earlier HTTP 503. Retrying manually restored the page. The original smoke check missed this failure-to-recovery transition.

The snapshot API now returns HTTP 202 with an explicit automatic-retry stage for transient database/network failures, including failures when requesting the job. The existing browser polling then resumes when the current generation is ready. Substantive source failures remain errors; source-version, business-date and formula checks remain required. The worker also retries SQL statement timeouts up to three times for GET reads and the explicitly read-only sales-window RPC. Mutations and publication RPCs are never blindly replayed. Sanitized failure logs include the endpoint path and SQLSTATE to identify residual database bottlenecks without exposing request parameters or business records.

Regression tests cover failed-to-ready API recovery, requesting-job timeouts, substantive failure visibility, authentication, bounded read retries and no mutation retries. All **243 tests / 42 files**, typecheck and the optimized production build passed. Commit `b84960740cabda3c8404f022bf50ab78916f765b` is Live on both web (`dep-das8sre0tbcc73ebgl9g`) and worker (`dep-das8t1u0tbcc73ebhms0`). The new worker completed normal scheduled ordering job `active:5968267` on its first attempt at 03:35:17 UTC, source version 269. Authenticated Safari loaded that fresh snapshot after deployment. No production source failures were injected; the failed-to-ready response sequence was tested locally, while normal recovery and live loading were observed in production. Intermittent database timeouts remain possible, but they no longer permanently stop the Order Summary screen when the worker can recover.

## Follow-up: restore Order Summary presentation

The lazy-loaded overview had omitted the existing summary UI, leaving plain disclosure rows. Commits `0821f0d` and `28c2f52` restore the original six metric cards, supplier summary table, styled search and supplier cards. The overview and expanded editor share the same metrics/table components. Supplier detail fetching and the loading/retry sequence are unchanged. Approved currency values use a smaller responsive type size to fit their cards.

All 243 tests passed, along with typecheck and the production build. Final web deployment `dep-das9enh7lnhs73870030` is Live at `28c2f52a1ee1101ee1f1da39589e75992b9bd35b`. Authenticated Safari visual checks confirmed the restored cards/table and complete currency value. Searching Illahe filtered the table and supplier cards to one supplier; expanding it displayed loading feedback and then its verified details. No business data was edited.

## Follow-up: publication timeout and blank-screen wait

The next user report reproduced a long blank-screen verification wait. The sanitized deployed-worker logs conclusively identified repeated SQLSTATE 57014 failures at `POST /rest/v1/rpc/publish_ordering_read_model`, after calculation had succeeded. A current snapshot contained about 9.0 MB of supplier JSON. Prior read retries did not fix this publication bottleneck.

Migration `20260926230000_batched_ordering_publication` was applied transactionally with its migration-history record. The worker stages supplier groups in approximately 384 KiB batches (at most 20 suppliers; an oversized supplier is isolated). Final publication verifies the exact supplier identity set against the summary, plus the existing lease, source-version and business-date guards. Staged rows remain private until completion. Tests cover interrupted uploads, duplicate retries, wrong/expired/reclaimed leases, mismatched identities, source invalidation and access control.

The overview API can now return a previous same-day, same-formula summary, at most one hour old, as explicitly stale while polling continues. It preserves the old timestamp and source version. That fallback is read-only: supplier expansion waits for current data, and supplier API requests never receive stale action inputs. Component tests cover the pending-to-ready transition, disabled stale editing and cancellation on navigation. This behavior avoids a blank overview when a new dependency generation is being prepared.

Production verification:

- Three complete builds and publications from this computer succeeded with 86 suppliers / 23 batches each, in 9.595, 9.581 and 8.017 seconds. Publication alone took 6.513, 5.663 and 4.689 seconds. These are background-work samples, not browser p95.
- Final worker deployment `dep-das9qoojo6nc73arvpe0` and web deployment `dep-das9qsnpn0mc73ffnfkg` are Live at `e74118fdb6170b78cb7567b11c75bf587ae7fb67`.
- Two requested verification jobs completed on the deployed worker on their first attempts at 04:39:18 and 04:39:28 UTC. Its next normal five-minute job, `active:5968280`, completed on the first attempt at 04:40:17 UTC, source version 272, with no error.
- Authenticated Safari completed three consecutive overview loads and then expanded Illahe successfully. The UI fallback transition was tested locally; no production source failures were injected.
- All 250 tests / 44 files, typecheck and production build pass. All 73 migrations and five current local SQL suites pass; the unchanged 65-migration audit-deletion failure remains the expected baseline control.

Source data, approvals and PO contents were not edited. The existing source-verification/fallback warnings remain separate from snapshot publication. Sustained browser p95 and real multi-buyer mutation validation are still not claimed.
