import { describe, expect, it } from "vitest";
import { buildSupplierWineMatchPath, shouldIgnoreSupplierWineMatchResult } from "./add-wine-search";

describe("Add Wine match requests", () => {
  it("builds a same-origin encoded search path without browser URL parsing", () => {
    expect(buildSupplierWineMatchPath({
      query: " Mauro Molino ",
      supplierName: "Giuliana Imports & Co.",
      producer: "Mauro Molino",
      vintage: "2024",
      packSize: "12",
      bottleSize: "750ml",
      includeInactive: true
    })).toBe(
      "/api/supplier-wines/matches?q=Mauro+Molino&supplierName=Giuliana+Imports+%26+Co.&producer=Mauro+Molino&vintage=2024&packSize=12&bottleSize=750ml&includeInactive=true"
    );
  });

  it("ignores canceled and superseded search results", () => {
    expect(shouldIgnoreSupplierWineMatchResult({ aborted: true, requestId: 2, activeRequestId: 2 })).toBe(true);
    expect(shouldIgnoreSupplierWineMatchResult({ aborted: false, requestId: 1, activeRequestId: 2 })).toBe(true);
    expect(shouldIgnoreSupplierWineMatchResult({ aborted: false, requestId: 2, activeRequestId: 2 })).toBe(false);
  });
});
