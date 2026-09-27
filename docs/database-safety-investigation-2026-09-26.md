# Database safety failure investigation — September 26, 2026

Both previously reported local failures are resolved in the working tree. One was an outdated test; one was an actual deletion bug. No production or staging database was changed. No approval quantity, pricing, inventory or recommendation calculation was changed.

## PO approval failure: obsolete cross-cycle expectation

The old SQL test expected approving 18 after entering 12 to create a 6-bottle delta. The current rule is different: an edited approval advances its lock version and starts a new ordering cycle, so the new draft contains 18. The original entered draft and its commitment remain immutable.

This is established by three existing sources, not a new business decision:

- `supabase/migrations/20260923134500_approval_commitment_cycles.sql` explicitly scopes commitments to the exact approval lock version and says edits start a fresh cycle.
- `apps/web/src/lib/order-data.ts` and its existing `order-data.test.ts` implement and assert that same behavior, including a full 18-bottle new decision after 12 was committed on an older version.
- `docs/multi-buyer-safety-deployment.md` documents the exact-version rule.

The original creation migration also already contains exact-version matching. The SQL integration test and two-browser instructions had retained obsolete cross-cycle delta expectations. Changing the RPC to make that assertion pass would have changed established ordering behavior.

Updated `supabase/tests/multi_buyer_safety.sql` and `docs/multi-buyer-concurrency-test.md` to match the current rule. The test now also verifies that:

1. A new request key cannot redraft the same entered approval version.
2. An edited 18-bottle approval drafts the full 18.
3. Reducing that fresh decision to 6 drafts 6, not a negative correction.
4. Clearing cancels the active draft; reapproval starts another full-quantity cycle.
5. Entered revision and commitment records remain byte-for-byte unchanged, and the entered draft remains entered.

Existing stale-write, atomic-batch, idempotency, group-removal and unauthorized-caller checks remain. The corrected and expanded suite passes against the original 65 migrations without any business-function change.

## Pending-product deletion: leftover cascading audit foreign key

The pricing audit table originally referenced its parent wine with `ON DELETE CASCADE`. Migration `20260925053000_atomic_pending_catalog_deletion.sql` intended to remove this relationship so immutable audit records would survive deletion, but guessed the constraint name incorrectly.

The migration requested:

` supplier_catalog_price_level_audit_supplier_catalog_wine_id_fkey `

PostgreSQL truncated that literal to:

` supplier_catalog_price_level_audit_supplier_catalog_wine_id_fke `

The automatically generated constraint actually used:

` supplier_catalog_price_level_audi_supplier_catalog_wine_id_fkey `

`DROP CONSTRAINT IF EXISTS` therefore issued a notice and did nothing. Deleting the wine cascaded into its price levels; their audit trigger tried to record deletion against the already removed parent and failed the foreign key. The leftover cascading relationship also contradicted the intended history-retention policy.

Added forward migration `20260926200000_preserve_deleted_catalog_price_audit.sql`. It discovers only the audit wine-ID → catalog wine-ID foreign key through `pg_constraint` and removes it by its actual quoted name. It does not guess a truncation, delete audit records, change an RPC, grant direct writes, or remove the live price-level relationship. Historical audit rows retain the original wine UUID and snapshots after the wine is gone.

Expanded `supabase/tests/add_wine_pricing_integrity.sql` to verify stale deletion rejection, unchanged existing audit rows, exactly one deletion event per removed price level with actor/time/before snapshot, idempotent retries, no direct buyer DELETE grant, and retention of the live price-level foreign key.

## Verification

The disposable local PostgreSQL harness now checks three schema configurations using the corrected/expanded tests:

| Schema | Migrations | Multi-buyer safety | Catalog pricing/deletion | Performance SQL suites |
| --- | ---: | --- | --- | --- |
| Original baseline | 65 | Pass | Fails on original audit FK, as expected | Not applicable |
| Baseline plus standalone audit repair | 66 | Pass | Pass | Not applicable |
| Full working tree | 70 | Pass | Pass | Both pass |

The standalone repair is also applied a second time successfully to verify safe reapplication. This isolates the deletion repair from the four performance migrations. The initial investigation reproduced both failures with the original tests before any changes; correcting the cycle test alone resolves the PO failure even on the original schema.

Run `python3 scripts/test-performance-local-db.py` to reproduce. It creates a temporary local cluster, uses explicit auth/scheduler stand-ins, and tears the cluster down. Logs and results go to ignored `tmp/performance/database/`. Baseline deletion failure is expected; repaired/current failures cause a nonzero exit. This is actual PostgreSQL SQL testing, not a mock of the business functions, but it does not exercise hosted Supabase Auth, PostgREST or Realtime.

Web verification: 229 tests across 38 files pass; typecheck and optimized production build pass. Existing supplier CSV/XLSX export and internal-note exclusion tests remain passing. No web runtime code changed in this investigation.

## Release impact

The audit repair can be reviewed and deployed independently of the performance package after its original catalog migrations. It is a forward repair; leave the old migration intact. Coordinate normal DDL deployment because `ALTER TABLE` acquires a table lock. Old and new web builds use the same guarded deletion RPC.

Do not restore the cascading audit foreign key after successful deletions: retained history intentionally references deleted wine identities. Do not delete historical records to make such a rollback succeed. If a problem appears, disable pending-product deletion while preparing a forward repair.

There is no outstanding business-rule question from this investigation. Deployment remains pending staging identification, separate test data, real two-buyer browser verification and performance acceptance measurements. Passing local suites is not production sign-off.
