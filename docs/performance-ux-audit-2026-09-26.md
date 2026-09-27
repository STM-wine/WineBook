Performance and loading UX assessment — September 26, 2026

The main problem is how much work the application requires before someone can use a screen. Several routes assemble complete datasets, including information for unopened views, before returning useful content. Loading indicators need consistent coverage, but reducing this initial work is the larger fix.

This is an assessment, not an implementation. Existing working-tree changes were preserved. No application source, database records, configuration, or deployment was changed by this audit.

**Evidence and measurement limits**

Reviewed the production Next.js application: home/dashboard loaders, ordering and product data paths, Supabase queries and relevant SQL migrations, client rendering and navigation, realtime refresh, settings/data health, and converter loading behavior. The older Streamlit implementation is not the current production runtime and was not treated as the optimization target.

The production site opened at its login screen in the available browser. Authenticated browser paint, interaction, rendering, and production Render timings were not measured. Existing local credentials allowed read-only samples against the configured Supabase database. These samples execute the current local TypeScript data functions, including existing uncommitted changes; the exact deployed revision was not verified.

Each timing below is one diagnostic sample, not a controlled cold/warm comparison, percentile, load test, or performance guarantee. HTTP response bodies were consumed for measurement. Database byte counts are decoded response-body bytes, not compressed network transfer or browser bundle size. Authentication, production hosting, and browser work are excluded. Database caches, network conditions, and concurrent syncs can change results.

| Read path | Elapsed | Database requests | Decoded database response bytes |
| --- | ---: | ---: | ---: |
| MTD dashboard, sales only, no breakdowns | 1.787 s | 4 | 144,225 |
| MTD dashboard, current initial-load behavior including margins | 6.170 s | 30 | 3,375,198 |
| Active-run recommendations alone: 1,915 rows | 1.636 s | 2 | 4,798,625 |
| Product Workspace data assembly, excluding authentication | 8.120 s | 120 | 13,336,893 |

The product response contained 1,894 rows and serialized to 4,016,528 bytes before compression. Its own timing measurements attributed approximately 5.5 seconds to initial source fetches. Ninety-three requests went to the Vinosmith wines mirror table in Supabase; these were not 93 requests to the external Vinosmith API.

The full ordering loader was also sampled, but local `VINOSMITH_API_TOKEN` was unavailable. It read 22 database responses, including 2,060 approval events and 24 drafts, then returned no recommendation rows because current-source verification failed. Its 3.361-second duration is an incomplete-path measurement and must not be represented as a successful ordering-page benchmark. This local configuration limitation does not establish a production configuration problem.

A separate local Node sample of DI recommendations, target-week application, metrics, and supplier grouping took 33 ms for 1,915 saved recommendations. That does not measure React rendering, browser main-thread blocking, or all margin calculations. It does make data retrieval the better first optimization target for the sampled ordering path.

**1. Home waits for margins before showing the usable dashboard — highest priority**

[The home page](/Users/markyaeger/Documents/WineBook/apps/web/src/app/page.tsx:63) awaits `fetchCompanyDashboardData` with breakdowns disabled but gross profit still enabled by default. Current and prior-year work must finish before `CompanyHome`, including its navigation, is returned. A route loading fallback exists; this is a delay to useful content, not proof that the browser is entirely blank.

[The margin loader](/Users/markyaeger/Documents/WineBook/apps/web/src/lib/company-dashboard-data.ts:351) uses stored rollups only for the stable portion of a range. [The stability lag is 124 days](/Users/markyaeger/Documents/WineBook/apps/web/src/lib/supabase/gross-profit-stored-rollups.ts:7). As a result, current-month reporting still invokes the detailed matching pipeline. Disabling breakdowns avoids constructing some aggregates but does not avoid reading the underlying line-level inputs.

The live path reads invoice and credit headers, their lines, linked invoices, matching Vinosmith orders, wines, prices, and QuickBooks item costs. Those dependent stages create a waterfall. Opening a rep/account breakdown calls the full dashboard endpoint again with profit enabled, so deferred UI does not necessarily reuse the expensive computation.

