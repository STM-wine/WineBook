# Two-session concurrency test

Use two different buyer accounts in separate browser profiles. Do not use two tabs sharing the same login.

## Approval visibility and conflicts

1. Open the same supplier in sessions A and B.
2. In A, approve wine 1. Confirm B updates promptly without a page reload.
3. Disconnect B from the network, edit wine 1 in both sessions, and save A first.
4. Reconnect B and trigger its save.
5. Confirm B receives a conflict naming the current editor and time, B's unsaved quantity remains visible, and A's database value is unchanged.
6. Edit different wines in A and B within the same autosave interval. Confirm both batches succeed.
7. Force one invalid/stale row into a multi-row batch. Confirm no row in that batch changes.

## Draft concurrency and idempotency

1. Approve at least two wines for one supplier/order path.
2. Press Create PO Drafts in A and B at nearly the same time.
3. Confirm one active draft exists with one copy of each source line.
4. Retry the same request with the same idempotency key using an HTTP client. Confirm the result is identical and no rows are added.
5. Change an approval after draft creation and create drafts again. Confirm the draft revision increases and the previous revision remains unchanged.
6. Export that revision, change an approval, and rebuild. Confirm the export still references the older frozen revision.

## Export and business history

1. Export one draft as XLSX, selected drafts as CSV, and all drafts as XLSX.
2. Confirm each response downloads and each has a successful export event containing actor, scope, format, exact revisions, exact line/source versions, and SHA-256 hash.
3. Induce generation failure and confirm a failed event exists but no artifact is released.
4. Confirm approval rows and approval events remain unchanged after export.
5. Mark a draft entered in QuickBooks. Confirm commitments are recorded and recreating drafts does not reproduce the committed quantities.
6. Edit an entered approval from 12 to 18 and rebuild. Confirm its lock version advances and a fresh order cycle drafts 18 bottles. The entered 12-bottle draft and its commitments remain unchanged.
7. Decrease the new approval to 6 and rebuild. Confirm the active draft contains 6 bottles, not a negative correction against the entered cycle.
8. Clear the approval and rebuild. Confirm its active draft is cancelled without creating a negative correction. Reapprove and confirm the full new quantity is drafted. Rebuilding the same entered lock version must never redraft its committed quantity.

These expectations follow `20260923134500_approval_commitment_cycles.sql` and
the exact-version behavior in `applyApprovalCommitments`. Earlier cross-cycle
delta instructions were obsolete; editing an approval is a new order decision,
not an adjustment to an already entered PO.

## Realtime safety

1. Keep an unsaved quantity in A while B changes the same row.
2. Confirm the incoming realtime event does not overwrite A's input.
3. Confirm the next A save is rejected by the database version check.
4. Change a draft status or export from B and confirm A's PO Drafts view refreshes promptly.
