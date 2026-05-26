import { asNumber, formatInteger } from "./order-data";
import type { Recommendation } from "./types";

export type OrderPath = "stateside" | "di";

export type DiEligibility = {
  eligible: boolean;
  brand: string;
  containerGroup: "NZ_AKL" | "IT_LIV" | "";
  originPort: "Auckland" | "Livorno" | "";
  triggerWeeks: number;
};

export type DiPlanRow = {
  row: Recommendation;
  brand: string;
  weightedDemand: number;
  share: number;
  allocatedQty: number;
  packSize: number;
};

export type DiContainerPlan = {
  containerGroup: "NZ_AKL" | "IT_LIV";
  originPort: "Auckland" | "Livorno";
  targetBottles: number;
  toleranceBottles: number;
  lowTolerance: number;
  highTolerance: number;
  totalAllocated: number;
  selectedSkuCount: number;
  rows: DiPlanRow[];
};

const CONTAINER_TARGET_BOTTLES = 13440;
const CONTAINER_TOLERANCE_PCT = 0.05;

const DI_BRANDS: Array<Omit<DiEligibility, "eligible">> = [
  { brand: "Ant Moore", containerGroup: "NZ_AKL", originPort: "Auckland", triggerWeeks: 12 },
  { brand: "Wai Wai", containerGroup: "NZ_AKL", originPort: "Auckland", triggerWeeks: 12 },
  { brand: "Blalock & Moore", containerGroup: "NZ_AKL", originPort: "Auckland", triggerWeeks: 12 },
  { brand: "Blalock Moore", containerGroup: "NZ_AKL", originPort: "Auckland", triggerWeeks: 12 },
  { brand: "Giuseppe & Luigi", containerGroup: "IT_LIV", originPort: "Livorno", triggerWeeks: 10 },
  { brand: "LaGiana", containerGroup: "IT_LIV", originPort: "Livorno", triggerWeeks: 10 },
  { brand: "La Giana", containerGroup: "IT_LIV", originPort: "Livorno", triggerWeeks: 10 },
  { brand: "Reguta", containerGroup: "IT_LIV", originPort: "Livorno", triggerWeeks: 10 },
  { brand: "Provaci", containerGroup: "IT_LIV", originPort: "Livorno", triggerWeeks: 10 }
];

