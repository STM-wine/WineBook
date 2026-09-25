import { describe, expect, it } from "vitest";
import { poLineItemNumber } from "./po-utils";

describe("PO Draft item number display", () => {
  it("shows NEW for a line awaiting its QuickBooks item number", () => {
    expect(poLineItemNumber({ is_new_item: true, product_code: null })).toBe("NEW");
  });

  it("shows the authoritative QuickBooks item number for an existing line", () => {
    expect(poLineItemNumber({ is_new_item: false, product_code: "  NBI000390  " })).toBe("NBI000390");
  });
});