Recommendation: show navigation, date controls, and sales KPIs first; let the margin cards and comparisons finish independently. Initial profit hydration must be added explicitly if the initial server call becomes sales-only: the current mount effect does not automatically call `hydrateProfit`. Display unavailable/pending values as such, not as zero or as unlabeled values from another date range. Native Next.js streaming and nearby Suspense boundaries support this separation: [Next.js 15 data-fetching documentation](https://nextjs.org/docs/15/app/getting-started/fetching-data).

Then extend the existing rollup system to maintain refreshable recent-period results. The 124-day stability policy can remain a distinction between finalized and provisional periods; it should not force every visitor to recompute provisional periods. Refresh affected periods after successful source syncs and relevant cost, billback, or formula changes. Publish each completed result atomically with its input versions, business date, formula version, and calculated-at timestamp. Because current item cost participates in historical calculations, invalidation needs to account for that dependency, not only changed invoice dates.

**2. Products limits display rows after loading everything — highest priority**

[The product endpoint](/Users/markyaeger/Documents/WineBook/apps/web/src/app/api/products/workspace/route.ts:153) first fetches QuickBooks items, suppliers, catalog wines, catalog prices, Vinosmith supplier hints, active Vinosmith wines, and ordering markers. It then matches additional wines by code and name, fetches prices, builds rich product objects, and performs exact counts before responding.

The QuickBooks fetch includes inactive rows even for the default active view. Some of those rows support legitimate lifecycle mismatch detection; simply dropping them would lose that behavior. This matching should be represented in a maintained product read model, so browsing does not repeatedly perform catalog reconciliation.

[The client](/Users/markyaeger/Documents/WineBook/apps/web/src/components/product-workspace-view.tsx:55) displays the first 200 rows and supports showing more. This reduces DOM work, but all 1,894 assembled products in the sample had already been fetched. Searching and sorting operate on the downloaded dataset.

Recommendation: return a compact first page of approximately 50–100 products, with filters and stable sorting applied in the database. Fetch a product's full pricing and source explanation when its detail panel opens. Fetch aggregate counts independently. Preserve mismatch visibility through the read model. Load the next page on demand and optionally prefetch one likely next page.

Pagination must preserve global search, sort, counts, and exports. Export the entire requested filtered dataset through a separate server operation; do not accidentally export only the currently loaded page. Existing caps such as `MAX_WORKSPACE_ROWS = 10000` are not a durable completeness strategy.

**3. Ordering, Freight, Supplier Hub, and PO Drafts share excessive initial data — high priority**

Except for Home and the dedicated Product Workspace branch, [the root page](/Users/markyaeger/Documents/WineBook/apps/web/src/app/page.tsx:85) calls one `loadOrderingPageData` function without a requested-view argument. Direct entry to PO Drafts therefore pays for recommendations and current-source calculations as well as PO data. Direct entry to Supplier Hub also loads approval events and draft details.

The loader retrieves whole recommendation rows, the full supplier catalog with nested price levels/free goods/workbench records, current-run approval history, drafts with revisions and lines, collaboration notes, profiles, vendor mappings, and availability. Recommendations alone were roughly 4.8 MB; the `diagnostics` values contributed approximately 1.67 MB before surrounding property names and other JSON overhead.

Recommendation: give each view its own minimum data contract. Order Summary should start with supplier totals and load a supplier's rows when opened. PO Drafts should start with draft summaries and fetch lines, notes, and audit history on expansion. Supplier Hub should fetch supplier logistics and selected catalog pages. Freight should read aggregate results. Keep any specific diagnostic fields required for business identity and safeguards in a compact typed response; defer full explanations and raw snapshots.

Do not implement this by adding a blind `.limit(50)` to the existing full-data loader. Current totals and approval logic assume completeness. Move complete aggregate calculations to the server/read model and explicitly define whether a bulk action applies to visible, selected, filtered, or all eligible rows. Existing exact-fetch checks protect completeness; keep them on operations that genuinely require all records.

**4. Live source refresh is coupled to ordinary page reads — high priority**

[Live Vinosmith availability](/Users/markyaeger/Documents/WineBook/apps/web/src/lib/supabase/vinosmith-availability.ts:23) is requested by the ordering loader and has a 20-second per-request timeout. The source overlay then checks QuickBooks sync state, fetches current supporting records, and requests item sales windows. A slow inventory provider can therefore delay entry to multiple views that do not need live inventory to display their initial content. If the first availability attempt fails, the overlay can attempt it again because it receives no supplied availability result.

Recommendation: browse a versioned, last-verified snapshot with a clear freshness label, and refresh source data through a deduplicated background operation. Preserve the current rules governing whether stale/incomplete data may be shown or acted upon. PO creation, refresh, and export must retain their required source verification and transactional checks. Publishing an incomplete refresh as current would exchange a performance problem for an ordering integrity problem.

Daily sales windows also depend on the business reference date: cache invalidation cannot depend on source sync alone. A new business day can require new window results even without newly imported invoices.

**5. Realtime events can repeat the entire load — high priority**

[The ordering dashboard](/Users/markyaeger/Documents/WineBook/apps/web/src/components/order-dashboard.tsx:341) schedules `router.refresh()` when approval audit events arrive and for several PO-related events. Updates to recommendation rows already merge locally, but the corresponding audit insert can still cause a broad refresh. Purchase-order-line events are subscribed without a run filter. Debouncing and mutation-settle protection exist, but the eventual refresh still executes the broad loader.

Recommendation: retain direct row merges, patch or refetch the affected draft/summary/audit section, and invalidate only dependent data. Keep local dirty input, lock versions, idempotency, immutable revisions, and source freshness guards. Follow the existing [multi-buyer architecture](/Users/markyaeger/Documents/WineBook/docs/multi-buyer-ordering-architecture.md).

**6. Loading feedback exists, but does not form a consistent UX contract**

[The global fallback](/Users/markyaeger/Documents/WineBook/apps/web/src/app/loading.tsx:1) uses an animated `WineLoadingProgress` with accessible status text. Dashboard client requests also use it. It is styled as a small fixed panel in the upper right, rather than a page-shaped skeleton. Product Workspace's direct-entry loading branch shows static text; its separate preview branch has a spinner. Rep/account breakdown loading uses a text badge. GRW conversion has stage/status copy but lacks a consistent animated progress treatment. Settings Data Health already has a useful nested Suspense example for one diagnostic section.

Proposed product requirement:

| Waiting state | Expected behavior |
| --- | --- |
| Immediately after a click | Acknowledge the action and prevent duplicate submission where appropriate. Keep navigation usable. |
| Approximately 300–500 ms | Show an inline spinner or skeleton for the affected content. |
| At 3 seconds | Every pending operation has unmistakable activity feedback and a plain-language description of the work. |
| Longer operations | Show a real stage, elapsed time, and a way to leave or stop waiting. Provide retry on failure. |
| Background refresh | Keep the last verified content visible with its timestamp and a refreshing label. |

Three seconds should be the maximum tolerance for ambiguous feedback, not the time to begin acknowledging the action. Show a percentage only when the backend has a real denominator. A looping bar is activity feedback, not measured completion.

Client cancellation is not necessarily backend cancellation. The dashboard aborts browser fetches, but the server data queries are not explicitly wired to the incoming request's abort signal. Label stop behavior accurately; implement cooperative cancellation or background job handling for genuinely expensive work.

**7. Other areas and existing strengths**

Data Health loads full product/source records for health calculations, then fetches QuickBooks items and Vinosmith wines again for readiness. It also waits for several exact counts. Cache diagnostics by source version and load detailed issue lists only when opened. Basic sync status should not wait for a whole-catalog comparison.

Most ordering view components are already dynamically imported. Supplier grids only mount when opened, and the AG Grid height is bounded. AG Grid supports row/column virtualization, which reduces rendered elements but does not reduce an upstream full-data fetch: [AG Grid virtualization documentation](https://www.ag-grid.com/javascript-data-grid/dom-virtualisation/). Product spreadsheet export is already dynamically imported. These are useful foundations to preserve.

Product Workspace has an in-memory data cache and request deduplication. Its HTTP response advertises private caching, but the browser fetch explicitly uses `cache: "no-store"`; the module cache has no age-based expiration check. The dashboard's period cache is component-local, and returning Home from ordering uses `window.location.assign`, which reloads the document. Define one clear freshness policy with source versions and targeted invalidation. Authorization should be checked before serving cached business data, and cached results must be scoped correctly.

Lead Intelligence already limits its main lead list to 100 and is a lower initial priority. GRW parsing/export does substantial work in Python and can legitimately take time; consistent feedback and eventual background job status are more relevant than changing its business logic. These module paths were reviewed in code, not benchmarked with user files.

**Recommended implementation sequence**

1. Establish timing spans and baseline authenticated production measurements, while shipping consistent loading indicators and a persistent, usable page shell. Record navigation-to-feedback, navigation-to-first-usable-content, API durations, response sizes, query counts, and browser long tasks.
2. Make Home sales-first with independent margin loading. Make Product Workspace return a compact database-paginated first page and on-demand details. These have the strongest measured evidence.
3. Split ordering reads by view, defer audit/PO detail, and replace broad realtime reloads with scoped updates. Validate with two buyers before rollout.
4. Extend the existing background calculation and rollup infrastructure for recent margins, product reconciliation, and ordering snapshots. Invalidate by actual dependencies and publish only completed versions. Tune specific SQL queries using query plans after identifying remaining bottlenecks.

Proposed acceptance targets: visible feedback within 500 ms; first usable content within 3 seconds at the 95th percentile under normal operating conditions; no blank or ambiguous wait beyond 3 seconds; page/filter transitions preserve useful content and local work; recent margins may finish later with accurate status. These are proposed goals, not achieved measurements.

Validate direct entry, Home-to-ordering navigation, revisits, filter changes, slow responses, failed APIs, concurrent buyers, and large datasets. Measure actual time to the first usable rows/KPIs separately from full report completion. Verify full-dataset totals, search, sort, bulk approvals, and exports after pagination. Keep the current multi-buyer and freshness regression suites as release gates.

The evidence supports changing the read architecture before making infrastructure upgrades the primary solution. Hosting capacity and database query plans remain unmeasured and may still matter. Adding arbitrary delays, more client memoization, unlimited parallel requests, or smaller visual tables alone would leave the demonstrated data work in place.
