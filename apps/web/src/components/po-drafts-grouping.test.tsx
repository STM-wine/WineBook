// @vitest-environment jsdom
import { act, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { PoDraftsView } from "./po-drafts-view";

it("groups PO cards by pickup, combines NY/NJ, and restores the original order", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const suppliers = [
    { name: "East", pick_up_location: "NJ" },
    { name: "West", pick_up_location: "California" },
    { name: "East 2", pick_up_location: "New York" }
  ];
  const props = {
    drafts: suppliers.map((supplier, index) => ({ id: String(index), supplier_name: supplier.name, status: "draft", lines: [], created_at: "2026-10-27T12:00:00Z" })),
    suppliers, isPending: false, reportRunId: "run", auditActorNames: {},
    onAddLineNote: vi.fn(), onCancelDrafts: vi.fn(), onDeleteLine: vi.fn(), onStatusChange: vi.fn(), onLoadDetail: vi.fn(), onRefresh: vi.fn()
  } as unknown as ComponentProps<typeof PoDraftsView>;
  try {
    await act(async () => root.render(<PoDraftsView {...props} />));
    const select = [...host.querySelectorAll("select")].find(select => select.parentElement?.textContent?.startsWith("Group by"))!;
    await act(async () => { select.value = "pickup"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect([...host.querySelectorAll(".po-draft-stack h2")].map(h => h.textContent)).toEqual(["California", "NY/NJ"]);
    expect([...host.querySelectorAll(".supplier-chip")].map(h => h.textContent)).toEqual(["West", "East", "East 2"]);
    await act(async () => { select.value = "none"; select.dispatchEvent(new Event("change", { bubbles: true })); });
    expect(host.querySelectorAll(".po-draft-stack h2")).toHaveLength(0);
    expect([...host.querySelectorAll(".supplier-chip")].map(h => h.textContent)).toEqual(["East", "West", "East 2"]);
  } finally {
    await act(async () => root.unmount());
    host.remove();
  }
});
