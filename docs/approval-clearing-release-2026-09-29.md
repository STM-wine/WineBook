# Restore approval clearing — September 29, 2026

Order Summary now provides Clear approved orders on each supplier header and Clear all approved orders beside Create PO Drafts. Buyer/admin access is enforced on the page and by the existing authenticated server guard. Opening the confirmation reads saved approval identities and quantities only; it does not load supplier calculations.

Supplier clearing covers the entire supplier; global clearing covers the current ordering run regardless of search/TDM filters or unopened workbenches. Both recommendation and catalog-workbench approvals are included. Pending edits are saved before preview and confirmation. Changed scopes or versions require a new confirmation, and the existing atomic save_order_approvals transaction rejects conflicts without partial writes. Approval audit events remain intact. Existing PO drafts and entered order history are unchanged; users can run Create PO Drafts afterward to reconcile open drafts.

Success refreshes the overview and open supplier workbenches, including when the calculation snapshot ID has not changed. Cancel never submits the clear action.

Validation: 317 tests across 54 files, TypeScript check, production build, and diff whitespace check passed. Read-only production preview returned 92 saved approvals / 10,842 bottles across 17 suppliers; Los Milics returned 3 approvals / 588 bottles. These are saved quantities, including previously processed approvals, not the net outstanding metric displayed in the summary. No production approvals were cleared during validation.

Code: facae66 plus confirmation-count copy polish. Deployment uses the production web service's existing On Commit setting; the final application change has no skip marker. Live verification pending deployment completion.

Production verified at 23:31 UTC: the public page bundle contains both controls and the final singular/plural confirmation copy (`8aff3e6`), and the new shared stylesheet is served. In the authenticated browser, Los Milics preview showed 3 saved approvals / 588 bottles / 1 supplier without expanding its workbench; global preview showed 92 / 10,842 / 17. Both confirmations were cancelled, preserving production approvals. The dialog styling was visually checked. No database migration or worker change was required.
