# Multi-buyer ordering safety deployment

## Release classification

This is **not a zero-downtime backward-compatible release**. The database
migration intentionally rejects approval and PO writes from the previous web
build. If the migration is applied while the previous build is still serving
buyers, ordering writes will fail until the new build is live.

Use a controlled write-maintenance window for the first release. Do not claim
an expand/migrate/contract rollout unless a separate compatibility release is
built and reviewed that allows both old and new version-aware write paths to
coexist temporarily.

## Required release gates

Production deployment is blocked until an independent reviewer signs off on:

1. Migration safety, backfills, and duplicate active-draft consolidation.
2. Transaction locking, complete-manifest validation, and idempotency behavior.
3. RLS policies, grants, and every security-definer function boundary.
4. Immutable export snapshots, artifact generation, and SHA-256 recording.
5. Rollback/forward-recovery feasibility once commitments or exports exist.
6. The staging two-browser procedure in `multi-buyer-concurrency-test.md`.

## Migration order

1. Deploy the release candidate and migration to staging.
2. Complete the independent review gates and the two-browser staging test.
3. Announce a production ordering-write maintenance window and stop buyer writes.
4. Confirm no approval save, PO creation, status change, or export request is in flight.
5. Back up `reorder_recommendations`, `supplier_catalog_workbench_items`, `purchase_order_drafts`, and `purchase_order_lines`.
6. Apply `20260922233000_multi_buyer_po_integrity.sql`.
7. Verify the duplicate-draft cleanup using cancelled drafts whose notes contain `duplicate-active-draft migration` and run the operational checks below.
8. Deploy the new web build before reopening ordering writes.
9. Run a focused production smoke test with one buyer, then reopen ordering writes.

The previous build remains read-compatible after migration, but its direct
approval and PO writes fail closed. The obsolete GET XLSX endpoint also fails
closed. This protects integrity, but it is the reason a write-maintenance
window is required.

## Transaction boundaries

- A batch of approval updates is one `save_order_approvals` transaction. Every source row is locked and checked before any approval changes or approval events are written.
- Live QuickBooks/Vinosmith data is prepared by the server outside PostgreSQL. `create_purchase_order_drafts_atomic` then locks the report run, validates the complete approval manifest, and creates or revises every draft and line in one transaction.
- Marking a draft `entered_in_quickbooks` and recording its immutable approval commitments is one transaction. A commitment applies only to that exact approval lock version, so clearing or editing the approval starts a fresh order cycle without generating a negative correction.
- Removing a draft line creates a new immutable draft revision in the same transaction.
- File generation occurs from an immutable revision. A successful artifact is released only after its export event is inserted.

## Rollback

Do not roll back by deleting the history tables after buyers have used the new workflow. They may contain business records that do not exist anywhere else.

Safe application rollback:

1. Leave the migration applied.
2. Redeploy the previous web build only for read access; approval writes and the obsolete export endpoint intentionally fail closed.
3. Fix or redeploy the new build.

Before the first successful production write only, a database rollback may
restore the pre-migration backup and previous build. Once approval events,
revisions, commitments, or export events exist, destructive rollback is not a
safe option; keep the history and use a reviewed forward-recovery migration.

## Operational checks

- There is at most one `draft`/`ready_for_entry` row for each report-run, normalized supplier, and order path.
- No draft has duplicate non-null `recommendation_id` or `supplier_catalog_wine_id` lines.
- Every current draft revision has a matching row in `purchase_order_draft_revisions`.
- Every successful file response has a `purchase_order_export_events` row and SHA-256 content hash.
- Direct updates to approval status or quantity outside `save_order_approvals` fail.
