import { describe, expect, it } from "vitest";
import { applyGrwItemNumberMatches, findGrwItemNumber } from "./grw-item-number-lookup";

const invoiceItem = {
  itemNumber: "NEW",
  description: "Dunn Howell Mountain 1999 1/750ml",
  wineName: "Dunn Howell Mountain",
  vintage: "1999",
  pack: 1,
  bottleSize: "750",
  fobBottle: 225.75,
  frontline: 248
};

describe("GRW item-number lookup", () => {
  it("matches only GRW QuickBooks items by description, vintage, and pack", () => {
    const result = findGrwItemNumber(invoiceItem, [
      {
        name: "GRW000110",
        sales_desc: "Dunn Howell Moutain 2005 1/750ml",
        purchase_desc: "Dunn Howell Moutain 2005 1/750ml",
        is_active: true
      },
      {
        name: "GRW000082",
        sales_desc: "Dunn Howell Moutain 1999 1/750ml",
        purchase_desc: "Dunn Howell Moutain 1999 1/750ml",
        is_active: true
      },
      {
        name: "WINE000082",
        sales_desc: "Dunn Howell Mountain 1999 1/750ml",
        is_active: true
      }
    ]);

    expect(result).toBe("GRW000082");
  });

  it("leaves the item NEW when the vintage or pack does not match", () => {
    const [result] = applyGrwItemNumberMatches([invoiceItem], [
      { name: "GRW000110", sales_desc: "Dunn Howell Mountain 2005 1/750ml", is_active: true },
      { name: "GRW000083", sales_desc: "Dunn Howell Mountain 1999 3/750ml", is_active: true }
    ]);

    expect(result.itemNumber).toBe("NEW");
  });

  it("uses the most recently modified active item when QuickBooks contains a duplicate name", () => {
    const result = findGrwItemNumber(invoiceItem, [
      {
        name: "GRW000082",
        sales_desc: "Dunn Howell Mountain 1999 1/750ml",
        is_active: true,
        time_modified: "2026-01-01T00:00:00Z"
      },
      {
        name: "GRW000999",
        sales_desc: "Dunn Howell Mountain 1999 1/750ml",
        is_active: true,
        time_modified: "2026-02-01T00:00:00Z"
      }
    ]);

    expect(result).toBe("GRW000999");
  });

  it("changes only the item number and leaves GRW pricing intact", () => {
    const [result] = applyGrwItemNumberMatches([invoiceItem], [
      { name: "GRW000082", sales_desc: "Dunn Howell Moutain 1999 1/750ml", is_active: true }
    ]);

    expect(result).toMatchObject({
      itemNumber: "GRW000082",
      fobBottle: 225.75,
      frontline: 248
    });
  });
});
