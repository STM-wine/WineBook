import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const orderingPagePath = path.resolve(process.cwd(), "src/app/page.tsx");
const poCreateRoutePath = path.resolve(process.cwd(), "src/app/api/po-drafts/create/route.ts");

describe("current QuickBooks sales cutoff contract", () => {
  it("uses the same verified current-sales loader for Order Summary and PO creation", async () => {
    const [page, poCreateRoute] = await Promise.all([
      readFile(orderingPagePath, "utf8"),
      readFile(poCreateRoutePath, "utf8")
    ]);

    expect(page).toContain("fetchCurrentSourceBackedOrderingData");
    expect(poCreateRoute).toContain("fetchCurrentSourceBackedOrderingData");
    expect(page).not.toContain("referenceDate: latestRun.report_date");
    expect(poCreateRoute).not.toContain("referenceDate: orderingRun.report_date");
  });

  it("fails closed instead of falling back to stored source-run sales", async () => {
    const page = await readFile(orderingPagePath, "utf8");

    expect(page).toContain("sourceBackedRun && !currentSourceOverlayResult.rows");
    expect(page).toContain("Order Summary rows are hidden instead of showing stale sales or recommendations");
  });
});
