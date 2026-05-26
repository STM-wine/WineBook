import { asNumber } from "./order-data";
import type { OrderPath } from "./di-planning";
import type { PurchaseOrderDraftWithLines, PurchaseOrderLine, SupplierLogistics } from "./types";

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

function supplierKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

export function poOrderPathLabel(path: OrderPath) {
  return path === "di" ? "DI" : "Stateside";
}

export function poDraftOrderPath(draft: Pick<PurchaseOrderDraftWithLines, "notes">): OrderPath {
  return /order path:\s*(direct import|di)/i.test(draft.notes || "") ? "di" : "stateside";
}

export function poDraftSupplierLabel(draft: Pick<PurchaseOrderDraftWithLines, "supplier_name" | "notes">) {
  const supplier = draft.supplier_name || "Unknown Supplier";
  const path = poDraftOrderPath(draft);
  return path === "di" ? `${supplier} - DI` : supplier;
}

export function supplierLogisticsLookup(suppliers: SupplierLogistics[] = []) {
  return new Map(suppliers.map((supplier) => [supplierKey(supplier.name), supplier]));
}

export function supplierLaidInForDraft(
  draft: Pick<PurchaseOrderDraftWithLines, "supplier_name">,
  suppliers: Map<string, SupplierLogistics>
) {
  return asNumber(suppliers.get(supplierKey(draft.supplier_name))?.trucking_cost_per_bottle);
}

export function poLineCosts(line: PurchaseOrderLine, fallbackLaidInPerBottle = 0) {
  const qty = asNumber(line.approved_qty);
  const fob = asNumber(line.fob);
  const laidIn = asNumber(line.trucking_cost_per_bottle) || fallbackLaidInPerBottle;
  const wineCost = asNumber(line.wine_cost || line.line_cost) || fob * qty;
  const laidInCost = asNumber(line.laid_in_cost) || laidIn * qty;
  const estimatedCost = wineCost + laidInCost;

  return { qty, fob, laidIn, wineCost, laidInCost, estimatedCost };
}

export function poExportLines(drafts: PurchaseOrderDraftWithLines[], suppliers: SupplierLogistics[] = []): PoExportLine[] {
  const supplierLookup = supplierLogisticsLookup(suppliers);

  return drafts
    .flatMap((draft) => {
      const fallbackLaidIn = supplierLaidInForDraft(draft, supplierLookup);

      return (draft.lines || []).map((line) => {
        const { qty, fob, laidIn, wineCost, laidInCost, estimatedCost } = poLineCosts(line, fallbackLaidIn);

        return {
          supplier: poDraftSupplierLabel(draft),
          wine: line.product_name || "",
          code: line.product_code || "",
          quantity: qty,
          fob,
          laidInPerBottle: laidIn,
          totalWineCost: wineCost,
          totalLaidInCost: laidInCost,
          estimatedCost
        };
      });
    })
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
