import { describe, expect, it } from "vitest";
import {
  isQuickBooksSyncActivelyRunning,
  quickBooksSyncLastActivityAt,
  QUICKBOOKS_SYNC_ACTIVITY_TIMEOUT_MS
} from "./quickbooks-sync-state";

describe("QuickBooks sync activity", () => {
  const now = new Date("2026-09-26T00:30:00.000Z");

  it("treats a newly started run as active", () => {
    expect(isQuickBooksSyncActivelyRunning({
      status: "running",
      started_at: "2026-09-26T00:29:00.000Z",
      diagnostics: { completed_request_count: 0 }
    }, now)).toBe(true);
  });

  it("treats a silent run past the activity timeout as abandoned", () => {
    expect(isQuickBooksSyncActivelyRunning({
      status: "running",
      started_at: new Date(now.getTime() - QUICKBOOKS_SYNC_ACTIVITY_TIMEOUT_MS - 1).toISOString(),
      diagnostics: { completed_request_count: 0 }
    }, now)).toBe(false);
  });

  it("uses the latest page activity instead of the original start time", () => {
    const run = {
      status: "running",
      started_at: "2026-09-25T22:00:00.000Z",
      diagnostics: { last_activity_at: "2026-09-26T00:25:00.000Z" }
    };
    expect(quickBooksSyncLastActivityAt(run)).toBe("2026-09-26T00:25:00.000Z");
    expect(isQuickBooksSyncActivelyRunning(run, now)).toBe(true);
  });

  it("never treats a completed run as active", () => {
    expect(isQuickBooksSyncActivelyRunning({
      status: "completed",
      started_at: "2026-09-26T00:29:00.000Z",
      diagnostics: { last_activity_at: "2026-09-26T00:29:30.000Z" }
    }, now)).toBe(false);
  });
});
