# Loading performance implementation — September 26, 2026

Initial implementation evidence is recorded below. The user subsequently authorized a direct production release; see [the production release record](performance-production-release-2026-09-26.md) for deployed commits, follow-up fixes and live verification. The new read paths and local verification are in place. The 300–500 ms feedback and production p95 <3 s first-usable targets remain unverified. The two initially failing SQL safety suites are now resolved locally: one stale test was corrected and one audit foreign-key bug was repaired. See [the follow-up investigation](database-safety-investigation-2026-09-26.md).

Existing uncommitted sync-warning/sales-cutoff changes were preserved, including their move from `page.tsx` to `ordering-page-data.ts`. Existing audit, handoff, chart, and output artifacts were not changed. During the initial implementation phase, source probes were read-only and migration/mutation tests used disposable local PostgreSQL databases. Subsequent authorized production activity is recorded separately.

## Review stages

These are review groups, not a claim of separate commits. They form one coordinated release; the new web paths require the migrations and worker.

| Stage | Behavior | Primary files under `apps/web` unless specified |
| --- | --- | --- |
| 1. Loading and sales-first Home | Navigation streams before sales, current sales precedes margins, initial margin hydration is explicit, comparison loads independently, rep/account breakdowns reuse completed calculations. Previous results remain labeled while refreshing; obsolete responses cannot overwrite a newer selection. | `src/app/page.tsx`, `src/components/company-dashboard-view.tsx`, `src/components/wine-loading-progress.tsx`, `src/components/section-loading.tsx`, `src/app/error.tsx`, `src/lib/dashboard-snapshot-merge.ts` |
| 2. Products | Database filtering and stable sorting; 75 compact records per page plus one lookahead. Counts load separately. Rich detail loads on selection. Export iterates every matching record in the pinned snapshot and verifies exact count/unique IDs. | `src/lib/product-workspace-builder.ts`, `src/lib/product-workspace-reader.ts`, `src/app/api/products/workspace/route.ts`, `src/components/product-workspace-view.tsx` |
| 3. Focused ordering reads | Order Summary returns complete supplier totals, then one supplier's complete rows on expansion. Freight receives aggregates. PO Drafts returns summary totals/search text, then lines/notes/history on expansion. Supplier Hub loads logistics first and a selected supplier's catalog/requests/pricing history. | `src/lib/ordering-page-data.ts`, `src/lib/ordering-draft-reads.ts`, `src/lib/ordering-snapshot.ts`, `src/lib/freight-read-model.ts`, `src/app/api/ordering/`, `src/components/ordering-snapshot-home.tsx` |
| 4. Realtime and edit state | Approval events patch history; PO changes refetch run-scoped summaries and changed details. In-flight reads deduplicate. Dirty approvals survive source refreshes. Navigation and all-supplier PO creation flush every mounted supplier editor and stop on conflicts. | `src/components/order-dashboard.tsx`, `src/components/po-drafts-view.tsx`, `src/lib/shared-ordering-read.ts`, `src/lib/merge-ordering-read.ts`, `src/lib/approval-navigation.ts` |
| 5. Shared calculations | Worker-owned product reconciliation, margin snapshots, and verified ordering snapshots. Database leases, dependency epochs, business dates, formula versions and atomic publication deduplicate work across users. | `src/lib/read-model-jobs.ts`, `src/lib/company-dashboard-data.ts`, `scripts/refresh-read-models.mjs`, `scripts/read-model-runtime.mjs`, repository `render.yaml`, four migrations below |
| 6. Evidence | Functional race/failure tests, actual PostgreSQL contract tests, a repeatable baseline/current database harness, source probes, opt-in browser marks/long-task capture. | `src/components/*loading.test.tsx`, `src/lib/performance-contracts.test.ts`, `src/lib/product-route-security.test.ts`, `src/components/performance-observer.tsx`, `scripts/probe-performance.mjs`, repository `scripts/test-performance-local-db.py` |

Loading feedback uses accessible status announcements, elapsed time for longer waits, retry paths, and reduced-motion styles. “Stop waiting” aborts browser waiting, explicitly allowing server work to continue. No fabricated completion percentages are shown. Pending margin/business-line values are not rendered as zero. Separate source/date/scope generations are not merged as one result.

## Read, action and freshness contracts

