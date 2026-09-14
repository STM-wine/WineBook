import { describe, expect, it } from "vitest";
import {
  quickBooksItemCode,
  quickBooksItemDisplayName,
  quickBooksPackFormat,
  quickBooksPreferredVendorListId,
  quickBooksProducer,
  quickBooksVintage
} from "./quickbooks-item-fields";

const item = {
  list_id: "qb-1",
  name: "NBI000384",
  full_name: "NBI000384",
  sales_desc: "Domaine Vacheron Sancerre Blanc 2025 6/750ml  ..",
  purchase_desc: null,
  custom_fields: {
    Producer: { value: "Domaine Vacheron" },
    Vintage: { value: "2025" },
    "Pack Size": { value: "6/750ml" }
  },
  raw_data: {
    preferred_vendor_ref: { ListID: "vendor-1", FullName: "North Berkeley Imports" }
  }
};

describe("QuickBooks item identity fields", () => {
  it("reads ordering identity and supplier fields from the QuickBooks mirror", () => {
    expect(quickBooksItemCode(item)).toBe("NBI000384");
    expect(quickBooksItemDisplayName(item)).toBe("Domaine Vacheron Sancerre Blanc 2025 6/750ml");
    expect(quickBooksProducer(item)).toBe("Domaine Vacheron");
    expect(quickBooksVintage(item)).toBe("2025");
    expect(quickBooksPreferredVendorListId(item)).toBe("vendor-1");
    expect(quickBooksPackFormat(item)).toEqual({ packSize: 6, bottleSize: "750ml", label: "6/750ml" });
  });

  it("infers liters when QuickBooks omits the unit", () => {
    expect(quickBooksPackFormat({ ...item, custom_fields: { "Pack Size": { value: "6/1.5" } } }))
      .toEqual({ packSize: 6, bottleSize: "1.5l", label: "6/1.5l" });
  });
});
