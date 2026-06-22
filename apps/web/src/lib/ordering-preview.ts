import { asNumber } from "@/lib/order-data";
import type { OrderingLogicSettings } from "@/lib/ordering-logic";
import type { Recommendation } from "@/lib/types";

export type LogicPreviewSummary = {
  changedSkus: number;
  totalBottleDelta: number;
  estimatedCostDelta: number;
  zeroToPositive: number;
  positiveToZero: number;
  supplierImpacts: Array<{ supplier: string; bottleDelta: number; costDelta: number }>;
  warnings: string[];
};

export function previewOrderingLogicImpact(rows: Recommendation[], settings: OrderingLogicSettings): LogicPreviewSummary {
  const supplierTotals = new Map<string, { bottleDelta: number; costDelta: number }>();
  let changedSkus = 0;
  let totalBottleDelta = 0;
  let estimatedCostDelta = 0;
  let zeroToPositive = 0;
  let positiveToZero = 0;

  for (const row of rows) {
    const currentQty = Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
    const nextQty = recommendedQtyForSettings(row, settings);
    const delta = nextQty - currentQty;
    if (delta === 0) continue;

    const fob = asNumber(row.fob);
    const costDelta = delta * fob;
    changedSkus += 1;
    totalBottleDelta += delta;
    estimatedCostDelta += costDelta;
    if (currentQty === 0 && nextQty > 0) zeroToPositive += 1;
    if (currentQty > 0 && nextQty === 0) positiveToZero += 1;

    const supplier = row.supplier_name?.trim() || "Unknown Supplier";
    const current = supplierTotals.get(supplier) || { bottleDelta: 0, costDelta: 0 };
    current.bottleDelta += delta;
    current.costDelta += costDelta;
    supplierTotals.set(supplier, current);
  }

  const supplierImpacts = Array.from(supplierTotals.entries())
    .map(([supplier, impact]) => ({ supplier, ...impact }))
    .sort((a, b) => Math.abs(b.costDelta) - Math.abs(a.costDelta))
    .slice(0, 5);

  const warnings = [];
  if (Math.abs(totalBottleDelta) > 1200) warnings.push("Large bottle-count movement compared with the latest completed report.");
  if (Math.abs(estimatedCostDelta) > 25000) warnings.push("Large estimated FOB movement compared with the latest completed report.");

  return {
    changedSkus,
    totalBottleDelta,
    estimatedCostDelta,
    zeroToPositive,
    positiveToZero,
    supplierImpacts,
    warnings
  };
}

function recommendedQtyForSettings(row: Recommendation, settings: OrderingLogicSettings) {
  const weeklyVelocity = asNumber(row.weekly_velocity);
  const trueAvailable = asNumber(row.true_available);
  const onOrder = asNumber(row.on_order);
  const packSize = Math.max(1, Math.round(asNumber(row.pack_size) || settings.default_pack_size));
  const targetDays = row.is_btg
    ? settings.btg_target_days
    : row.is_core
      ? settings.core_target_days
      : settings.standard_target_days;
  const month = new Date().getMonth() + 1;
  const monthlyMultiplier = settings.monthly_mode_enabled ? settings.monthly_multipliers[String(month)]?.multiplier || 1 : 1;
  const targetQty = weeklyVelocity * (targetDays / 7);
  const raw = Math.max(0, targetQty - (trueAvailable + onOrder)) * monthlyMultiplier;
  if (raw <= 0) return 0;
  const preserveSubCase =
    (row.is_btg && settings.btg_round_sub_case_to_one_pack) || (row.is_core && settings.core_round_sub_case_to_one_pack);
  const minimumQty = preserveSubCase ? 0 : settings.standard_minimum_packs * packSize;
  if (raw < minimumQty) return 0;
  return Math.ceil(raw / packSize) * packSize;
}
