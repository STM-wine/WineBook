// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OrderingSnapshotHome } from "./ordering-snapshot-home";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./app-topbar", () => ({ AppTopbar: () => <nav>Navigation</nav> }));
vi.mock("./order-dashboard", () => ({ OrderDashboard: ({ summaryFilters }: { summaryFilters?: { search: string; brandManager: string } }) => <div data-testid="supplier-editor" data-search={summaryFilters?.search} data-tdm={summaryFilters?.brandManager}>Supplier editor</div> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { channel: () => channel, removeChannel: vi.fn() };
} }));
let host: HTMLDivElement, root: Root;
let requests: Array<{ url: string; signal: AbortSignal; resolve: (value: unknown) => void }>;
const summary = { snapshotId: "previous", isStale: true, generatedAt: "2026-09-27T04:25:00Z", salesReferenceDate: "2026-09-26",
  filterOptions: { suppliers: ["Example supplier"], tdms: ["ROJO"] },
  reportRun: { id: "run" }, metrics: { urgent: 1, low: 2, recommendedBottles: 12, approvedBottles: 6, poValue: 60, supplierCount: 1 },
  groups: [{ supplier: "Example supplier", skuCount: 1, urgentCount: 1, freeGoodProgramCount: 0, recommendedBottles: 12, approvedBottles: 6, suggestedValue: 120, approvedValue: 60 }] };
async function respond(index: number, status: number, body: unknown) {
  await act(async () => requests[index].resolve({ status, ok: status < 400, json: async () => body }));
}
beforeEach(async () => {
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: {signal: AbortSignal}) => new Promise((resolve) => requests.push({url, signal:init.signal,resolve}))));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<OrderingSnapshotHome view="order-review" canViewSettings={false} />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("ordering summary during background preparation", () => {
  it("rechecks a loaded warning and clears it only after a verified replacement arrives", async () => {
    await respond(0,200,{...summary,isStale:false,warning:"QuickBooks refresh is still in progress."});
    await act(async()=>vi.advanceTimersByTimeAsync(30_000));
    expect(requests).toHaveLength(2);
    expect(host.textContent).toContain("QuickBooks refresh is still in progress.");
    expect(host.textContent).not.toContain("Loading supplier summaries");
    // A slow refresh must not be aborted/restarted by the next interval or focus.
    await act(async()=>{window.dispatchEvent(new Event('focus'));await vi.advanceTimersByTimeAsync(30_000);});
    expect(requests).toHaveLength(2);
    expect(requests[1].signal.aborted).toBe(false);
    await respond(1,202,{pending:true,stage:"Verifying sources"});
    expect(host.textContent).toContain("QuickBooks refresh is still in progress.");
    await act(async()=>vi.advanceTimersByTimeAsync(2000));
    await respond(2,200,{...summary,isStale:false,snapshotId:"updated",warning:null});
    expect(host.textContent).not.toContain("QuickBooks refresh is still in progress.");
    expect(host.textContent).not.toContain("Verifying sources");
  });
  it("refreshes on return to a visible tab, skips hidden checks, and cleans up on navigation", async () => {
    await respond(0,200,{...summary,isStale:false});
    const visibility=vi.spyOn(document,'visibilityState','get').mockReturnValue('hidden');
    await act(async()=>{await vi.advanceTimersByTimeAsync(60_000);window.dispatchEvent(new Event('focus'));});
    expect(requests).toHaveLength(1);
    visibility.mockReturnValue('visible');
    await act(async()=>{document.dispatchEvent(new Event('visibilitychange'));window.dispatchEvent(new Event('focus'));});
    expect(requests).toHaveLength(2);
    await respond(1,200,{...summary,isStale:false});
    await act(async()=>vi.advanceTimersByTimeAsync(60_000));
    expect(requests).toHaveLength(3);
    await act(async()=>root.render(<div>Another page</div>));
    expect(requests[2].signal.aborted).toBe(true);
    await act(async()=>{await vi.advanceTimersByTimeAsync(120_000);window.dispatchEvent(new Event('focus'));});
    expect(requests).toHaveLength(3);
    visibility.mockRestore();
  });
  it("renders the previous overview without enabling stale supplier editing, then enables current data", async () => {
    await respond(0,202,{pending:true,stage:"Verifying sources",previousSummary:summary});
    expect(host.textContent).toContain("Example supplier");
    expect(host.textContent).toContain("last verified summary");
    const disclosure = host.querySelector('details > summary') as HTMLElement;
    expect(disclosure.getAttribute('aria-disabled')).toBe('true');
    await act(async () => disclosure.click());
    expect(requests).toHaveLength(1);
    expect(host.textContent).not.toContain("Supplier editor");
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await respond(1,200,{...summary,snapshotId:"current",isStale:false});
    expect(host.querySelector('details > summary')?.getAttribute('aria-disabled')).toBe('false');
    expect(host.textContent).not.toContain("Supplier editing will be available");
    await act(async () => {
      const details = host.querySelector('details')!;
      details.open = true; details.dispatchEvent(new Event('toggle'));
    });
    expect(requests[2].url).toContain('supplier=Example%20supplier');
  });
  it("searches unopened suppliers globally and passes the selected TDM and wine query to an opened editor", async () => {
    await respond(0,200,{...summary,isStale:false});
    const tdm = [...host.querySelectorAll('select')].find((select)=>select.parentElement?.textContent?.startsWith('TDM'))!;
    const input = host.querySelector('input[placeholder="Wine, supplier, item #"]') as HTMLInputElement;
    await act(async()=>{
      tdm.value='ROJO';tdm.dispatchEvent(new Event('change',{bubbles:true}));
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value')!.set!.call(input,'Pinot');
      input.dispatchEvent(new Event('input',{bubbles:true}));
    });
    await act(async()=>vi.advanceTimersByTimeAsync(250));
    expect(requests).toHaveLength(2);
    expect(requests[1].url).toContain('tdm=ROJO');expect(requests[1].url).toContain('search=Pinot');
    expect(requests.some((r)=>r.url.includes('?supplier='))).toBe(false);
    const filters={supplier:'All',brandManager:'ROJO',search:'Pinot',suggestedOnly:false};
    await respond(1,200,{...summary,isStale:false,filters});
    await act(async()=>{const details=host.querySelector('details')!;details.open=true;details.dispatchEvent(new Event('toggle'));});
    await respond(2,200,{latestRun:{id:'run'},generatedAt:summary.generatedAt});
    const editor=host.querySelector('[data-testid="supplier-editor"]') as HTMLElement;
    expect(editor.dataset.search).toBe('Pinot');expect(editor.dataset.tdm).toBe('ROJO');
    expect(host.querySelectorAll('h1')).toHaveLength(1);
  });
  it("stops polling when navigating away while a previous overview is displayed", async () => {
    await respond(0,202,{pending:true,stage:"Verifying sources",previousSummary:summary});
    await act(async () => root.render(<div>Another page</div>));
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(requests).toHaveLength(1);
  });
});
