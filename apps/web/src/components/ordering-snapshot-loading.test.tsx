// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";
import { OrderingSnapshotHome } from "./ordering-snapshot-home";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("./app-topbar", () => ({ AppTopbar: () => <nav>Navigation</nav> }));
vi.mock("./order-dashboard", () => ({ OrderDashboard: () => <div>Supplier editor</div> }));
vi.mock("@/lib/supabase/client", () => ({ createClient: () => {
  const channel = { on: () => channel, subscribe: () => channel };
  return { channel: () => channel, removeChannel: vi.fn() };
} }));
let host: HTMLDivElement, root: Root;
let requests: Array<{ url: string; signal: AbortSignal; resolve: (value: unknown) => void }>;
const summary = { snapshotId: "previous", isStale: true, generatedAt: "2026-09-27T04:25:00Z", salesReferenceDate: "2026-09-26",
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
  it("stops polling when navigating away while a previous overview is displayed", async () => {
    await respond(0,202,{pending:true,stage:"Verifying sources",previousSummary:summary});
    await act(async () => root.render(<div>Another page</div>));
    expect(requests[0].signal.aborted).toBe(true);
    await act(async () => vi.advanceTimersByTimeAsync(4000));
    expect(requests).toHaveLength(1);
  });
});
