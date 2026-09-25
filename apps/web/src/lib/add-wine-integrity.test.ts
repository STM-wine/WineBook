import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260924120000_add_wine_pricing_integrity.sql"
);
const actionPath = path.resolve(process.cwd(), "src/app/actions.ts");
const addWineViewPath = path.resolve(process.cwd(), "src/components/supplier-hub-view.tsx");
const globalStylesPath = path.resolve(process.cwd(), "src/app/globals.css");
const matchRoutePath = path.resolve(process.cwd(), "src/app/api/supplier-wines/matches/route.ts");
const automaticSourceDatesMigrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260924233000_supplier_catalog_automatic_source_dates.sql"
);

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

describe("Add Wine search and price-level UI", () => {
  it("searches active source rows first and exposes an inactive opt-in", async () => {
    const [view, route] = await Promise.all([
      readFile(addWineViewPath, "utf8"),
      readFile(matchRoutePath, "utf8")
    ]);

    expect(view).toContain("Search inactive items too");
    expect(view).toContain('new URL("/api/supplier-wines/matches", window.location.origin)');
    expect(route).toContain('url.searchParams.get("includeInactive") === "true"');
    expect(route).toContain('request = request.eq("is_active", true)');
  });

  it("does not show price decision or owner columns in Add Wine", async () => {
    const view = await readFile(addWineViewPath, "utf8");
    expect(view).not.toContain("<th>Decision</th>");
    expect(view).not.toContain("<th>Owner / approver</th>");
  });

  it("keeps Add Wine price levels focused on final pricing inputs", async () => {
    const view = await readFile(addWineViewPath, "utf8");
    expect(view).toContain("<th>Level</th>");
    expect(view).toContain("<th>Price</th>");
    expect(view).toContain("<th>DA</th>");
    expect(view).toContain("<th>GP</th>");
    expect(view).not.toContain("<th>Target GP</th>");
    expect(view).not.toContain("<th>Solve for</th>");
    expect(view).not.toContain("Source {formatCurrencyCents");
  });

  it("keeps search matches in a scrolling overlay with one consistent action", async () => {
    const [view, styles] = await Promise.all([
      readFile(addWineViewPath, "utf8"),
      readFile(globalStylesPath, "utf8")
    ]);

    expect(view).toContain('className="catalog-match-results"');
    expect(view).toContain('className="button button-small catalog-inactive-search-button"');
    expect(view).toContain("Start From");
    expect(view).not.toContain("Link QB");
    expect(styles).toMatch(/\.catalog-match-suggestions\s*\{[\s\S]*?position:\s*absolute;/);
    expect(styles).toMatch(/\.catalog-match-results\s*\{[\s\S]*?max-height:\s*332px;[\s\S]*?overflow-y:\s*auto;/);
  });

  it("keeps source dates backend-owned and clears the form only after a successful save", async () => {
    const [view, action, sql] = await Promise.all([
      readFile(addWineViewPath, "utf8"),
      readFile(actionPath, "utf8"),
      readFile(automaticSourceDatesMigrationPath, "utf8")
    ]);

    expect(view).not.toContain("FOB source date");
    expect(view).not.toContain("Laid-in source date");
    expect(view).toContain("clearForm");
    expect(action).not.toContain("fobSourceDate: input.fobSourceDate");
    expect(action).not.toContain("laidInSourceDate: input.laidInSourceDate");
    expect(sql).toContain("America/Phoenix");
    expect(sql).toContain("old.fob_source_date");
    expect(sql).toContain("old.laid_in_source_date");
  });
});
