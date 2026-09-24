# Add Wine pricing and identity

This document records the Add Wine behavior found before the September 24, 2026 correction and the behavior implemented by that correction. It is deliberately limited to Add Wine. Inventory, sales, target weeks, vintage selection, replenishment policy, recommendation quantities, and PO calculations are unchanged.

## Authoritative identity by stage

| Stage | Authoritative identity | Notes |
| --- | --- | --- |
| Search result | Source system plus immutable source ID | QuickBooks uses `list_id`; Vinosmith uses `wine_id`; Supplier Catalog uses its UUID; product rows use product UUID; recommendation rows use recommendation UUID. A normalized name is not used to collapse distinct active and inactive records. |
| Add Wine draft | Producer, Item Name, vintage, pack, and bottle size | Producer is first because it is the first component of the full item name. The normalized display name and planning SKU are previews until save. |
| Saved supplier SKU | `supplier_catalog_wines.id` | `planning_sku` remains unique and is the collision check. Edits use the stable catalog UUID and an expected `lock_version`. |
| Official accounting item | QuickBooks `list_id` / item number | An inactive QuickBooks item may be used as a template, but it is not automatically linked as an active official item. |
| Order workbench and PO draft | Supplier catalog UUID, with planning SKU as the order identity | The existing workbench merge, recommendation data, quantities, approvals, and PO source snapshots are unchanged. |

Supplier assignment uses the canonical supplier record when one exists. QuickBooks importer metadata is matched to that supplier record. Selecting any known supplier populates its current trucking/laid-in amount per bottle; an unknown supplier leaves laid-in blank so pricing cannot be suggested from a fabricated zero.

Search queries active Supplier Catalog, product, Vinosmith, and QuickBooks records first. “Search inactive items too” repeats the same query with inactive records included. Filtering happens in the database before exact pagination, and the result list retains distinct records even when they normalize to the same planning SKU, so an inactive item remains selectable beside an active item without slowing every initial search. “Start From” copies the identity and current source context; only an active QuickBooks result can be linked automatically.

## Previous pricing behavior

The TypeScript Add Wine path used one shared builder for the browser preview and initial saved values, but pricing metadata and price-change history were written after the catalog transaction. The Python/Streamlit path had a separate implementation of the same general rules.

Before this change:

- Bottle FOB from case FOB was `case FOB / pack`, and case FOB from bottle FOB was `bottle FOB * pack`. Values were stored to cents. The selected pricing basis prevented the two fields from continually recalculating each other, but some UI conversion paths fell back to a 12-pack when pack was invalid.
- Landed bottle cost was `FOB bottle + laid-in per bottle`.
- Frontline targeted 32% GP: `landed / 0.68`. Below $20 it rounded upward to $0.25; at or above $20 it rounded upward to a whole dollar.
- Best was not independently targeted. It was Frontline minus $1 below $20, Frontline minus $2 from $20 through $49.99, and it was suppressed when Frontline reached $50.
- A Best DA could affect the displayed Best GP/conflict check, although DA did not determine the base Frontline recommendation.
- Existing/manual values could be raised or replaced as costs changed; the system suggestion and final user value were not reliably distinct.
- Incomplete cost input was normalized through zero, so a calculation object existed even when the buyer had not provided every required input.
- The on-screen preview and the initial server payload used the same TypeScript builder. The save then performed separate metadata and price-change writes, which could leave those records out of sync if a later write failed.

For the requested examples, the previous rules produced:

| Landed cost | Previous Best | Previous Frontline | Correct Best | Correct Frontline |
| ---: | ---: | ---: | ---: | ---: |
| $10.30 | $14.25 | $15.25 | $14.75 | $15.25 |
| $22.00 | $31.00 | $33.00 | $32.00 | $33.00 |

## Corrected shared pricing rules

The TypeScript and Python implementations now use these rules:

1. A positive whole-number pack is required. The user chooses bottle or case as the source basis.
2. `FOB bottle = FOB case / pack` and `FOB case = FOB bottle * pack`. Only the non-source field is derived.
3. `landed bottle cost = FOB bottle + laid-in per bottle`.
4. Suggestions remain unavailable until a positive FOB on the selected basis, a valid pack, and an explicitly supplied laid-in value are present. An explicit laid-in value of $0 is valid.
5. Raw Best is `landed / 0.70`. Raw Frontline is `landed / 0.68`.
6. A raw price below $20 rounds upward to the next $0.25. A raw price at or above $20 rounds upward to the next whole dollar. Neither calculation rounds below its target GP.
7. Best and Frontline are calculated independently. If their rounded values collide, Frontline is raised to Best + $0.25 when both are below $20, or Best + $1 when either is $20 or more.
8. Best is calculated at every price unless the buyer explicitly selects Frontline-only.
9. No depletion allowance is included in automatic Best or Frontline suggestions. Price-level DA remains visible and its effective GP is shown for reference.
10. Suggested and final price are stored separately. Frontline and Best follow suggestions until manually edited. A manual value is preserved exactly; an invalid manual ladder is shown and cannot be saved. “Reset to suggested” clears the override.
11. Displayed GP is `(selling price - landed bottle cost) / selling price`. Source price levels also show price, DA, effective GP, and source update date.

At $10.30 landed, Best is $14.75 (30.17% GP) and Frontline is $15.25 (32.46% GP). At $22 landed, Best is $32 (31.25% GP) and Frontline is $33 (33.33% GP).

## Save, concurrency, and history

The browser preview and server payload both use the shared pricing function. The database save wrapper takes a per-submit idempotency key and request hash, obtains transaction advisory locks, verifies the catalog `lock_version`, calls the established catalog/workbench save function, persists pricing metadata and manual-override state, creates any price-change event, records immutable catalog history, and stores the replay response in one transaction.

Concurrent edits with a stale version are rejected with an instruction to refresh. Repeating the same idempotency key and payload returns the original response; reusing a key for a different payload is rejected. Existing price-level audit triggers remain active. RLS still limits writes to buyers and admins, and the same table mutations continue to drive realtime updates.

The migration revokes the previous non-versioned save RPC so an older Add Wine build fails closed instead of bypassing the new protections. Deploy the migration and compatible web build in a controlled write-maintenance window, then run the database and two-browser concurrency checks before reopening writes.

## PO draft effects

Add Wine still creates or reactivates the existing supplier-catalog workbench row for the latest report run. It does not change recommended quantity, approved quantity, order path, or an existing positive recommendation. PO draft creation now paginates the complete supplier catalog before performing the existing merge. No ordering formula or recommendation calculation changed.
