# Multi-buyer ordering architecture

This document is required reading before changing Order Review approvals, PO
draft creation, PO draft status, PO line removal, exports, realtime updates, or
internal SKU notes. These workflows are shared by every authenticated buyer.
The database is the source of truth; browser state is only a working copy.

The multi-buyer controls protect shared state and audit history. They do not
define inventory, sales, vintage selection, target weeks, pricing, or suggested
order calculations. Do not change those business calculations as part of a
concurrency or collaboration change unless the business explicitly requests it.

## Non-negotiable invariants

1. Never write guarded approval or PO state directly from the browser or a new
   server route. Use the database functions described below.
2. Every approval write must include the source row's expected lock version.
   A stale write must fail instead of overwriting another buyer's work.
3. PO creation must be atomic for the complete submitted approval manifest and
   idempotent for retries. A retry must not create another draft or duplicate
   lines.
4. There may be only one active draft for a report run, normalized supplier,
   and order path. Database constraints are the final enforcement layer.
5. Every material action must retain its actor and timestamp. Do not replace an
   audit event with mutable "last edited" fields.
6. Draft revisions, approval commitments, export events, and collaboration
   notes are immutable business history.
7. Exports must be generated from an immutable draft revision and must not be
   released unless the export audit event is recorded successfully.
8. Internal SKU notes must never appear in supplier CSV or XLSX output.
9. Realtime events may refresh shared state, but they must not silently replace
   a buyer's unsaved input.
10. Reads that can exceed the Supabase 1,000-row response limit must use the
    repository's paginated exact-fetch pattern.

## Approval writes

Order Review writes approvals through `public.save_order_approvals(jsonb)` from
the server action in `apps/web/src/app/actions.ts`.

- Each update carries the row identity and expected `lock_version`.
- The database locks and validates the complete batch before changing any row.
- A stale row rejects the batch with conflict details; the client keeps the
  buyer's unsaved value visible and shows who made the conflicting change.
- Successful changes append immutable rows to `approval_events` with actor and
  time.
- Direct guarded-table updates are rejected by database triggers.

Do not reintroduce a direct Supabase `.update()` path for approval state. It
would bypass optimistic concurrency, atomic batches, and the audit trail.

## PO draft creation and revisioning

`apps/web/src/app/api/po-drafts/create/route.ts` prepares the current approval
manifest and calls `public.create_purchase_order_drafts_atomic(...)`.

The RPC:

- requires an idempotency key and request hash;
- takes a report-run advisory transaction lock;
- validates all submitted source versions before writing;
- creates or revises every affected supplier/order-path draft in one
  transaction;
- records an immutable snapshot in `purchase_order_draft_revisions`; and
- relies on unique indexes to prevent duplicate active drafts and source lines.

The server may load current QuickBooks or Vinosmith facts before the RPC, but
the final validation and state transition belong in PostgreSQL. Do not split
the draft mutation into per-supplier browser requests or per-line inserts.

Removing a line uses `public.delete_purchase_order_line_revisioned(uuid)` so
the visible draft and its immutable revision advance together. Status changes
use `public.set_purchase_order_draft_status(uuid, text)`. Marking a draft as
entered records immutable approval commitments tied to the exact source lock
versions used by that draft.

These controls must not alter the recommendation formula or pricing logic.
They preserve the quantities the ordering workflow produced and prevent a
concurrent action or retry from applying the same business decision twice.

## Export integrity

`apps/web/src/app/api/po-drafts/export/route.ts` exports the current immutable
draft revision, not an unversioned reconstruction of mutable lines.

For every attempted export, retain:

- actor and timestamp;
- scope and format;
- exact draft revisions;
- exact source identities and lock versions;
- success or failure; and
- SHA-256 content hash for a successful artifact.

If file generation or audit insertion fails, do not release a file. CSV and
XLSX tests must also prove that internal collaboration notes cannot leak into
supplier output.

## Realtime behavior

`apps/web/src/components/order-dashboard.tsx` subscribes to the shared report
run's approval rows, catalog workbench items, PO drafts, PO lines, export
events, and PO line notes.

Realtime is a visibility layer, not the concurrency authority. The database
lock version and transactional functions decide whether a write is valid.
When changing realtime handlers:

- preserve locally dirty form input;
- merge or refresh server-confirmed state only;
- deduplicate inserted events by primary key; and
- keep draft refreshes scoped to the active report run.

## Internal SKU collaboration notes

PO Drafts show an `Internal Notes` action for each line. Notes are stored in
`purchase_order_line_notes` and added only through
`public.add_purchase_order_line_note(uuid, text)`.

- Notes are append-only, attributed, and timestamped.
- Buyers and admins can add notes to active drafts.
- Completed drafts retain notes as read-only history.
- A stable source-derived `line_key` keeps the thread attached to the same SKU
  when draft revisioning recreates the physical PO line row.
- Notes are deliberately outside draft/export snapshots and are excluded from
  all supplier files.

Keep the TypeScript key logic in `apps/web/src/lib/po-utils.ts` aligned with the
SQL function. Changing one without the other can orphan a visible note thread.

## Security boundary

Authenticated users receive read access needed for shared visibility. Guarded
writes run through reviewed `security definer` functions that verify
`auth.uid()` and the buyer/admin role. RLS remains enabled on business-history
tables.

Before changing a function, review all of the following together:

- function ownership and `search_path`;
- grants to `authenticated`, `service_role`, and `public`;
- caller role validation;
- RLS policies;
- advisory-lock scope;
- immutable-table triggers; and
- whether the function exposes or accepts an unvalidated row identity.

Never grant broad direct write access merely to make a UI mutation work.

## Important files

- `supabase/migrations/20260922233000_multi_buyer_po_integrity.sql` — approval
  concurrency, atomic drafts, revisions, commitments, export events, guards,
  indexes, and realtime publication.
- `supabase/migrations/20260923134500_approval_commitment_cycles.sql` — exact
  commitment-cycle semantics.
- `supabase/migrations/20260924100000_po_draft_line_collaboration_notes.sql` —
  append-only internal SKU notes.
- `apps/web/src/app/actions.ts` — authenticated mutations.
- `apps/web/src/app/api/po-drafts/create/route.ts` — manifest preparation and
  atomic draft RPC call.
- `apps/web/src/app/api/po-drafts/export/route.ts` — immutable audited exports.
- `apps/web/src/components/order-dashboard.tsx` — client autosave, conflicts,
  realtime subscriptions, and shared refresh behavior.
- `apps/web/src/components/po-drafts-view.tsx` — PO draft review, exports,
  cancellation, and SKU note threads.
- `apps/web/src/lib/multi-buyer-safety.test.ts` — static safety contract.
- `supabase/tests/multi_buyer_safety.sql` — database integration checks.

## Required validation

For any change touching the shared ordering workflow:

1. Run the web typecheck, full test suite, and production build.
2. Run the database safety tests when a migration or RPC changes.
3. Follow `docs/multi-buyer-concurrency-test.md` with two different buyer
   accounts in separate browser profiles for material concurrency changes.
4. Confirm supplier CSV/XLSX exports contain no internal note text.
5. Confirm actor names and timestamps remain correct in both Order Summary and
   PO Drafts.
6. Confirm a stale browser cannot overwrite a newer approval.
7. Confirm simultaneous PO creation produces one active draft with one copy of
   each source line.

The original production rollout constraints and rollback rules are recorded in
`docs/multi-buyer-safety-deployment.md`. Treat that file as release history and
recovery guidance; use an expand/migrate/contract rollout for future schema
changes whenever old and new web builds must coexist during deployment.
