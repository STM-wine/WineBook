import type { PurchaseOrderDraftWithLines, SupplierLogistics } from "./types";
import { poExportLines } from "./po-utils";

function csvEscape(value: string | number | null) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function poCsvBuffer(drafts: PurchaseOrderDraftWithLines[], suppliers: SupplierLogistics[] = []) {
  const headers = [
    "Supplier", "Producer", "Wine", "Code", "Item Warning", "Quantity", "FOB",
    "Laid In Cost", "Total Wine Cost", "Total Laid In Cost", "Estimated Cost"
  ];
  const rows = poExportLines(drafts, suppliers).map((line) => [
    line.supplier,
    line.producer,
    line.wine,
    line.code,
    line.itemWarning,
    line.quantity,
    line.fob.toFixed(2),
    line.laidInPerBottle.toFixed(4),
    line.totalWineCost.toFixed(2),
    line.totalLaidInCost.toFixed(2),
    line.estimatedCost.toFixed(2)
  ]);
  return Buffer.from([headers, ...rows].map((row) => row.map(csvEscape).join(",")).join("\n"), "utf8");
}
