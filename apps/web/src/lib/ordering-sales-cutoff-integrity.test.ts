import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const orderingPagePath = path.resolve(process.cwd(), "src/app/page.tsx");
const poCreateRoutePath = path.resolve(process.cwd(), "src/app/api/po-drafts/create/route.ts");
const sourceServerPath = path.resolve(process.cwd(), "src/lib/source-backed-ordering-server.ts");
const sourceRunsPath = path.resolve(process.cwd(), "src/lib/source-backed-ordering-runs.ts");

describe("current QuickBooks sales cutoff contract", () => {
  it("uses the same verified current-sales loader for Order Summary and PO creation", async () => {
    const [page, poCreateRoute] = await Promise.all([
      readFile(orderingPagePath, "utf8"),
      readFile(poCreateRoutePath, "utf8")
    ]);

    expect(page).toContain("fetchCurrentOrderingOverlay");
    expect(poCreateRoute).toContain("fetchCurrentOrderingOverlay");
    expect(page).not.toContain("fetchCurrentSourceBackedOrderingData");
    expect(poCreateRoute).not.toContain("fetchCurrentSourceBackedOrderingData");
    expect(page).not.toContain("referenceDate: latestRun.report_date");
    expect(poCreateRoute).not.toContain("referenceDate: orderingRun.report_date");
  });

  it("fails closed instead of falling back to stored source-run sales", async () => {
    const page = await readFile(orderingPagePath, "utf8");

    expect(page).toContain("sourceBackedRun && !currentSourceOverlayResult.rows");
    expect(page).toContain("Order Summary rows are hidden instead of showing stale sales or recommendations");
  });

  it("keeps full catalog reconstruction out of normal page and PO requests", async () => {
    const [page, poCreateRoute, sourceServer, sourceRuns] = await Promise.all([
      readFile(orderingPagePath, "utf8"),
      readFile(poCreateRoutePath, "utf8"),
      readFile(sourceServerPath, "utf8"),
      readFile(sourceRunsPath, "utf8")
    ]);

    expect(page).toContain("sourceBackedRun\n    ? Promise.resolve([])\n    : fetchQuickBooksOnOrderItems");
    expect(poCreateRoute).toContain("sourceBacked ? Promise.resolve([]) : fetchQuickBooksOnOrderItems");
    expect(sourceServer).toContain("fetchCurrentOrderingOverlay");
    expect(sourceServer).toContain('select("list_id,raw_data", { count: "exact" })');
    expect(sourceServer).toContain('from("approval_commitments")');
    expect(sourceServer).toContain("recommendationAllowsSourceAssignmentRefresh");
    expect(sourceRuns).toContain("fetchSourceBackedOrderingData");
  });
});
