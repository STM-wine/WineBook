// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OrderingSnapshotHome } from "./ordering-snapshot-home";
const approvalActions = vi.hoisted(() => ({ previewClearOrderApprovals: vi.fn(), clearOrderApprovals: vi.fn() }));
vi.mock("@/app/actions", () => approvalActions);
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./app-topbar", () => ({ AppTopbar: ({ qbDataLabel, dataLabel }: { qbDataLabel?: string; dataLabel?: string }) => <nav>Navigation {dataLabel} {qbDataLabel}</nav> }));
vi.mock("./order-dashboard", () => ({ OrderDashboard: ({ summaryFilters, canManageMarkers }: { canManageMarkers: boolean; summaryFilters?: { search: string; brandManager: string } }) => <div data-testid="supplier-editor" data-can-manage={canManageMarkers} data-search={summaryFilters?.search} data-tdm={summaryFilters?.brandManager}>Supplier editor</div> }));
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
  vi.clearAllMocks();
  vi.useFakeTimers(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); requests = [];
  vi.stubGlobal("fetch", vi.fn((url: string, init: {signal: AbortSignal}) => new Promise((resolve) => requests.push({url, signal:init.signal,resolve}))));
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host);
  await act(async () => root.render(<OrderingSnapshotHome canManageMarkers={true} view="order-review" canViewSettings={false} initialQuickBooksLastSyncAt="2026-09-26T23:28:45Z" initialVinosmithLastSyncAt="2026-09-27T02:37:00Z" />));
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); vi.useRealTimers(); });
describe("ordering summary during background preparation", () => {
  it("loads without showing a progress bar", () => {
    expect(host.textContent).toContain("Loading Order Summary");
    expect(host.querySelector('.wine-loader-bar')).toBeNull();
  });
  it("shows the completed upload in the toolbar while loading, after errors, and after a new snapshot", async () => {
    expect(host.querySelector('nav')?.textContent).toContain("QB Updated Sep 26, 2026, 4:28 PM");
    expect(host.querySelector('nav')?.textContent).toContain("Vinosmith Updated Sep 26, 2026, 7:37 PM");
    await respond(0,503,{error:"Temporarily unavailable"});
    expect(host.querySelector('nav')?.textContent).toContain("QB Updated Sep 26, 2026, 4:28 PM");
    expect(host.querySelector('nav')?.textContent).toContain("Vinosmith Updated Sep 26, 2026, 7:37 PM");
    await act(async()=>[...host.querySelectorAll('button')].find(b=>b.textContent==='Retry')!.click());
    await respond(1,200,{...summary,isStale:false,quickBooksLastSyncAt:"2026-09-28T23:00:00Z",vinosmithLastSyncAt:"2026-09-28T23:15:00Z"});
    expect(host.querySelector('nav')?.textContent).toContain("QB Updated Sep 28, 2026, 4:00 PM");
    expect(host.querySelector('nav')?.textContent).toContain("Vinosmith Updated Sep 28, 2026, 4:15 PM");
    expect(host.textContent).not.toContain("sales through");
  });
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
    expect(host.querySelector('.wine-loader-bar')).toBeNull();
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
  it("keeps supplier rows and PO draft creation available during a background rebuild", async () => {
    await respond(0,202,{pending:true,stage:"Verifying sources",previousSummary:summary});
    expect(host.textContent).toContain("Example supplier");
    expect(host.textContent).toContain("last saved summary");
    const disclosure = host.querySelector('details > summary') as HTMLElement;
    expect(disclosure.getAttribute('aria-disabled')).toBeNull();
    expect([...host.querySelectorAll('button')].find(b => b.textContent === 'Create PO Drafts')?.disabled).toBe(false);
    await act(async () => { const details = host.querySelector('details')!; details.open = true; details.dispatchEvent(new Event('toggle')); });
    expect(requests[1].url).toContain('supplier=Example%20supplier&snapshot=previous');
    await respond(1,200,{latestRun:{id:'run'},recommendations:[],generatedAt:summary.generatedAt});
    expect(host.textContent).toContain("Supplier editor");
    await act(async () => vi.advanceTimersByTimeAsync(2000));
    await respond(2,200,{...summary,snapshotId:"current",isStale:false});
    expect(requests[3].url).toContain('supplier=Example%20supplier&snapshot=current');
  });
  it("creates PO drafts from live source data while the summary worker is still running", async () => {
    await respond(0,202,{pending:true,stage:"Verifying sources",previousSummary:summary});
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Create PO Drafts')!.click());
    expect(requests[1].url).toBe('/api/po-drafts/create');
    await respond(1,200,{created:['draft'],updated:[],skipped:[],errors:[]});
    expect(host.textContent).not.toContain('Could not create PO drafts');
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
    expect(editor.dataset.canManage).toBe('true');
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

describe("approval clearing controls", () => {
  async function mountBuyer() {
    await act(async () => root.render(<OrderingSnapshotHome canClearApprovals={true} canManageMarkers={false} view="order-review" canViewSettings={false} />));
    await respond(0, 200, { ...summary, isStale: false });
    approvalActions.previewClearOrderApprovals.mockImplementation(async scope => ({ scope, rows: [{ sourceType: "recommendation", id: "r1", lockVersion: 2 }], bottles: 6, supplierCount: 1 }));
    approvalActions.clearOrderApprovals.mockResolvedValue({ cleared: 1 });
  }
  it("does not show clearing controls to a read-only user", async () => {
    await respond(0, 200, { ...summary, isStale: false });
    expect(host.textContent).not.toContain("Clear approved");
    expect(host.textContent).not.toContain("Clear all approved");
  });
  it("opens a supplier-scoped confirmation without expanding or loading its workbench; cancel makes no changes", async () => {
    await mountBuyer();
    await act(async () => (host.querySelector('[aria-label="Clear approved orders for Example supplier"]') as HTMLButtonElement).click());
    expect(host.querySelector('details')?.open).toBe(false);
    expect(requests).toHaveLength(1);
    expect(approvalActions.previewClearOrderApprovals).toHaveBeenCalledWith({ reportRunId: "run", supplier: "Example supplier" });
    expect(host.querySelector('[role="dialog"]')?.textContent).toContain("1 saved approval · 6 bottles · 1 supplier");
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Cancel')!.click());
    expect(host.querySelector('[role="dialog"]')).toBeNull();
    expect(approvalActions.clearOrderApprovals).not.toHaveBeenCalled();
  });
  it("global clear ignores filters and refreshes an open supplier even when its snapshot ID stays the same", async () => {
    await mountBuyer();
    const tdm = [...host.querySelectorAll('select')].find(s => s.parentElement?.textContent?.startsWith('TDM'))!;
    await act(async () => { tdm.value = 'ROJO'; tdm.dispatchEvent(new Event('change', { bubbles: true })); await vi.advanceTimersByTimeAsync(250); });
    await respond(1, 200, { ...summary, isStale: false });
    await act(async () => { const d = host.querySelector('details')!; d.open = true; d.dispatchEvent(new Event('toggle')); });
    await respond(2, 200, { latestRun: { id: 'run' }, generatedAt: summary.generatedAt });
    await act(async () => [...host.querySelectorAll('button')].find(b => b.textContent === 'Clear all approved orders')!.click());
    expect(approvalActions.previewClearOrderApprovals).toHaveBeenCalledWith({ reportRunId: "run" });
    await act(async () => (host.querySelector('[role="dialog"] .clear-approvals-button') as HTMLButtonElement).click());
    expect(approvalActions.clearOrderApprovals).toHaveBeenCalledTimes(1);
    expect(requests.slice(3).some(r => r.url.includes('supplier=Example%20supplier'))).toBe(true);
    expect(requests.slice(3).some(r => r.url.includes('supplierFilter=All'))).toBe(true);
    expect(host.textContent).toContain('Cleared 1 saved approvals.');
    expect(host.querySelector('[role="dialog"]')).toBeNull();
  });
});