- Products reconcile all active and inactive source records in the worker; the default SQL predicate still includes relevant inactive lifecycle mismatches. The sampled full snapshot has 8,882 rows, including 1,894 default-view rows. No client-side truncation or fixed source-record caps replace completeness checks.
- Product page, counts, detail and export share the same immutable snapshot. Search/filter/sort/counts apply to the complete matching dataset. “Export” means all matching rows, regardless of page. An expired snapshot fails explicitly; it never silently switches generations midway through an export.
- Product browsing can use the last completed snapshot, with its timestamp and stale status. Marker writes still use the existing authenticated mutation path. Reading an older product snapshot does not authorize an ordering operation.
- Order Summary's supplier finder searches suppliers. Filters and bulk row approval actions within an expanded supplier apply to that supplier's complete row set. “Create PO drafts from all saved approvals” retains the existing report-run-wide server operation, after flushing all mounted editors. Global summary and Freight totals come from the complete server-calculated dataset, not mounted rows.
- Ordering reads require a completed snapshot of the current dependency epoch, formula and Phoenix business date. A snapshot may be reused for up to ten minutes while the next five-minute refresh generation is queued. Source changes invalidate that eligibility immediately on the next read. Already-visible rows remain timestamped during refresh. Required PO mutation/export verification remains authoritative and unchanged.
- Supplier Hub counts/search/history are explicitly scoped to the selected supplier; logistics covers all suppliers. PO summary search includes all lines even when details have not been opened.
- Draft details compare the parent revision before and after retrieving lines/notes/history and reject a mixed revision. Existing transactional approval/PO functions, idempotency keys, lock versions, export integrity and internal-note exclusion were retained.
- APIs authenticate the user and check an enabled `app_profiles` row before constructing a service-role client or reading private cache tables. The application is currently a single shared business workspace; no per-user row access is introduced. A future tenant model must add tenant keys to cache identity and authorization. Private cache tables/functions are denied to `anon` and `authenticated`; responses use `no-store`. Service credentials stay server-side.
- Dashboard client reuse expires after 30 seconds and is keyed by period, explicit dates and scope. Completed sections merge only when date range, business scope and source epoch match. Server reads check the epoch before and after constituent queries. Current and previous-year margin results come from the same source epoch.
- Margin snapshot identity includes range, source epoch, formula version and Phoenix business date. Relevant source, pricing and cost changes invalidate current and historical margins. The existing 124-day stability window remains unchanged; a range is labeled provisional until its end is beyond that window, then finalized. Finalized does not mean immune to corrected sources/costs.
- The worker performs one existing line-matching pass per margin range and builds company/business-line/rep/account aggregates for reuse. Warm ranges are previous business day, MTD, YTD and their prior-year comparison ranges; other ranges are queued on demand. Existing detailed matching/formulas remain the source of truth.
- Jobs use a 15-minute lease token, `SKIP LOCKED` claims, and a unique generation key. Expired jobs can be reclaimed with a new token; there is no heartbeat extension. Publication verifies the lease and source epoch/date and commits records plus completion atomically. Failed work backs off for 60 seconds. The worker polls every five seconds and prunes hourly. Seven-day retention keeps the newest completed semantic range as a fallback; older pinned generations eventually expire.

## Measurements and limitations

Baseline numbers are the audit's single read-only diagnostic samples, not deployed browser measurements. Backend bytes are decoded response bodies, not compressed transfer. Authentication, Render scheduling and browser rendering are excluded. There is no valid before/after production p95 comparison.

| Path | Before | After/evidence | Interpretation |
| --- | --- | --- | --- |
| Initial Home | MTD with margins: 6.170 s, 30 DB requests, 3,375,198 decoded DB bytes | Initial code now requests sales only without comparisons/breakdowns. The audit's sales-only sample was 1.787 s, 4 requests, 144,225 bytes. New source-epoch checks add two lightweight reads. | The 1.787 s number is an existing isolated-path sample, **not a newly measured post-change Home timing**. Streaming and independent requests are functionally verified. |
| Initial Products | Full default assembly: 8.120 s, 120 DB requests, 13,336,893 decoded DB bytes; 1,894 rows/4,016,528 serialized API bytes | Local completed-snapshot first page: 75 compact rows, 104,355 serialized reader-response bytes. SQL read including 76-row lookahead: median 25.23 ms, observed p95 27.27 ms. | Expensive reconciliation moved off navigation. Local SQL timing excludes HTTP/auth/browser; the payload comparison also changes the record count by design. |
| Product reconciliation | Above baseline assembled default scope | Worker probe: 12.506 s, 154 DB requests, 14,294,853 decoded bytes; 8,882 active/inactive rows, 17,628,617 serialized bytes | Broader scope; **not a speedup comparison**. This cost is paid once per generation instead of per user. |
| Margin calculation | Initial MTD path including margins: 6.170 s | Worker MTD all-scope sample: 11.339 s, 26 DB requests, 3,347,109 decoded bytes; 520,091 serialized snapshot bytes | Different outputs/timing conditions; do not claim faster calculation. The worker reuses results across users and breakdowns. Prior-year work is excluded from this sample. |
| Ordering | 3.361 s, 22 DB responses, but no recommendation rows due to missing local Vinosmith token | New source-independent summary/detail contracts and aggregate parity tests; no successful live end-to-end ordering measurement | The failed baseline is not an ordering performance benchmark. Real-source staging verification is still required. |

