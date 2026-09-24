import { describe, expect, it } from "vitest";
import { canManageOrderingMarkers } from "./ordering-marker-access";

describe("ordering marker access", () => {
  it.each(["buyer", "admin"])("allows every %s role without an extra settings permission", (role) => {
    expect(canManageOrderingMarkers(role, [])).toBe(true);
  });

  it("keeps the existing explicit permission path", () => {
    expect(canManageOrderingMarkers("viewer", [{ permission: "draft_logic_changes" }])).toBe(true);
    expect(canManageOrderingMarkers("viewer", [{ permission: "manage_supplier_settings" }])).toBe(true);
  });

  it("rejects non-buyers without a marker-management permission", () => {
    expect(canManageOrderingMarkers("viewer", [{ permission: "view_settings" }])).toBe(false);
  });
});
