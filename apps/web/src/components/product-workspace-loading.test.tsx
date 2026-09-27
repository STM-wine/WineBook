// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ProductWorkspaceView } from "./product-workspace-view";
import type { ProductWorkspacePage, ProductWorkspaceListRow } from "@/lib/product-workspace-types";
let host: HTMLDivElement;
let root: Root;
let requests: Array<{ url: string; resolve: (value: unknown) => void; signal: AbortSignal }>;
function row(id: string): ProductWorkspaceListRow {
  return { active: true, vintage: "2024", pack: "12/750ml", supplierSource: null, statusKey: "active_match", statusDetail: "Active",
    fobSource: null, laidInSource: null, landedCost: null, lastSold: null, ytdSales: null, id, itemCode: id, productName: id, brand: null, supplierName: "Supplier", sourceBadges: [], sourceHealth: "ready", sourceHealthLabel: "Ready",
    revenueCenter: "Stem Core", statusLabel: "Active", fob: null, laidIn: null, frontline: null, bestPrice: null, lowestGpPercent: null,
    quickbooks: { listId: id }, orderingMarker: { replenishmentPolicy: "Core", recommendationsSuppressed: false, isBtg: false, isCore: true, policyFamilyKey: null,
      policyFamilyName: null, familyDefaultPolicy: "Core", suppressionReason: null, suppressedUntil: null, suppressionChangedAt: null,
      suppressionChangedBy: null, markerNote: null, noteSource: null, updatedAt: null, updatedBy: null } } as ProductWorkspaceListRow;
}
function page(id: string, offset = 0): ProductWorkspacePage {
  return { rows: [row(id)], snapshotId: "snapshot-a", generatedAt: "2026-09-26T12:00:00Z", sourceVersion: 1, formulaVersion: "v1", businessDate: "2026-09-26", isStale: false, offset, pageSize: 75, hasMore: true };
}
async function tick(ms = 1) { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); }
async function resolve(index: number, data: unknown, ok = true) {
  await act(async () => { requests[index].resolve({ ok, json: async () => data }); });
}
beforeEach(async () => {
  vi.useFakeTimers();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: { signal: AbortSignal }) => {
    if (String(url).includes("mode=counts")) return Promise.resolve({ ok: true, json: async () => ({ data: { visible: 190, suppliers: ["Supplier"], lifecycleMismatches: 3, needsReview: 2, gpRed: 1, gpYellow: 2, vsStatusUnknown: 0, qbActiveVsUnknown: 0 } }) });
    // Deliberately ignore abort: an obsolete backend response can still arrive.
    return new Promise((resolve) => requests.push({ url: String(url), resolve, signal: init.signal }));
  }));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => { root.render(<ProductWorkspaceView canManageMarkers={false} />); }); await tick();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("Product Workspace loading", () => {
  it("shows controls and feedback before rows, then complete counts separately", async () => {
    expect(host.textContent).toContain("Loading products"); expect(host.querySelector('input[placeholder]')).not.toBeNull();
    await resolve(0, page("first"));
    expect(host.textContent).toContain("first"); expect(host.textContent).toContain("190 matching items");
    expect(host.textContent).toContain("No product selected");
  });
  it("retains previous results and ignores a slower obsolete filter request", async () => {
    await resolve(0, page("original"));
    const inactive = host.querySelector('input[type="checkbox"]') as HTMLInputElement;
    await act(async () => inactive.click()); await tick();
    expect(host.textContent).toContain("original");
    await act(async () => inactive.click()); await tick();
    expect(requests[1].signal.aborted).toBe(true);
    await resolve(2, page("newer")); await resolve(1, page("obsolete"));
    expect(host.textContent).toContain("newer"); expect(host.textContent).not.toContain("obsolete");
  });
  it("requests the next database page from the same snapshot", async () => {
    await resolve(0, page("first"));
    const next = [...host.querySelectorAll('button')].find((button) => button.textContent === "Next 75")!;
    await act(async () => next.click()); await tick();
    expect(requests[1].url).toContain("offset=75"); expect(requests[1].url).toContain("snapshot=snapshot-a");
    await resolve(1, page("next-page", 75)); expect(host.textContent).not.toContain("first");
  });
  it("keeps loaded rows on refresh failure and offers retry", async () => {
    await resolve(0, page("retained"));
    const reload = [...host.querySelectorAll('button')].find((button) => button.textContent === "Reload")!;
    await act(async () => reload.click()); await tick(); await resolve(1, { error: "Temporarily unavailable" }, false);
    expect(host.textContent).toContain("retained"); expect(host.querySelector('[role="alert"]')?.textContent).toContain("Retry");
  });
  it("fetches full product details only when a product is opened", async () => {
    await resolve(0, page("wine")); expect(requests).toHaveLength(1);
    await act(async () => (host.querySelector('tbody tr') as HTMLElement).click());
    expect(requests[1].url).toContain("mode=detail"); expect(requests[1].url).toContain("snapshot=snapshot-a");
    await resolve(1, { error: "Detail failed" }, false); expect(host.textContent).toContain("Detail failed");
  });
});
