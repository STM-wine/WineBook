import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { poTemplateXlsxBuffer } from "./po-export";
import { loadPoExportPrices } from "./po-export-server";
import type { PurchaseOrderDraftWithLines } from "./types";
import { vinosmithPriceRole } from "./vinosmith-price-roles";

type Row = Record<string, unknown>;

function client(tables: Record<string, Row[]>) {
  return {
    from(table: string) {
      const query = {
        select: () => query,
        in: () => query,
        eq: () => query,
        or: () => query,
        then: (resolve: (result: { data: Row[]; error: null }) => unknown) =>
          Promise.resolve({ data: tables[table] || [], error: null }).then(resolve)
      };
      return query;
    }
  } as never;
}

function drafts(codes: string[], catalogId: string | null = null, isNewItem = false) {
  return [{
    supplier_name: "Test supplier",
    notes: "Order path: Stateside.",
    lines: codes.map((code, index) => ({
      id: `line-${index}`,
      product_code: code,
      product_name: code,
      producer_name: "Test producer",
      approved_qty: 12,
      fob: 8,
      supplier_catalog_wine_id: catalogId,
      is_new_item: isNewItem
    }))
  }] as unknown as PurchaseOrderDraftWithLines[];
}

function sourceRows(codes: string[], tiers: Array<Array<[string, number, boolean]>>) {
  return {
    vinosmith_wines: codes.map((code, index) => ({ wine_id: String(index), code })),
    vinosmith_prices: tiers.flatMap((levels, index) => levels.map(([label, price, is_default]) => ({
      wine_id: String(index), label, price_cents: Math.round(price * 100), is_default
    }))),
    quickbooks_items: codes.map((code) => ({ name: code, full_name: code, sales_price: 99 }))
  };
}

describe("PO export price selection", () => {
  it("uses named Frontline and Best for all six reported wines, regardless of the default tier", async () => {
    const codes = ["GRI000032", "GRI000038", "ILL000027", "ILL000030", "LAT000033", "LAT000034"];
    const expected = [[15, 14.25], [13, 11], [17.5, 16.5], [23, 21.5], [13, 11.5], [12.5, 11.75]];
    const tiers: Array<Array<[string, number, boolean]>> = [
      [["Frontline", 15, false], ["Best", 14.25, false], ["On 1-Case", 11.25, true]],
      [["Frontline", 13, false], ["Best", 11, true]],
      [["Frontline", 17.5, false], ["Best", 16.5, false], ["On 1-Case", 14.75, true]],
      [["Frontline", 23, false], ["Best", 21.5, false], ["On 1-Case", 19.5, true]],
      [["Frontline", 13, false], ["Best", 11.5, true]],
      [["Frontline", 12.5, false], ["Best", 11.75, true]]
    ];
    const purchaseOrders = drafts(codes);
    const prices = await loadPoExportPrices(client(sourceRows(codes, tiers)), purchaseOrders);
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await poTemplateXlsxBuffer(purchaseOrders, [], prices) as never);
    const sheet = workbook.worksheets[0];
    for (let index = 0; index < codes.length; index += 1) {
      expect(sheet.getCell(`D${index + 4}`).value).toBe(codes[index]);
      expect([sheet.getCell(`H${index + 4}`).value, sheet.getCell(`I${index + 4}`).value]).toEqual(expected[index]);
    }
  });

  it("uses QuickBooks Frontline fallback when Vinosmith has only another default tier", async () => {
    const tables = sourceRows(["ITEM1"], [[ ["Best", 14, true], ["On Frontline", 10, false] ]]);
    tables.quickbooks_items[0].sales_price = 15;
    expect(await loadPoExportPrices(client(tables), drafts(["ITEM1"]))).toEqual({
      "line-0": { frontline: 15, best: 14 }
    });
  });

  it("rejects conflicting active prices for a named tier, but accepts duplicate records at one price", async () => {
    const tiers: Array<Array<[string, number, boolean]>> = [[
      ["Frontline", 15, false], ["Frontline", 16, false], ["Best", 14, true]
    ]];
    const tables = sourceRows(["ITEM1"], tiers);
    await expect(loadPoExportPrices(client(tables), drafts(["ITEM1"]))).rejects.toThrow(/ITEM1: conflicting active Vinosmith frontline prices/);
    tables.vinosmith_prices[1].price_cents = 1500;
    expect(await loadPoExportPrices(client(tables), drafts(["ITEM1"]))).toEqual({
      "line-0": { frontline: 15, best: 14 }
    });
  });

  it("does not inspect conflicting Vinosmith tiers when a new item's catalog prices are authoritative", async () => {
    const tables = sourceRows(["NEW1"], [[ ["Frontline", 12, false], ["Frontline", 13, false] ]]);
    const prices = await loadPoExportPrices(client({
      ...tables,
      supplier_catalog_wines: [{ id: "catalog-1", frontline_bottle_price: 20, best_price: 18 }]
    }), drafts(["NEW1"], "catalog-1", true));
    expect(prices).toEqual({ "line-0": { frontline: 20, best: 18 } });
  });

  it("rejects a Best price above Frontline", async () => {
    const tables = sourceRows(["ITEM1"], [[ ["Frontline", 15, false], ["Best", 16, true] ]]);
    await expect(loadPoExportPrices(client(tables), drafts(["ITEM1"]))).rejects.toThrow(/ITEM1: Best price exceeds Frontline/);
  });
});

it.each([
  ["Frontline", "frontline"], [" frontline ", "frontline"], ["BEST", "best"],
  ["On 1-Case", null], ["On Frontline", null], ["Off Frontline", null], ["Bestest", null]
] as const)("classifies Vinosmith tier %s as %s", (label, role) => {
  expect(vinosmithPriceRole(label)).toBe(role);
});
