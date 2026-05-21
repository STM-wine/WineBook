import { asNumber } from "./order-data";
import type { PurchaseOrderDraftWithLines, PurchaseOrderLine } from "./types";

export type PoExportLine = {
  supplier: string;
  wine: string;
  code: string;
  quantity: number;
  fob: number;
  laidInPerBottle: number;
  totalWineCost: number;
  totalLaidInCost: number;
  estimatedCost: number;
};

export function poLineCosts(line: PurchaseOrderLine) {
  const qty = asNumber(line.approved_qty);
  const fob = asNumber(line.fob);
  const laidIn = asNumber(line.trucking_cost_per_bottle);
  const wineCost = asNumber(line.wine_cost || line.line_cost) || fob * qty;
  const laidInCost = asNumber(line.laid_in_cost) || laidIn * qty;
  const estimatedCost = asNumber(line.landed_cost) || wineCost + laidInCost;

  return { qty, fob, laidIn, wineCost, laidInCost, estimatedCost };
}

export function poExportLines(drafts: PurchaseOrderDraftWithLines[]): PoExportLine[] {
  return drafts
    .flatMap((draft) =>
      (draft.lines || []).map((line) => {
        const { qty, fob, laidIn, wineCost, laidInCost, estimatedCost } = poLineCosts(line);

        return {
          supplier: draft.supplier_name || "Unknown Supplier",
          wine: line.product_name || "",
          code: line.product_code || "",
          quantity: qty,
          fob,
          laidInPerBottle: laidIn,
          totalWineCost: wineCost,
          totalLaidInCost: laidInCost,
          estimatedCost
        };
      })
    )
    .sort(
      (a, b) =>
        a.supplier.localeCompare(b.supplier, undefined, { sensitivity: "base" }) ||
        a.wine.localeCompare(b.wine, undefined, { sensitivity: "base" })
    );
}

export function poTimestamp(date = new Date()) {
  const yyyy = date.getFullYear();
  const mm = String(date.getMonth() + 1).padStart(2, "0");
  const dd = String(date.getDate()).padStart(2, "0");
  const hh = String(date.getHours()).padStart(2, "0");
  const min = String(date.getMinutes()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd} ${hh}${min}`;
}
