// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CompanyDashboardView } from "./company-dashboard-view";
import type { CompanyDashboardData } from "@/lib/company-dashboard-data";
let host: HTMLDivElement, root: Root;
let requests: Array<{ url: string; signal: AbortSignal; resolve: (value: unknown) => void }>;
function dashboard(profit: number | null = null): CompanyDashboardData {
  const summary = { grossSales: 100, credits: 0, netSales: 100, invoiceCount: 1, creditMemoCount: 0, averageInvoice: 100,
    sampleCost: 0, grossProfit: profit, grossProfitPercent: profit === null ? null : profit / 100, grossProfitUnavailableReason: null };
  return { generatedAt: new Date().toISOString(), period: "mtd", periodLabel: "Month to date", dateFrom: "2026-09-01", dateTo: "2026-09-26",
    businessLine: "all", salesThroughDate: "2026-09-26", summary, comparison: null, sourceVersion: 1,
    businessLineSummaries: profit === null ? [] : [{ key: "stem", label: "Stem Core", salesShare: 1, ...summary }],
    byRep: [], byAccount: [], breakdownsLoaded: false, selectedRep: null, unavailableReason: null };
}
beforeEach(async () => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: { signal: AbortSignal }) => new Promise((resolve) => requests.push({ url, signal: init.signal, resolve }))));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<CompanyDashboardView initialData={dashboard()} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("sales-first home", () => {
  it("renders sales immediately and explicitly starts initial margin hydration", () => {
    expect(host.textContent).toContain("Net sales"); expect(host.textContent).toContain("$100.00");
    expect(requests).toHaveLength(1); expect(requests[0].url).toContain("includeComparison=false");
    expect(host.textContent).toContain("Calculating margins");
  });
  it("shows current margins while the prior-year comparison loads independently", async () => {
    await act(async () => requests[0].resolve({ ok: true, status: 200, json: async () => dashboard(30) }));
    expect(requests).toHaveLength(2); expect(requests[1].url).not.toContain("includeComparison=false");
    expect(host.textContent).toContain("Loading prior-year comparison");
    expect(host.textContent).toContain("31.1%");
  });
  it("announces the actual pending stage and stops only the browser wait", async () => {
    await act(async () => requests[0].resolve({ ok: true, status: 202, json: async () => ({ pending: true, stage: "Waiting for the shared calculation worker" }) }));
    expect(host.textContent).toContain("Waiting for the shared calculation worker");
    const stop = [...host.querySelectorAll('button')].find((b) => b.textContent === "Stop waiting")!;
    expect(host.textContent).toContain("Server work may continue");
    await act(async () => stop.click());
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(3000)); expect(requests).toHaveLength(1);
  });
});
