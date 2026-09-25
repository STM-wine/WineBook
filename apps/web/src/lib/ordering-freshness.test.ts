import { describe, expect, it } from "vitest";
import {
  assertCurrentOrderingDiagnostics,
  formatOrderingBusinessDate,
  orderingBusinessDate
} from "./ordering-freshness";

describe("ordering sales freshness", () => {
  it("uses the Phoenix business date at the daylight-saving boundary", () => {
    expect(orderingBusinessDate(new Date("2026-09-25T06:30:00Z"))).toBe("2026-09-24");
    expect(orderingBusinessDate(new Date("2026-09-25T07:00:00Z"))).toBe("2026-09-25");
  });

  it("accepts only a sales cutoff backed by a same-day completed QuickBooks mirror", () => {
    expect(() => assertCurrentOrderingDiagnostics({
      reference_date: "2026-09-25",
      quickbooks_as_of: "2026-09-25T18:15:00Z"
    }, "2026-09-25")).not.toThrow();
  });

  it("rejects the locked ordering run date as a stale live-sales cutoff", () => {
    expect(() => assertCurrentOrderingDiagnostics({
      reference_date: "2026-09-15",
      quickbooks_as_of: "2026-09-25T18:15:00Z"
    }, "2026-09-25")).toThrow(/expected a 2026-09-25 sales cutoff/);
  });

  it("rejects a current cutoff when the QuickBooks mirror is from a prior business date", () => {
    expect(() => assertCurrentOrderingDiagnostics({
      reference_date: "2026-09-25",
      quickbooks_as_of: "2026-09-24T18:15:00Z"
    }, "2026-09-25")).toThrow(/latest complete QuickBooks data is from 2026-09-24/);
  });

  it("formats the verified cutoff for the Order Summary", () => {
    expect(formatOrderingBusinessDate("2026-09-25")).toBe("Sep 25, 2026");
  });
});
