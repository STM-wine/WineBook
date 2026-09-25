import { describe, expect, it } from "vitest";
import {
  dedupeProductIdentityCandidates,
  latestProductIdentityPriceLevels,
  mergeProductIdentityPriceLevels,
  quickbooksItemRowToCandidate,
  recommendationRowToCandidate,
  searchProductIdentityCandidates,
  vinosmithWineRowToCandidate
} from "./product-identity-search";

describe("product identity search", () => {
  it("returns inactive QuickBooks items as clearly labeled template matches", () => {
    const inactive = quickbooksItemRowToCandidate({
      list_id: "qb-inactive-1",
      full_name: "Domaine Vacheron Sancerre Blanc 2024 6/750ml",
      is_active: false,
      purchase_cost: 45.5,
      sales_price: 69
    });

    const matches = searchProductIdentityCandidates(
      { query: "Vacheron Sancerre Blanc", includeInactive: true, limit: 8 },
      [inactive]
    );

    expect(matches).toHaveLength(1);
    expect(matches[0]).toMatchObject({
      source: "quickbooks_item",
      sourceId: "qb-inactive-1",
      active: false,
      sourceLabel: "QuickBooks · Inactive"
    });
  });

  it("searches active items by default and includes inactive items only when requested", () => {
    const base = {
      full_name: "Illahe Pinot Noir 2024 12/750ml",
      purchase_cost: 18,
      sales_price: 30
    };
    const active = quickbooksItemRowToCandidate({ ...base, list_id: "illahe-active", is_active: true });
    const inactive = quickbooksItemRowToCandidate({ ...base, list_id: "illahe-inactive", is_active: false });

    expect(searchProductIdentityCandidates({ query: "Illahe", limit: 20 }, [active, inactive]).map((match) => match.sourceId))
      .toEqual(["illahe-active"]);
    expect(searchProductIdentityCandidates({ query: "Illahe", includeInactive: true, limit: 20 }, [active, inactive]).map((match) => match.sourceId))
      .toEqual(["illahe-active", "illahe-inactive"]);
  });

  it("keeps active and inactive source records even when their normalized SKU is identical", () => {
    const base = {
      full_name: "Domaine Vacheron Sancerre Blanc 2024 6/750ml",
      purchase_cost: 45.5,
      sales_price: 69
    };
    const active = quickbooksItemRowToCandidate({ ...base, list_id: "qb-active", is_active: true });
    const inactive = quickbooksItemRowToCandidate({ ...base, list_id: "qb-inactive", is_active: false });

    const matches = searchProductIdentityCandidates(
      { query: "Vacheron Sancerre", includeInactive: true, limit: 20 },
      dedupeProductIdentityCandidates([active, inactive])
    );

    expect(matches.map((match) => match.sourceId)).toEqual(["qb-active", "qb-inactive"]);
  });

  it("collapses historical recommendation snapshots by QuickBooks item code and keeps the newest", () => {
    const base = {
      planning_sku: "illahe viognier 2025 12/750ml",
      product_name: "Illahe Viognier 2025 12/750ml",
      product_code: "ILL000029",
      supplier_name: "Illahe",
      pack_size: 12,
      trucking_cost_per_bottle: 1
    };
    const older = recommendationRowToCandidate({
      ...base,
      id: "recommendation-older",
      fob: 13,
      created_at: "2026-09-23T00:00:00Z"
    });
    const newer = recommendationRowToCandidate({
      ...base,
      id: "recommendation-newer",
      fob: 14,
      created_at: "2026-09-24T00:00:00Z"
    });

    const deduped = dedupeProductIdentityCandidates([older, newer]);

    expect(deduped).toHaveLength(1);
    expect(deduped[0]).toMatchObject({
      sourceId: "recommendation-newer",
      quickbooksItemNumber: "ILL000029",
      fobBottle: 14
    });
  });

  it("uses the full planning SKU when a recommendation has no QuickBooks item code", () => {
    const common = {
      product_name: "Illahe Viognier 2025 12/750ml",
      supplier_name: "Illahe",
      pack_size: 12,
      fob: 14,
      created_at: "2026-09-24T00:00:00Z"
    };
    const sameSkuOlder = recommendationRowToCandidate({
      ...common,
      id: "same-sku-older",
      planning_sku: "illahe viognier 2025 12/750ml",
      created_at: "2026-09-23T00:00:00Z"
    });
    const sameSkuNewer = recommendationRowToCandidate({
      ...common,
      id: "same-sku-newer",
      planning_sku: "illahe viognier 2025 12/750ml"
    });
    const differentVintage = recommendationRowToCandidate({
      ...common,
      id: "different-vintage",
      planning_sku: "illahe viognier 2024 12/750ml",
      product_name: "Illahe Viognier 2024 12/750ml"
    });

    const deduped = dedupeProductIdentityCandidates([sameSkuOlder, differentVintage, sameSkuNewer]);

    expect(deduped.map((candidate) => candidate.sourceId)).toEqual(["same-sku-newer", "different-vintage"]);
  });

  it("keeps distinct recommendation item codes even when their display names match", () => {
    const base = {
      planning_sku: "illahe viognier 2025 12/750ml",
      product_name: "Illahe Viognier 2025 12/750ml",
      supplier_name: "Illahe",
      pack_size: 12,
      fob: 14,
      created_at: "2026-09-24T00:00:00Z"
    };
    const first = recommendationRowToCandidate({ ...base, id: "first", product_code: "ILL000029" });
    const second = recommendationRowToCandidate({ ...base, id: "second", product_code: "ILL999999" });

    expect(dedupeProductIdentityCandidates([first, second])).toHaveLength(2);
  });

  it("uses the most recent record for a repeated source price-level name", () => {
    const common = { name: "On Premise", depletionAllowance: 0, isFrontline: false, isBest: false, active: true, sourceSystem: "vinosmith" };
    const levels = latestProductIdentityPriceLevels([
      { ...common, id: "older", bottlePrice: 20, updatedAt: "2026-09-01T00:00:00Z" },
      { ...common, id: "newer", bottlePrice: 22, updatedAt: "2026-09-24T00:00:00Z" },
      { ...common, id: "best", name: "Best", bottlePrice: 21, isBest: true, updatedAt: "2026-09-23T00:00:00Z" }
    ]);

    expect(levels.map((level) => [level.id, level.bottlePrice])).toEqual([["newer", 22], ["best", 21]]);
  });

  it("merges Vinosmith named levels into a matching QuickBooks result", () => {
    const quickbooks = {
      ...quickbooksItemRowToCandidate({
        list_id: "80002094-1776113791",
        full_name: "Illahe Viognier 2025 12/750ml",
        is_active: true,
        purchase_cost: 10.25,
        sales_price: 18,
        custom_fields: { item_number: "ILL000029" }
      }),
      quickbooksItemNumber: "ILL000029",
      laidInPerBottle: 1
    };
    const vinosmith = {
      ...vinosmithWineRowToCandidate({
        wine_id: "804453",
        code: "ILL000029",
        name: "Illahe Viognier 2025 12/750ml",
        producer_name: "Illahe",
        vintage: "2025",
        unit_set: 12,
        active: true,
        orderable: true
      }),
      priceLevels: [
        { id: "vs-frontline", name: "Frontline", bottlePrice: 17.5, depletionAllowance: 0, isFrontline: true, isBest: false, active: true, sourceSystem: "vinosmith", updatedAt: "2026-09-24T00:00:00Z" },
        { id: "vs-best", name: "Best", bottlePrice: 16.5, depletionAllowance: 0, isFrontline: false, isBest: true, active: true, sourceSystem: "vinosmith", updatedAt: "2026-09-24T00:00:00Z" }
      ]
    };
    const [quickbooksMatch] = searchProductIdentityCandidates({ query: "Illahe Viognier", limit: 20 }, [quickbooks]);

    const [merged] = mergeProductIdentityPriceLevels([quickbooksMatch], [quickbooks, vinosmith]);

    expect(merged.priceLevels?.map((level) => [level.name, level.bottlePrice])).toEqual([
      ["Frontline", 17.5],
      ["Best", 16.5]
    ]);
    expect(merged.frontlineBottlePrice).toBe(17.5);
    expect(merged.bestPrice).toBe(16.5);
    expect(merged.grossProfitMargin).toBe(0.3571);
  });

  it("prefers saved catalog overrides while filling missing roles from Vinosmith", () => {
    const base = {
      ...quickbooksItemRowToCandidate({
        list_id: "qb-1",
        full_name: "Illahe Viognier 2025 12/750ml",
        is_active: true,
        purchase_cost: 10.25,
        sales_price: 18
      }),
      quickbooksItemNumber: "ILL000029"
    };
    const catalog = {
      ...base,
      source: "supplier_catalog" as const,
      sourceId: "catalog-1",
      priceLevels: [
        { id: "catalog-frontline", name: "Frontline", bottlePrice: 19, depletionAllowance: 0, isFrontline: true, isBest: false, active: true, sourceSystem: "manual", updatedAt: "2026-09-20T00:00:00Z" }
      ]
    };
    const vinosmith = {
      ...base,
      source: "vinosmith" as const,
      sourceId: "wine-1",
      priceLevels: [
        { id: "vs-frontline", name: "Frontline", bottlePrice: 17.5, depletionAllowance: 0, isFrontline: true, isBest: false, active: true, sourceSystem: "vinosmith", updatedAt: "2026-09-24T00:00:00Z" },
        { id: "vs-best", name: "Best", bottlePrice: 16.5, depletionAllowance: 0, isFrontline: false, isBest: true, active: true, sourceSystem: "vinosmith", updatedAt: "2026-09-24T00:00:00Z" }
      ]
    };
    const [match] = searchProductIdentityCandidates({ query: "Illahe Viognier", limit: 20 }, [base]);

    const [merged] = mergeProductIdentityPriceLevels([match], [base, catalog, vinosmith]);

    expect(merged.priceLevels?.map((level) => [level.id, level.bottlePrice])).toEqual([
      ["catalog-frontline", 19],
      ["vs-best", 16.5]
    ]);
  });
});
