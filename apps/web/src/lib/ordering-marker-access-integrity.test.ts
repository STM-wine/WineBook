import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260924230000_buyer_ordering_marker_access.sql"
);
const dashboardPath = path.resolve(process.cwd(), "src/components/order-dashboard.tsx");

describe("buyer ordering marker integration", () => {
  it("grants buyer and admin roles read, insert, and update access without granting delete", async () => {
    const sql = await readFile(migrationPath, "utf8");

    expect(sql.match(/profile\.role in \('buyer', 'admin'\)/g)).toHaveLength(4);
    expect(sql).toContain('for select');
    expect(sql).toContain('for insert');
    expect(sql).toContain('for update');
    expect(sql).not.toContain('for delete');
  });

  it("refreshes other buyers when an ordering marker changes", async () => {
    const dashboard = await readFile(dashboardPath, "utf8");

    expect(dashboard).toContain('{ event: "*", schema: "public", table: "ordering_item_markers" }');
    expect(dashboard).toContain('() => scheduleDraftRefresh()');
  });
});
