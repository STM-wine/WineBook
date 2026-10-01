# Add Wine pricing and identity

This document records the current Add Wine behavior, including the October 1, 2026 Frontline/Best price bands. It is deliberately limited to Add Wine. Inventory, sales, target weeks, vintage selection, replenishment policy, recommendation quantities, and PO calculations are unchanged.

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

## Current Add Wine pricing rules as of October 1, 2026

Supplier, FOB and pack size enable automatic pricing once the supplier's laid-in freight per bottle is known. A missing freight amount is not a confirmed zero; an explicitly entered zero is valid.

1. Pack must be a positive integer. FOB must be positive. Buyer selects bottle or case as the authoritative FOB basis.
2. Bottle FOB = case FOB / pack; case FOB = bottle FOB * pack. Derive only the non-source field and store currency to cents.
3. Landed bottle cost = bottle FOB + laid-in freight per bottle.
4. Raw Frontline = landed bottle cost / 0.68 (32% GP, not a 32% markup).
5. Round raw Frontline upward: below $20 to the next $0.25; $20 or higher to the next whole dollar.
6. Derive Best from the resulting Frontline bottle price:
   - Below $30: Frontline minus $1.
   - $30 to less than $50: Frontline minus $2.
   - $50 and above: Frontline-only; Best is absent and any existing Best level is inactive on save.
7. Do not round Best again or independently solve it for 30% GP. The former 30% Best target and collision-adjustment formula are superseded.
8. Buyer may explicitly choose Frontline-only below $50. A Frontline of $50 or more enforces it automatically for standard pricing.
9. Automatic prices update with costs. Manual values below the cutoff remain buyer overrides until reset; an automatic Best follows the effective Frontline, including a manual Frontline. At $50+, even an existing manual Best is inactive. Frontline must exceed an active Best.
10. Base suggestions exclude DA. Actual GP = (price - landed cost) / price. Price-level DA can separately reduce effective cost for displayed GP; it does not change the base suggestion.
11. The fixed spread can yield less than 30%, or even 28%, GP. There is no separate 30% Best warning. Prices below 28% still require Approve price, a reason and an authorized owner/approver before saving.
12. Standard pricing rules do not impose this ladder on GRW Broker pricing. No existing catalog records are bulk repriced by this release; rules apply in the Add Wine preview and save workflow.

All prices are per bottle. If Frontline is $1 or less, no positive Best is generated; do not create a zero or negative selling price.

| Landed bottle cost | Frontline | Best | Best GP |
| ---: | ---: | ---: | ---: |
| $10.30 | $15.25 | $14.25 | 27.72% (approval required) |
| $22.00 | $33.00 | $31.00 | 29.03% |
| $33.33 | $50.00 | None | Frontline-only |

Band examples: $29 Frontline -> $28 Best; $30 -> $28; $49 -> $47; $50 -> no Best. The band is based on Frontline, not on FOB or landed cost. Browser preview and server save use the same helper and persist consistent header prices and price-level activity.

## Save, concurrency, and history

The browser preview and server payload both use the shared pricing function. The database save wrapper takes a per-submit idempotency key and request hash, obtains transaction advisory locks, verifies the catalog `lock_version`, calls the established catalog/workbench save function, persists pricing metadata and manual-override state, creates any price-change event, records immutable catalog history, and stores the replay response in one transaction.

Concurrent edits with a stale version are rejected with an instruction to refresh. Repeating the same idempotency key and payload returns the original response; reusing a key for a different payload is rejected. Existing price-level audit triggers remain active. RLS still limits writes to buyers and admins, and the same table mutations continue to drive realtime updates.

The migration revokes the previous non-versioned save RPC so an older Add Wine build fails closed instead of bypassing the new protections. Deploy the migration and compatible web build in a controlled write-maintenance window, then run the database and two-browser concurrency checks before reopening writes.

## PO draft effects

Add Wine still creates or reactivates the existing supplier-catalog workbench row for the latest report run. It does not change recommended quantity, approved quantity, order path, or an existing positive recommendation. PO draft creation now paginates the complete supplier catalog before performing the existing merge. No ordering formula or recommendation calculation changed.
