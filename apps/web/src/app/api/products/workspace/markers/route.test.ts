import { beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";
const state = vi.hoisted(() => ({ role: "buyer", signedIn: true, enabled: true, permissions: [] as {permission: string}[], saved: null as Record<string, unknown> | null, permissionReads: 0 }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({
    auth: { getUser: async () => ({ data: { user: state.signedIn ? {id:"buyer-id"} : null } }) },
    from: (table: string) => {
      const query = {
        select: () => query, eq: () => query,
        maybeSingle: async () => ({data: state.enabled ? {id:"buyer-id",role:state.role} : null, error:null}),
        returns: async () => { state.permissionReads++; return {data:state.permissions,error:null}; }
      };
      if(table !== "app_profiles" && table !== "app_profile_permissions") throw Error(`Unexpected auth table ${table}`);
      return query;
    }
  }),
  createServiceRoleClient: () => ({ from: () => {
    const query = { select: () => query, eq: () => query,
      maybeSingle: async () => ({data:state.saved,error:null}),
      upsert: async (values: Record<string,unknown>) => {state.saved=values;return {error:null};}
    };
    return query;
  } })
}));
const request = (recommendationsSuppressed = true) => new Request("https://example.test/api/products/workspace/markers", {
  method:"POST", body:JSON.stringify({itemCode:"wine-1",replenishmentPolicy:"Core",recommendationsSuppressed,suppressionReason:"End of Vintage"})
});
beforeEach(() => Object.assign(state,{role:"buyer",signedIn:true,enabled:true,permissions:[],saved:null,permissionReads:0}));
describe("intrinsic buyer replenishment access", () => {
  it.each(["buyer","admin"])("allows %s to change policy and turn automatic recommendations off/on with no settings grants", async (role) => {
    state.role=role;
    for(const suppressed of [true,false]) {
      const response=await POST(request(suppressed));
      expect(response.status).toBe(200);
      expect((await response.json()).orderingMarker).toMatchObject({replenishmentPolicy:"Core",recommendationsSuppressed:suppressed,updatedBy:"buyer-id"});
      expect(state.saved).toMatchObject({replenishment_policy:"Core",recommendations_suppressed:suppressed,updated_by:"buyer-id",suppression_changed_by:"buyer-id"});
    }
    expect(state.permissionReads).toBe(0);
  });
  it("rejects a viewer even with permission to view settings", async () => {
    state.role="viewer";state.permissions=[{permission:"view_settings"}];
    expect((await POST(request())).status).toBe(403);expect(state.saved).toBeNull();
  });
  it("preserves explicit marker-management grants for other roles", async () => {
    state.role="viewer";state.permissions=[{permission:"draft_logic_changes"}];
    expect((await POST(request())).status).toBe(200);
  });
  it("still requires a signed-in, enabled account", async () => {
    state.signedIn=false;expect((await POST(request())).status).toBe(401);
    state.signedIn=true;state.enabled=false;expect((await POST(request())).status).toBe(403);
    expect(state.saved).toBeNull();
  });
});