Additional local PostgreSQL 14 measurements used the 8,882-record product snapshot, 20 warmed calls per operation, including `psql` process startup/local IPC. Percentiles below describe those 20 observations only:

| Operation | Median | Observed p95 | Decoded SQL JSON bytes |
| --- | ---: | ---: | ---: |
| Default page, 76 rows with lookahead | 25.23 ms | 27.27 ms | 112,403 |
| Numeric FOB sort | 136.65 ms | 142.57 ms | 110,270 |
| Include-inactive late page at offset 7,500 | 206.02 ms | 224.19 ms | 92,173 |
| Complete default counts | 165.73 ms | 171.03 ms | 1,576 |
| Search for GRW | 42.74 ms | 45.20 ms | 112,223 |

Local probe files are ignored under `tmp/performance/`; they can contain business records and are not part of the review artifact. Aggregate measurements are recorded above. Reproduce source probes with `npm --prefix apps/web run performance:probe` or append `-- --margins`; these read configured sources but do not publish snapshots. The worker refresh command **does write** to its configured database. Its later production execution is documented in the release record.

Set `NEXT_PUBLIC_PERFORMANCE_DIAGNOSTICS=true` for a staging production build to capture `winebook:*` marks, navigation and supported browser long-task entries in `window.winebookPerformance` (bounded to 500 entries; no network telemetry). Home/Product/ordering usable marks and loader-visible marks support paired interaction measurements. No browser long-task or paint results were collected in this implementation run. DOM tests verify behavior, not real elapsed performance.

## Verification

- Baseline web suite: 34 files, 206 tests passed.
- Updated web suite: 38 files, 229 tests passed. Includes initial margin hydration, independent comparisons, pending stages, stopping waits, out-of-order/ignored-abort responses, retained Product results, failures/retries, pinned pagination, lazy detail, full 1,250-row export, enabled-user authorization before cache access, dirty two-buyer state merging, navigation flush/conflict handling, and Freight aggregate parity over 1,250 rows.
- `npm --prefix apps/web run typecheck`: passed.
- `npm --prefix apps/web run build`: passed after final edits. Next.js 15.5.21 produced the optimized build; root route First Load JS is 208 kB. This build-size result does not measure browser usability time.
- `git diff --check`: passed.
- Worker module import smoke test: ordering server dependency graph loads through the Node TypeScript runtime without making source requests. Product and margin builders were exercised by the read-only probes.
- Local PostgreSQL harness: all 65 baseline migrations and all 70 current migrations applied successfully; the isolated 66-migration baseline-plus-repair schema also passes the safety suites. Supabase auth/scheduler primitives use explicit local stand-ins; this does not reproduce GoTrue, PostgREST or Realtime behavior.
- `supabase/tests/performance_read_models.sql`: passed. Tests more than 1,000 records, complete filters/counts/exports, compact/detail contracts, stable numeric sorts, lifecycle mismatch visibility, stale-epoch publication rejection, wrong/expired lease rejection/reclaim, and cache grants.
- `supabase/tests/performance_po_reads.sql`: passed. Creates a run/buyer/approval/draft through guarded functions and verifies summary fallback pricing (12 bottles, wine 120, laid-in 18, total 138) plus unloaded-line search.

Reproduce the database comparison with `python3 scripts/test-performance-local-db.py`. It creates and tears down its own temporary PostgreSQL cluster and writes logs/results under `tmp/performance/database/`. It exits nonzero if a repaired/current safety suite fails. The unmodified baseline deletion failure remains visible as an expected control.

### Initial failures and follow-up resolution

1. `supabase/tests/multi_buyer_safety.sql` fails with **“post-entry approval was not drafted as a delta”** (inline block line 186, test file statement ending at line 292). This occurs with the original 65 migrations and again with all 69 migrations.
2. `supabase/tests/add_wine_pricing_integrity.sql` fails deleting a pending catalog wine: an audit insert violates **`supplier_catalog_price_level_audi_supplier_catalog_wine_id_fkey`** because the parent is being deleted (statement ending at line 148). Reproduced with both migration sets.

