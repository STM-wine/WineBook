// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { CompanyDashboardView } from "./company-dashboard-view";
import type { CompanyDashboardData } from "@/lib/company-dashboard-data";
let host: HTMLDivElement, controls: HTMLDivElement, root: Root;
let requests: Array<{ url: string; signal: AbortSignal; resolve: (value: unknown) => void }>;
function dashboard(profit: number | null = null): CompanyDashboardData {
  const summary = { grossSales: 100, credits: 0, netSales: 100, invoiceCount: 1, creditMemoCount: 0, averageInvoice: 100,
    sampleCost: 0, grossProfit: profit, grossProfitPercent: profit === null ? null : profit / 100, grossProfitUnavailableReason: null };
  return { generatedAt: new Date().toISOString(), period: "mtd", periodLabel: "Month to date", dateFrom: "2026-09-01", dateTo: "2026-09-26",
    businessLine: "all", salesThroughDate: "2026-09-26", summary, comparison: null, sourceVersion: 1,
    businessLineSummaries: profit === null ? [] : [{ key: "stem", label: "Stem Core", salesShare: 1, ...summary }],
    byRep: [], byAccount: [], breakdownsLoaded: false, selectedRep: null, unavailableReason: null };
}
function panel(kind: "rep" | "account") {
  return [...host.querySelectorAll('h2')].find((heading) => heading.textContent?.endsWith(kind === "rep" ? "Sales by Rep" : "Account Summary"))!.closest('section')!;
}
function row(label: string) {
  return { key: label, label, invoiceSales: 100, creditMemos: 0, netSales: 100, invoiceCount: 1, creditMemoCount: 0, creditMemoRate: 0 };
}
async function respond(index: number, data: CompanyDashboardData) {
  await act(async () => requests[index].resolve({ ok: true, status: 200, json: async () => data }));
}
beforeEach(async () => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-26T19:00:00Z')); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: { signal: AbortSignal }) => new Promise((resolve) => requests.push({ url, signal: init.signal, resolve }))));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  controls = document.createElement('div'); controls.id='topbar-context-controls'; document.body.appendChild(controls);
  await act(async () => root.render(<CompanyDashboardView initialData={dashboard()} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); controls.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("sales-first home", () => {
  it("renders sales immediately and explicitly starts initial margin hydration", () => {
    expect(host.textContent).toContain("Net sales"); expect(host.textContent).toContain("$100.00");
    expect(host.querySelector('[aria-label="Sales KPIs"]')).toBeNull();
    expect(requests).toHaveLength(1); expect(requests[0].url).toContain("includeComparison=false");
    expect(host.textContent).toContain("Calculating margins");
  });
  it("shows current margins while the prior-year comparison loads independently", async () => {
    await act(async () => requests[0].resolve({ ok: true, status: 200, json: async () => dashboard(30) }));
    expect(requests).toHaveLength(2); expect(requests[1].url).not.toContain("includeComparison=false");
    expect(host.textContent).toContain("Loading prior-year comparison");
    expect(host.textContent).toContain("31.1%");
    expect(host.textContent).not.toContain("Net sales $100.00");
    expect([...host.querySelectorAll('h2')].some((heading) => ["Net sales", "Gross sales", "Credits"].includes(heading.textContent || ""))).toBe(false);
  });
  it.each(["rep", "account"] as const)("loads only the requested %s table", async (kind) => {
    await respond(0,dashboard(30)); await respond(1,dashboard(30));
    await act(async()=> (panel(kind).querySelector('button') as HTMLButtonElement).click());
    expect(requests).toHaveLength(3);
    expect(requests[2].url).toContain(`includeRepBreakdown=${kind === "rep"}`);
    expect(requests[2].url).toContain(`includeAccountBreakdown=${kind === "account"}`);
    expect(panel(kind).textContent).toContain('Loading');
    const other = kind === "rep" ? "account" : "rep";
    expect(panel(other).textContent).not.toContain('Loading');
    expect(panel(other).querySelector('table')).toBeNull();
    await respond(2,{...dashboard(30),repBreakdownLoaded:kind === 'rep',accountBreakdownLoaded:kind === 'account',
      byRep:kind === 'rep'?[row('Rep A')]:[],byAccount:kind === 'account'?[row('Account A')]:[]});
    expect(panel(kind).textContent).toContain(kind === 'rep'?'Rep A':'Account A');
    // Reopening the loaded table uses its own cache.
    await act(async()=> (panel(kind).querySelector('button') as HTMLButtonElement).click());
    await act(async()=> (panel(kind).querySelector('button') as HTMLButtonElement).click());
    expect(requests).toHaveLength(3);
  });
  it("keeps concurrent table requests independent and retains both through late margin hydration", async()=>{
    await act(async()=> (panel('rep').querySelector('button') as HTMLButtonElement).click());
    await act(async()=> (panel('account').querySelector('button') as HTMLButtonElement).click());
    expect(requests).toHaveLength(3);
    expect(requests[1].signal.aborted).toBe(false);
    await respond(2,{...dashboard(30),repBreakdownLoaded:false,accountBreakdownLoaded:true,byAccount:[row('Account A')]});
    expect(panel('account').textContent).not.toContain('Loading');
    expect(panel('rep').textContent).toContain('Loading');
    await respond(1,{...dashboard(30),repBreakdownLoaded:true,accountBreakdownLoaded:false,byRep:[row('Rep A')]});
    await respond(0,dashboard(30)); await respond(3,dashboard(30));
    expect(panel('rep').textContent).toContain('Rep A');
    expect(panel('account').textContent).toContain('Account A');
    expect(requests[3].url).toContain('includeBreakdowns=false');
  });
  it("loads accounts only after selecting a rep, and fetches all accounts when clearing it", async()=>{
    await respond(0,dashboard(30)); await respond(1,dashboard(30));
    await act(async()=> (panel('rep').querySelector('button') as HTMLButtonElement).click());
    await respond(2,{...dashboard(30),repBreakdownLoaded:true,accountBreakdownLoaded:false,byRep:[row('Rep A')]});
    await act(async()=> (panel('rep').querySelector('tbody button') as HTMLElement).click());
    expect(requests[3].url).toContain('rep=Rep+A');
    expect(requests[3].url).toContain('includeRepBreakdown=false');
    expect(requests[3].url).toContain('includeAccountBreakdown=true');
    await respond(3,{...dashboard(30),selectedRep:'Rep A',accountBreakdownLoaded:true,repBreakdownLoaded:false,byAccount:[row('Rep account')]});
    expect(panel('account').textContent).toContain('Rep account');
    await act(async()=> ([...panel('account').querySelectorAll('button')].find(b=>b.textContent==='All Reps')!).click());
    expect(requests[4].url).not.toContain('&rep=');
    expect(requests[4].url).toContain('includeAccountBreakdown=true');
    await respond(4,{...dashboard(30),accountBreakdownLoaded:true,repBreakdownLoaded:false,byAccount:[row('All accounts')]});
    expect(panel('account').textContent).toContain('All accounts');
    expect(panel('rep').textContent).toContain('Rep A');
  });
  it("loads only the open table after a date change and reuses its cache when returning", async()=>{
    await respond(0,dashboard(30)); await respond(1,dashboard(30));
    await act(async()=> (panel('rep').querySelector('button') as HTMLButtonElement).click());
    await respond(2,{...dashboard(30),repBreakdownLoaded:true,accountBreakdownLoaded:false,byRep:[row('September rep')]});
    const preset=controls.querySelector('[aria-label="Date range preset"]') as HTMLSelectElement;
    await act(async()=>{preset.value='Last Month';preset.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(requests[3].url).toContain('includeBreakdowns=false');
    const august=(profit:number|null):CompanyDashboardData=>({...dashboard(profit),period:'custom',dateFrom:'2026-08-01',dateTo:'2026-08-31'});
    await respond(3,august(null));
    expect(requests[4].url).toContain('includeRepBreakdown=true');
    expect(requests[4].url).toContain('includeAccountBreakdown=false');
    expect(requests[5].url).toContain('includeBreakdowns=false');
    await respond(4,{...august(30),repBreakdownLoaded:true,accountBreakdownLoaded:false,byRep:[row('August rep')]});
    await respond(5,august(30)); await respond(6,august(30));
    expect(panel('rep').textContent).toContain('August rep');
    expect(panel('account').querySelector('table')).toBeNull();
    await act(async()=>{preset.value='This Month-to-date';preset.dispatchEvent(new Event('change',{bubbles:true}));});
    expect(panel('rep').textContent).toContain('September rep');
    expect(requests).toHaveLength(7);
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
