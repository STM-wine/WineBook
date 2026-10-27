import { describe, expect, it } from "vitest";
import { groupByPickup, pickupLocationLabel } from "./pickup-grouping";

describe("pickup grouping", () => {
  it("combines New York and New Jersey pickup aliases", () => {
    for (const value of ["NY", "NJ", "New York", "New Jersey", "NY/NJ", " ny / nj "]) {
      expect(pickupLocationLabel(value)).toBe("NY/NJ");
    }
  });
  it("keeps supplier order inside each region, with unknown and missing locations retained", () => {
    const items = ["NJ", "WA", "CA", "Oregon", "California", null, "Other", "NY"];
    expect(groupByPickup(items, value => value)).toEqual(["CA", "California", "Oregon", "WA", "NJ", "NY", "Other", null]);
    expect(items[0]).toBe("NJ");
  });
});