Those were the initial results. The subsequent investigation found that the PO assertion contradicted the existing exact-version ordering-cycle rule. The SQL test and manual checklist now match that rule and add checks for duplicate suppression, clearing/reapproval, and immutable entered history; no ordering RPC changed. A separate forward migration repairs the incorrectly named audit foreign-key removal. Both expanded safety suites now pass in full, alongside both performance SQL suites. The original 65-migration schema passes the corrected PO test and still fails deletion; adding only the audit repair fixes deletion. See [the investigation](database-safety-investigation-2026-09-26.md) for evidence and deployment notes.

## Migrations and deployment order

Original staging proposal, subsequently superseded by the user’s explicit instruction to commit, push to main and deploy directly. The final production sequence and extra batch-publication migration are in the release record.

1. Review the standalone audit-retention repair and the corrected/expanded safety tests, then rehearse in staging with representative data. Local repaired/current SQL suites now pass.
2. Apply these expand-only migrations in timestamp order:
   - `20260926170000_performance_read_models.sql`: epochs, leased jobs, product records/read functions and dependency invalidation.
   - `20260926173000_ordering_summary_reads.sql`: service-only PO summary view.
   - `20260926180000_ordering_read_snapshots.sql`: ordering epoch, supplier snapshot storage and atomic publisher.
   - `20260926183000_read_model_retention.sql`: snapshot retention function.
   - Separately include `20260926200000_preserve_deleted_catalog_price_audit.sql`, the follow-up deletion repair; it has no dependency on the four performance migrations.
3. Start the separate `winebook-read-models` worker from `render.yaml`. Supply the correct environment's Supabase URL, server-only service key and Vinosmith token; keep `ORDERING_SOURCE_MODE` aligned with web. The worker needs dev dependencies for its TypeScript runtime. No service key belongs in a public variable.
4. Prewarm with the worker and verify completed products/current+comparison margins/ordering generations, source/date/formula metadata, row counts, publication failures and queue age. Cold caches provide loading/retry states but do not meet the usable-content target. Do not switch web traffic before valid snapshots exist.
5. Deploy the web build to staging. Use two distinct enabled buyer accounts for direct entry, navigation, revisits, throttled filters, expansion, saves, conflicts, PO creation/delta/refresh, exports, catalog mutations, interrupted syncs, business-date rollover and worker failure/recovery. Collect >=100 representative interactions per important path across cold/warm cases; report feedback latency and first-usable p50/p95, complete calculation time, server requests/bytes and long tasks. Record dataset, build, hosting, concurrency and network conditions.
6. Production release remains gated on the safety suites, successful real-source/two-buyer tests and measured acceptance targets. `autoDeploy` remains false.

Rollback web to the prior compatible build and stop the new worker if needed. Leave the additive tables/views/functions in place until no new web/worker instance relies on them; do not drop immutable snapshots during an active export. The new migrations do not replace the guarded approval/PO functions. Invalidation triggers add write overhead even after web rollback; removal should be a deliberate follow-up migration if required.

## Remaining bottlenecks and unverified behavior

- The single worker drains jobs serially. YTD and custom margin calculations can delay a cold ordering job. Multiple workers can safely claim different jobs, but sizing, priorities and actual concurrency performance require staging measurement.
- Ordering dependency epochs include approval/workbench changes. Sustained buyer activity can invalidate an in-flight ordering generation repeatedly, delaying fresh totals. Source correctness is favored over publishing a mismatched result. This is an explicit load-test risk; partitioning calculation dependencies is a likely next optimization if measured contention is material.
- Source invalidation is broad and synchronous per SQL statement. Large syncs may serialize on epoch rows and obsolete intermediate work. Lock/write overhead has not been load-tested.
- Product predicates/numeric sorts/counts still inspect JSON records; late offsets are slower. The local samples quantify this for the current dataset, not larger deployments. Typed indexed columns/keyset pagination may be needed at larger scale.
- The deployed margin worker retains the existing finalized daily rollups and calculates only recent inputs. It still performs repeated stored-rollup reads for representative/account scopes; cold YTD preparation can take substantially longer than MTD. The release record documents real-source historical and mixed-range parity.
- Expanded supplier rows retain calculation/identity safeguards and some bulky diagnostics. Many simultaneous expansions increase browser work and run-scoped subscription fan-out. Supplier Hub loads one complete supplier catalog, not an arbitrarily capped page. These need actual browser profiling.
- Full exports are complete but assembled in server memory. Larger workbooks can exceed hosting memory/time budgets; no streaming-export performance claim is made.
- Explicit report regeneration and inactive-wine restoration retain intentional refreshes. Ordinary approval/audit/PO/catalog realtime events no longer invoke the full page loader.
- Initial local verification did not include authenticated production browser timings, real Realtime delivery, two separate buyer browser sessions, successful live Vinosmith ordering verification, or a deployed worker. Later release checks are recorded separately. No production p95 or end-to-end multi-buyer sign-off is claimed.
