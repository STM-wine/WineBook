import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { PurchaseOrderDraftWithLines, PurchaseOrderLine, PurchaseOrderLineNote, PurchaseOrderDraftRevision } from "./types";
import { fetchAllExact } from "./supabase/fetch-all-exact";

export async function fetchDraftSummaries(db: SupabaseClient, runId: string): Promise<PurchaseOrderDraftWithLines[]> {
  const summaries = await fetchAllExact<Omit<PurchaseOrderDraftWithLines, "lines">>("PO summaries", (from, to) => db
    .from("purchase_order_draft_summaries").select("*", { count: "exact" }).eq("report_run_id", runId)
    .order("created_at", { ascending: false }).order("id").range(from, to) as never);
  return summaries.map((draft) => ({ ...draft, lines: [], detailLoaded: false }));
}

export async function fetchDraftDetail(db: SupabaseClient, runId: string, id: string): Promise<PurchaseOrderDraftWithLines> {
  const { data: draft, error } = await db.from("purchase_order_drafts").select("*").eq("id", id).eq("report_run_id", runId).single();
  if (error) throw new Error(error.message);
  const [lines, notes, revisions] = await Promise.all([
    fetchAllExact<PurchaseOrderLine>("PO lines", (from, to) => db.from("purchase_order_lines").select("*", { count: "exact" })
      .eq("purchase_order_draft_id", id).order("id").range(from, to) as never),
    fetchAllExact<PurchaseOrderLineNote>("PO notes", (from, to) => db.from("purchase_order_line_notes").select("*", { count: "exact" })
      .eq("report_run_id", runId).eq("purchase_order_draft_id", id).order("created_at").order("id").range(from, to) as never),
    fetchAllExact<PurchaseOrderDraftRevision>("PO history", (from, to) => db.from("purchase_order_draft_revisions")
      .select("id,purchase_order_draft_id,revision_no,created_by,created_at", { count: "exact" })
      .eq("purchase_order_draft_id", id).order("revision_no").order("id").range(from, to) as never)
  ]);
  const { data: current, error: versionError } = await db.from("purchase_order_drafts").select("revision_no,updated_at")
    .eq("id", id).eq("report_run_id", runId).single();
  if (versionError || current.revision_no !== draft.revision_no || current.updated_at !== draft.updated_at) {
    throw new Error("Draft changed while loading. Retry for the current revision.");
  }
  return { ...draft, lines, line_notes: notes, revisions, detailLoaded: true };
}
