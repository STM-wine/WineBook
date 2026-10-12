import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { orderingRunNeedsSourceRefresh } from "./ordering-source-refresh";

describe("ordering source refresh", () => {
  it("rebuilds when either source completed after the ordering run", () => {
    expect(orderingRunNeedsSourceRefresh("2026-09-15T16:02:03Z", "2026-10-12T18:38:29Z")).toBe(true);
    expect(orderingRunNeedsSourceRefresh("2026-10-12T18:38:30Z", "2026-10-12T18:38:29Z")).toBe(false);
    expect(orderingRunNeedsSourceRefresh(null, "2026-10-12T18:38:29Z")).toBe(true);
  });
});
