import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchCurrentOrderingOverlay } from "./source-backed-ordering-server";
import { fetchQuickBooksItemSalesWindows } from "./supabase/quickbooks-item-sales-windows";
import { orderingSalesReferenceDate, quickBooksUploadLabel } from "./ordering-freshness";

vi.mock("./supabase/quickbooks-item-sales-windows", () => ({ fetchQuickBooksItemSalesWindows: vi.fn(async () => []) }));
vi.mock("./supabase/recommendations", () => ({ fetchLatestCompletedQuickBooksOnOrderSnapshot: vi.fn(async () => []) }));
const completedAt = "2026-09-26T23:28:45Z";
const availability = { byProductCode: new Map(), snapshotAt: completedAt } as never;
function database(lastUpload = completedAt, status = "completed", pages = 0) {
  return { from(table: string) {
    let columns = "";
    const query = {
      select(value: string) { columns = value; return query; },
      eq() { return query; }, in() { return query; }, order() { return query; }, limit() { return query; }, range() { return query; },
      returns: async () => ({ data: [], count: 0, error: null }),
      maybeSingle: async () => ({ error: null, data: table === "source_sync_runs"
        ? columns === "id,completed_at" ? { id: "last-completed", completed_at: lastUpload } : {
          id: "sync", status, started_at: lastUpload, completed_at: lastUpload,
          diagnostics: { completed_request_count: pages }
        } : null })
    };
    return query;
  } } as unknown as SupabaseClient;
}

beforeEach(() => vi.clearAllMocks());
describe("ordering without a new QuickBooks upload", () => {
  it.each(["2026-09-27T07:01:00Z", "2026-09-28T18:00:00Z", "2026-10-05T18:00:00Z"])("keeps the last uploaded sales cutoff at %s", async (now) => {
    const result = await fetchCurrentOrderingOverlay(database(), [], { now: new Date(now), liveAvailability: availability });
    expect(fetchQuickBooksItemSalesWindows).toHaveBeenCalledWith(expect.anything(), "2026-09-26", "sync");
    expect(result.diagnostics).toMatchObject({ reference_date: "2026-09-26", quickbooks_as_of: completedAt });
  });
  it("advances the cutoff only when another upload completes", async () => {
    const result = await fetchCurrentOrderingOverlay(database("2026-09-28T23:00:00Z"), [], { now: new Date("2026-09-29T18:00:00Z"), liveAvailability: availability });
    expect(fetchQuickBooksItemSalesWindows).toHaveBeenCalledWith(expect.anything(), "2026-09-28", "sync");
    expect(result.diagnostics.reference_date).toBe("2026-09-28");
  });
  it("ignores an empty failed connector attempt when completed data exists", async () => {
    await expect(fetchCurrentOrderingOverlay(database(completedAt, "failed", 0), [], { liveAvailability: availability })).resolves.toMatchObject({ diagnostics: { quickbooks_as_of: completedAt } });
    expect(fetchQuickBooksItemSalesWindows).toHaveBeenCalledWith(expect.anything(), "2026-09-26", "last-completed");
  });
  it("still prevents PO calculations from using an incomplete import", async () => {
    await expect(fetchCurrentOrderingOverlay(database(completedAt, "failed", 1), [], { liveAvailability: availability })).rejects.toThrow(/not complete/);
    expect(fetchQuickBooksItemSalesWindows).not.toHaveBeenCalled();
  });
  it("keeps the saved rows available during an incomplete import", async () => {
    const result = await fetchCurrentOrderingOverlay(database(completedAt, "failed", 1), [{
      product_code: "MAT000066", true_available: 33, weekly_velocity: 3, on_order: 0, diagnostics: {}
    } as never], {
      liveAvailability: { byProductCode: new Map([["MAT000066", 0]]), snapshotAt: "2026-10-06T18:30:00Z" },
      allowVerifiedFallbackDuringRefresh: true, verifiedReferenceDate: "2026-09-26"
    });
    expect(result.rows[0]).toMatchObject({ true_available: 0, weeks_on_hand: 0 });
    expect(result.diagnostics).toMatchObject({
      using_saved_recommendations: true, reference_date: "2026-09-26",
      vinosmith_available_as_of: "2026-10-06T18:30:00Z"
    });
    expect(fetchQuickBooksItemSalesWindows).not.toHaveBeenCalled();
  });
  it("does not show saved availability when the live Vinosmith read fails", async () => {
    await expect(fetchCurrentOrderingOverlay(database(completedAt, "failed", 1), [], {
      liveAvailability: null, allowVerifiedFallbackDuringRefresh: true
    })).rejects.toThrow("Current Vinosmith Available could not be verified");
  });
  it("uses Arizona dates for uploads near midnight and refuses missing upload metadata", () => {
    expect(orderingSalesReferenceDate("2026-09-27T06:59:00Z")).toBe("2026-09-26");
    expect(orderingSalesReferenceDate("2026-09-27T07:00:00Z")).toBe("2026-09-27");
    expect(() => orderingSalesReferenceDate(null)).toThrow(/completed-upload timestamp/);
    expect(() => orderingSalesReferenceDate("invalid")).toThrow(/completed-upload timestamp/);
    expect(quickBooksUploadLabel(completedAt)).toBe("QB Updated Sep 26, 2026, 4:28 PM");
  });
});
