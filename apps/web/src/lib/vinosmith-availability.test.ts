import { describe, expect, it } from "vitest";
import { aggregateVinosmithAvailable } from "./vinosmith-availability-data";

describe("Vinosmith Get Available", () => {
  it("matches exact wine codes, sums warehouses, and preserves negative values", () => {
    const available = aggregateVinosmithAvailable([
      { wineCode: "abc000001", available: 12 },
      { wineCode: " ABC000001 ", available: 3 },
      { wineCode: "NEG000001", available: -6 },
      { wineCode: null, available: 99 }
    ]);

    expect(available.get("ABC000001")).toBe(15);
    expect(available.get("NEG000001")).toBe(-6);
    expect(available.size).toBe(2);
  });
});
