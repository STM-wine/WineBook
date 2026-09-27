import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { buildMarginSnapshot } from "./company-dashboard-data";
import { buildGrossProfitCenter } from "./supabase/gross-profit-center";
import { fetchStoredGrossProfitRollups } from "./supabase/gross-profit-stored-rollups";

vi.mock("./supabase/gross-profit-center", () => ({ buildGrossProfitCenter: vi.fn() }));
vi.mock("./supabase/gross-profit-stored-rollups", () => ({
  GROSS_PROFIT_FORMULA_VERSION: "test", STABLE_GROSS_PROFIT_LAG_DAYS: 124, fetchStoredGrossProfitRollups: vi.fn()
}));
const db = {} as SupabaseClient;
const summary = { grossSales: 100, credits: 0, netSales: 100, invoiceCount: 1, creditMemoCount: 0,
  averageInvoice: 100, sampleCost: 2, grossProfit: 31, grossProfitPercent: 31, grossProfitUnavailableReason: null };
beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date("2026-09-26T19:00:00Z")); vi.clearAllMocks();
  vi.mocked(buildGrossProfitCenter).mockResolvedValue({ lines: [] } as never);
  vi.mocked(fetchStoredGrossProfitRollups).mockResolvedValue({ summary, byRepRows: [], byAccountRows: [],
    businessLineSummaries: [], unavailableReason: null });
});
afterEach(() => vi.useRealTimers());

describe("margin snapshot historical parity", () => {
  it("preserves finalized totals without recalculating historical lines", async () => {
    const result = await buildMarginSnapshot(db, { from: "2025-09-01", to: "2025-09-26" });
    expect(buildGrossProfitCenter).not.toHaveBeenCalled();
    expect(result.periodState).toBe("finalized");
    expect(result.scopes.stem.company.summary).toEqual(summary);
    expect(fetchStoredGrossProfitRollups).toHaveBeenCalledWith(db, { from: "2025-09-01", to: "2025-09-26" },
      { businessLine: "stem", rep: undefined, includeBreakdowns: true });
  });
  it("splits a mixed range at the unchanged 124-day boundary", async () => {
    const result = await buildMarginSnapshot(db, { from: "2026-01-01", to: "2026-09-26" });
    expect(buildGrossProfitCenter).toHaveBeenCalledExactlyOnceWith(db, "2026-05-26", "2026-09-26");
    expect(fetchStoredGrossProfitRollups).toHaveBeenCalledWith(db, { from: "2026-01-01", to: "2026-05-25" },
      { businessLine: "all", rep: undefined, includeBreakdowns: true });
    expect(result.scopes.all.company.summary.grossProfit).toBe(31);
    expect(result.periodState).toBe("provisional");
  });
  it("does not substitute live or zero margins for missing finalized coverage", async () => {
    vi.mocked(fetchStoredGrossProfitRollups).mockResolvedValue({ summary, byRepRows: [], byAccountRows: [],
      businessLineSummaries: [], unavailableReason: "Stored gross profit is still backfilling for this range." });
    await expect(buildMarginSnapshot(db, { from: "2025-09-01", to: "2025-09-26" })).rejects.toThrow("still backfilling");
    expect(buildGrossProfitCenter).not.toHaveBeenCalled();
  });
  it("uses one live calculation for recent company and representative views", async () => {
    await buildMarginSnapshot(db, { from: "2026-09-01", to: "2026-09-26" });
    expect(fetchStoredGrossProfitRollups).not.toHaveBeenCalled();
    expect(buildGrossProfitCenter).toHaveBeenCalledExactlyOnceWith(db, "2026-09-01", "2026-09-26");
  });
});
