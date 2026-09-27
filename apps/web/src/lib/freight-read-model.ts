import type { Recommendation, SupplierLogistics } from "./types";
import { asNumber, isApproved } from "./order-data";
import { buildDiContainerPlans } from "./di-planning";
type FreightMode = "suggested" | "approved";

type FreightSupplierRollup = {
  supplier: string;
  freightForwarder: string;
  orderFrequency: string;
  skuCount: number;
  quantity: number;
  cases: number;
  wineCost: number;
  laidInCost: number;
  estimatedCost: number;
};

type FreightLocationRollup = {
  location: string;
  supplierCount: number;
  skuCount: number;
  quantity: number;
  cases: number;
  wineCost: number;
  laidInCost: number;
  estimatedCost: number;
  suppliers: FreightSupplierRollup[];
};

function lineQuantity(row: Recommendation, mode: FreightMode): number {
  if (mode === "approved") {
    return isApproved(row) ? Math.max(0, Math.round(asNumber(row.approved_qty))) : 0;
  }

  return Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
}

function lineCosts(row: Recommendation, quantity: number) {
  const fob = asNumber(row.fob);
  const laidIn = asNumber(row.trucking_cost_per_bottle);
  const wineCost = fob * quantity;
  const laidInCost = laidIn * quantity;

  return {
    wineCost,
    laidInCost,
    estimatedCost: wineCost + laidInCost
  };
}

export function buildFreightRows(rows: Recommendation[], suppliers: SupplierLogistics[], mode: FreightMode) {
  const supplierLookup = new Map(suppliers.map((supplier) => [supplier.name.trim().toLowerCase(), supplier]));
    const locations = new Map<string, Map<string, FreightSupplierRollup>>();

    rows.forEach((row) => {
      const quantity = lineQuantity(row, mode);
      if (quantity <= 0) return;

      const location = row.pickup_location?.trim() || "Unassigned";
      const supplier = row.supplier_name?.trim() || "Unknown Supplier";
      const logistics = supplierLookup.get(supplier.toLowerCase());
      const { wineCost, laidInCost, estimatedCost } = lineCosts(row, quantity);
      const locationGroup = locations.get(location) || new Map<string, FreightSupplierRollup>();
      const supplierGroup =
        locationGroup.get(supplier) || {
          supplier,
          freightForwarder: logistics?.freight_forwarder || "",
          orderFrequency: logistics?.order_frequency || "",
          skuCount: 0,
          quantity: 0,
          cases: 0,
          wineCost: 0,
          laidInCost: 0,
          estimatedCost: 0
        };

      supplierGroup.skuCount += 1;
      supplierGroup.quantity += quantity;
      supplierGroup.cases += quantity / 12;
      supplierGroup.wineCost += wineCost;
      supplierGroup.laidInCost += laidInCost;
      supplierGroup.estimatedCost += estimatedCost;
      locationGroup.set(supplier, supplierGroup);
      locations.set(location, locationGroup);
    });

    return Array.from(locations.entries())
      .map(([location, suppliersMap]) => {
        const supplierRows = Array.from(suppliersMap.values()).sort(
          (a, b) => b.estimatedCost - a.estimatedCost || a.supplier.localeCompare(b.supplier)
        );
        return {
          location,
          supplierCount: supplierRows.length,
          skuCount: supplierRows.reduce((sum, supplier) => sum + supplier.skuCount, 0),
          quantity: supplierRows.reduce((sum, supplier) => sum + supplier.quantity, 0),
          cases: supplierRows.reduce((sum, supplier) => sum + supplier.cases, 0),
          wineCost: supplierRows.reduce((sum, supplier) => sum + supplier.wineCost, 0),
          laidInCost: supplierRows.reduce((sum, supplier) => sum + supplier.laidInCost, 0),
          estimatedCost: supplierRows.reduce((sum, supplier) => sum + supplier.estimatedCost, 0),
          suppliers: supplierRows
        } satisfies FreightLocationRollup;
      })
      .sort((a, b) => b.estimatedCost - a.estimatedCost || a.location.localeCompare(b.location));
}
export function buildFreightReadModel(rows: Recommendation[], suppliers: SupplierLogistics[]) {
  return { suggested: buildFreightRows(rows, suppliers, "suggested"), approved: buildFreightRows(rows, suppliers, "approved"), diPlans: buildDiContainerPlans(rows) };
}
export type FreightReadModel = ReturnType<typeof buildFreightReadModel>;