function normalize(value: string | null | undefined) {
  return (value || "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function packSize(row: Recommendation) {
  return Math.max(1, Math.round(asNumber(row.pack_size) || 12));
}

function roundToPack(qty: number, pack: number) {
  return Math.max(0, Math.round(qty / pack) * pack);
}

function isApprovedForPo(row: Recommendation) {
  return row.recommendation_status === "approved" || row.recommendation_status === "edited";
}

export function orderPath(row: Recommendation): OrderPath {
  return row.order_path === "di" ? "di" : "stateside";
}

export function diEligibility(row: Recommendation): DiEligibility {
  const name = normalize(row.product_name || row.planning_sku);
  const match = DI_BRANDS.find((brand) => name.includes(normalize(brand.brand)));
  if (!match) {
    return { eligible: false, brand: "", containerGroup: "", originPort: "", triggerWeeks: 0 };
  }

  return { eligible: true, ...match };
}

export function weeksSupply(row: Recommendation) {
  const stored = asNumber(row.weeks_on_hand_with_on_order);
  if (stored > 0) return stored;
  const weeklyVelocity = asNumber(row.weekly_velocity);
  if (weeklyVelocity <= 0) return 0;
  return (asNumber(row.true_available) + asNumber(row.on_order)) / weeklyVelocity;
}

export function isDiOpportunity(row: Recommendation) {
  const eligibility = diEligibility(row);
  return eligibility.eligible && weeksSupply(row) < eligibility.triggerWeeks;
}

export function weightedDiDemand(row: Recommendation) {
  const last30Monthly = asNumber(row.last_30_day_sales);
  const last90Monthly = asNumber(row.last_90_day_sales) / 3;
  const trailing12Monthly = (asNumber(row.last_365_day_sales) || asNumber(row.last_12_month_sales)) / 12;
  return last30Monthly * 0.5 + last90Monthly * 0.3 + trailing12Monthly * 0.2;
}

function adjustToTolerance(rows: DiPlanRow[], lowTolerance: number, highTolerance: number) {
  let total = rows.reduce((sum, row) => sum + row.allocatedQty, 0);
  const descendingDemand = [...rows].sort((a, b) => b.weightedDemand - a.weightedDemand);

  let guard = 0;
  while (total < lowTolerance && rows.length > 0 && guard < 5000) {
    const target = descendingDemand[guard % descendingDemand.length];
    target.allocatedQty += target.packSize;
    total += target.packSize;
    guard += 1;
  }

  guard = 0;
  const ascendingDemand = [...rows].sort((a, b) => a.weightedDemand - b.weightedDemand);
  while (total > highTolerance && rows.length > 0 && guard < 5000) {
    const target = ascendingDemand.find((row) => row.allocatedQty > row.packSize);
    if (!target) break;
    target.allocatedQty -= target.packSize;
    total -= target.packSize;
    guard += 1;
  }

  return total;
}

export function buildDiContainerPlans(rows: Recommendation[]): DiContainerPlan[] {
  const selected = rows
    .map((row) => ({ row, eligibility: diEligibility(row) }))
    .filter(({ row, eligibility }) => eligibility.eligible && orderPath(row) === "di");
  const grouped = new Map<"NZ_AKL" | "IT_LIV", Array<{ row: Recommendation; eligibility: DiEligibility }>>();

  selected.forEach((entry) => {
    const group = grouped.get(entry.eligibility.containerGroup as "NZ_AKL" | "IT_LIV") || [];
    group.push(entry);
    grouped.set(entry.eligibility.containerGroup as "NZ_AKL" | "IT_LIV", group);
  });

  return Array.from(grouped.entries()).map(([containerGroup, groupRows]) => {
    const originPort = groupRows[0]?.eligibility.originPort as "Auckland" | "Livorno";
    const demandValues = groupRows.map(({ row }) => weightedDiDemand(row));
    const totalDemand = demandValues.reduce((sum, value) => sum + value, 0);
    const equalShare = groupRows.length > 0 ? 1 / groupRows.length : 0;
    const planRows = groupRows.map(({ row, eligibility }, index) => {
      const demand = demandValues[index] || 0;
      const share = totalDemand > 0 ? demand / totalDemand : equalShare;
      const pack = packSize(row);
      return {
        row,
        brand: eligibility.brand,
        weightedDemand: demand,
        share,
        allocatedQty: Math.max(pack, roundToPack(CONTAINER_TARGET_BOTTLES * share, pack)),
        packSize: pack
      };
    });
    const toleranceBottles = CONTAINER_TARGET_BOTTLES * CONTAINER_TOLERANCE_PCT;
    const lowTolerance = CONTAINER_TARGET_BOTTLES - toleranceBottles;
    const highTolerance = CONTAINER_TARGET_BOTTLES + toleranceBottles;
    const totalAllocated = adjustToTolerance(planRows, lowTolerance, highTolerance);

    return {
      containerGroup,
      originPort,
      targetBottles: CONTAINER_TARGET_BOTTLES,
      toleranceBottles,
      lowTolerance,
      highTolerance,
      totalAllocated,
      selectedSkuCount: groupRows.length,
      rows: planRows.sort((a, b) => b.allocatedQty - a.allocatedQty || (a.row.product_name || "").localeCompare(b.row.product_name || ""))
    };
  });
}

export function buildDiAllocationMap(rows: Recommendation[]) {
  const allocations = new Map<string, number>();
  buildDiContainerPlans(rows).forEach((plan) => {
    plan.rows.forEach((row) => {
      allocations.set(row.row.id, row.allocatedQty);
    });
  });
  return allocations;
}

export function applyDiContainerRecommendations(rows: Recommendation[]): Recommendation[] {
  const allocations = buildDiAllocationMap(rows);
  if (allocations.size === 0) return rows;

  return rows.map((row) => {
    const allocatedQty = allocations.get(row.id);
    if (allocatedQty === undefined) return row;

    const fob = asNumber(row.fob);
    const trucking = asNumber(row.trucking_cost_per_bottle);
    const orderCost = fob * allocatedQty;

    return {
      ...row,
      recommended_qty_rounded: allocatedQty,
      ...(isApprovedForPo(row) ? { approved_qty: allocatedQty, recommendation_status: "approved" } : {}),
      order_cost: orderCost,
      landed_cost: orderCost + trucking * allocatedQty
    };
  });
}

export function formatDiPlanRange(plan: DiContainerPlan) {
  return `${formatInteger(plan.lowTolerance)}-${formatInteger(plan.highTolerance)} bottles`;
}
