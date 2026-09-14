import { describe, expect, it } from "vitest";
import {
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
});
