import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260924120000_add_wine_pricing_integrity.sql"
);
const actionPath = path.resolve(process.cwd(), "src/app/actions.ts");

describe("Add Wine database safety contract", () => {
  it("uses one versioned and idempotent transaction for the entire save", async () => {
    const [sql, action] = await Promise.all([
      readFile(migrationPath, "utf8"),
      readFile(actionPath, "utf8")
    ]);

    expect(action).toContain('supabase.rpc("save_supplier_catalog_sku_atomic"');
    expect(sql).toContain("security definer");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("p_expected_lock_version");
    expect(sql).toContain("supplier_catalog_save_requests");
    expect(sql).toContain("Idempotency key was already used for a different Add Wine request");
    expect(sql).toContain("This wine changed after you opened it");
  });

  it("keeps pricing metadata and audit history inside that transaction", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql).toContain("is_manual_override");
    expect(sql).toContain("frontline_only");
    expect(sql).toContain("supplier_catalog_events");
    expect(sql).toContain("price_change_events");
    expect(sql).toContain("trg_supplier_catalog_events_immutable");
    expect(sql).toContain("revoke insert, update, delete on public.supplier_catalog_events");
    expect(sql).toContain("revoke execute on function public.save_supplier_catalog_sku");
  });
});
