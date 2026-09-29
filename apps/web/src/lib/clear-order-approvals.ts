import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { ApprovalSaveResult } from "./types";

export type ApprovalClearScope = { reportRunId: string; supplier?: string };
export type ApprovalClearRow = { sourceType: "recommendation" | "catalog_workbench"; id: string; lockVersion: number };
export type ApprovalClearPreview = { scope: ApprovalClearScope; rows: ApprovalClearRow[]; bottles: number; supplierCount: number };
type SavedApproval = { id: string; lock_version: number; approved_qty: number; supplier_name?: string | null;
  wine?: { supplier_name: string | null } | null };

// Read only saved approval identities, not the expensive recommendation calculations.
export async function previewOrderApprovalClear(db: SupabaseClient, scope: ApprovalClearScope): Promise<ApprovalClearPreview> {
  if (!scope.reportRunId || scope.supplier === "") throw new Error("Missing approval scope.");
  async function read(table: string, select: string) {
    const rows: SavedApproval[] = [];
    for (let start = 0; ; start += 1000) {
      const { data, error } = await db.from(table).select(select).eq("report_run_id", scope.reportRunId)
        .in("recommendation_status", ["approved", "edited"]).order("id").range(start, start + 999);
      if (error) throw new Error(error.message);
      const page = (data || []) as unknown as SavedApproval[];
      rows.push(...page);
      if (page.length < 1000) return rows;
    }
  }
  const [recommendations, catalog] = await Promise.all([
    read("reorder_recommendations", "id,lock_version,approved_qty,supplier_name"),
    read("supplier_catalog_workbench_items", "id,lock_version,approved_qty,wine:supplier_catalog_wines!inner(supplier_name)")
  ]);
  const suppliers = new Set<string>();
  const rows: ApprovalClearRow[] = [];
  let bottles = 0;
  for (const [sourceType, entries] of [["recommendation", recommendations], ["catalog_workbench", catalog]] as const) {
    for (const row of entries) {
      const supplier = (sourceType === "recommendation" ? row.supplier_name : row.wine?.supplier_name)?.trim() || "Unknown Supplier";
      if (scope.supplier !== undefined && supplier !== scope.supplier) continue;
      rows.push({ sourceType, id: row.id, lockVersion: Number(row.lock_version) });
      suppliers.add(supplier);
      bottles += Number(row.approved_qty) || 0;
    }
  }
  return { scope, rows, bottles, supplierCount: suppliers.size };
}

export async function clearSavedOrderApprovals(db: SupabaseClient, preview: ApprovalClearPreview) {
  const current = await previewOrderApprovalClear(db, preview.scope);
  const expected = new Map(preview.rows.map(row => [`${row.sourceType}:${row.id}`, row.lockVersion]));
  if (expected.size !== preview.rows.length || current.rows.length !== expected.size ||
      current.rows.some(row => expected.get(`${row.sourceType}:${row.id}`) !== row.lockVersion)) {
    throw new Error("Approvals changed since this confirmation opened. Nothing was cleared. Close this dialog and review again.");
  }
  if (!current.rows.length) return { cleared: 0 };
  // One transaction: version conflicts reject the whole batch and every change gets an audit event.
  const { data, error } = await db.rpc("save_order_approvals", { p_updates: current.rows.map(row => ({
    sourceType: row.sourceType, id: row.id, recommendationStatus: "rejected", approvedQty: 0,
    expectedLockVersion: row.lockVersion
  })) });
  if (error) throw new Error(error.message);
  const result = data as ApprovalSaveResult;
  if (!result?.ok) throw new Error("Another buyer changed an approval. Nothing was cleared. Close this dialog and review again.");
  return { cleared: result.saved.length };
}
