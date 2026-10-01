// Policy eligibility belongs to the caller. Quantity depends only on coverage,
// demand, supply, and pack size; Core and Select use exactly the same formula.
export const DEFAULT_TARGET_WEEKS = 5;

export function calculateCoverageRecommendation(input: {
  weeklyVelocity: number;
  trueAvailable: number;
  onOrder: number;
  packSize: number;
  targetWeeks?: number;
  automaticRecommendation?: boolean;
  urgentWeeks?: number;
  highRiskCoverage?: number;
  mediumRiskCoverage?: number;
}) {
  const weeks = input.targetWeeks ?? DEFAULT_TARGET_WEEKS;
  const velocity = Math.max(0, input.weeklyVelocity);
  const supply = input.trueAvailable + Math.max(0, input.onOrder);
  const targetQty = Math.max(0, weeks) * velocity;
  // Remove floating-point dust before ceiling to a case (6.000000000000001
  // bottles must not become two six-packs).
  const need = velocity > 0 && weeks > 0
    ? Math.round(Math.max(0, targetQty - supply) * 1e9) / 1e9 : 0;
  const raw = input.automaticRecommendation === false ? 0 : need;
  const pack = Math.max(1, Math.round(input.packSize || 1));
  const ratio = targetQty > 0 ? supply / targetQty : Infinity;
  const onHandWeeks = velocity > 0 ? input.trueAvailable / velocity : Infinity;
  const reorderStatus = velocity <= 0 ? "NO SALES"
    : weeks <= 0 ? "OK"
    : onHandWeeks < Math.min(weeks, input.urgentWeeks ?? 4) ? "URGENT"
    : onHandWeeks < weeks ? "LOW" : "OK";
  const riskLevel = velocity <= 0 ? "No Sales"
    : ratio < (input.highRiskCoverage ?? 0.5) ? "High"
    : ratio < (input.mediumRiskCoverage ?? 1) ? "Medium" : "Low";
  return {
    target_days: Math.max(0, weeks) * 7,
    target_qty: targetQty,
    base_recommended_qty_raw: need,
    recommended_qty_raw: raw,
    recommended_qty_rounded: raw > 0 ? Math.ceil(raw / pack) * pack : 0,
    reorder_status: reorderStatus,
    risk_level: riskLevel
  } as const;
}
