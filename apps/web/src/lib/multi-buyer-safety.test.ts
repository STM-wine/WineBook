import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { poCsvBuffer } from "./po-csv-export";
import type { PurchaseOrderDraftWithLines } from "./types";

const migrationPath = path.resolve(
  process.cwd(),
  "../../supabase/migrations/20260922233000_multi_buyer_po_integrity.sql"
);
const poExportRoutePath = path.resolve(
  process.cwd(),
  "src/app/api/po-drafts/export/route.ts"
);

describe("multi-buyer database safety contract", () => {
  it("requires versioned, atomic approval writes", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.save_order_approvals");
    expect(sql).toContain("expectedLockVersion");
    expect(sql).toContain("guard_versioned_approval_write");
    expect(sql).toContain("Approval changed without optimistic concurrency control");
    expect(sql).toContain("if jsonb_array_length(v_conflicts) > 0");
  });

  it("enforces idempotent draft and line identity", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create or replace function public.create_purchase_order_drafts_atomic");
    expect(sql).toContain("pg_advisory_xact_lock");
    expect(sql).toContain("uq_active_po_draft_group");
    expect(sql).toContain("uq_po_line_recommendation");
    expect(sql).toContain("uq_po_line_catalog_wine");
    expect(sql).toContain("purchase_order_request_keys");
  });

  it("keeps approval, revision, commitment, and export history separate", async () => {
    const sql = await readFile(migrationPath, "utf8");
    expect(sql).toContain("create table if not exists public.approval_events");
    expect(sql).toContain("create table if not exists public.purchase_order_draft_revisions");
    expect(sql).toContain("create table if not exists public.approval_commitments");
    expect(sql).toContain("create table if not exists public.purchase_order_export_events");
    expect(sql).toContain("prevent_immutable_business_event_change");
    expect(sql).toContain("and source_lock_version = (v_line->>'sourceLockVersion')::bigint");
  });
});

describe("server CSV export", () => {
  it("uses the server-only integration client for export enrichment", async () => {
    const route = await readFile(poExportRoutePath, "utf8");
    expect(route).toContain("const integrationSupabase = createServiceRoleClient()");
    expect(route).toContain("hydratePoExportProducers(integrationSupabase, exportDrafts)");
  });

  it("generates the audited artifact from the supplied immutable revision lines", () => {
    const draft: PurchaseOrderDraftWithLines = {
      id: "draft-1",
      report_run_id: "run-1",
      supplier_name: "North Berkeley",
      order_path: "stateside",
      status: "draft",
      po_number: null,
      notes: null,
      revision_no: 3,
      created_at: "2026-09-22T00:00:00Z",
      updated_at: "2026-09-22T00:00:00Z",
      lines: [{
        id: "line-1",
        purchase_order_draft_id: "draft-1",
        recommendation_id: "approval-1",
        supplier_catalog_wine_id: null,
        producer_name: "Domaine Test",
        product_name: "Test Wine 2025 12/750ml",
        product_code: "TEST1",
        planning_sku: "test-wine-2025",
        recommended_qty: 12,
        approved_qty: 24,
        fob: 10,
        line_cost: 240,
        trucking_cost_per_bottle: 1,
        wine_cost: 240,
        laid_in_cost: 24,
        landed_cost: 264,
        source_type: "recommendation",
        source_id: "approval-1",
        source_lock_version: 7
      }]
    };

    const csv = poCsvBuffer([draft]).toString("utf8");
    expect(csv).toContain("Supplier,Producer,Wine,Code");
    expect(csv).toContain("North Berkeley,Domaine Test,Test Wine 2025 12/750ml,TEST1");
    expect(csv).toContain(",24,10.00,1.0000,240.00,24.00,264.00");
  });
});
