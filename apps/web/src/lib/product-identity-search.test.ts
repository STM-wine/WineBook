import { describe, expect, it } from "vitest";
import {
  dedupeProductIdentityCandidates,
  latestProductIdentityPriceLevels,
  quickbooksItemRowToCandidate,
  searchProductIdentityCandidates
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
      { query: "Vacheron Sancerre Blanc", limit: 8 },
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

  it("keeps active and inactive source records even when their normalized SKU is identical", () => {
    const base = {
      full_name: "Domaine Vacheron Sancerre Blanc 2024 6/750ml",
      purchase_cost: 45.5,
      sales_price: 69
    };
    const active = quickbooksItemRowToCandidate({ ...base, list_id: "qb-active", is_active: true });
    const inactive = quickbooksItemRowToCandidate({ ...base, list_id: "qb-inactive", is_active: false });

    const matches = searchProductIdentityCandidates(
      { query: "Vacheron Sancerre", limit: 20 },
      dedupeProductIdentityCandidates([active, inactive])
    );

    expect(matches.map((match) => match.sourceId)).toEqual(["qb-active", "qb-inactive"]);
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
});
