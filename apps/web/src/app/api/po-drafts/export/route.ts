import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { poCsvBuffer } from "@/lib/po-csv-export";
import { poTemplateXlsxBuffer } from "@/lib/po-export";
import { hydratePoExportProducers, loadPoExportPrices } from "@/lib/po-export-server";
import { poDraftSupplierLabel, poTimestamp } from "@/lib/po-utils";
import { ACTIVE_PO_STATUSES } from "@/lib/po-status";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import type { PurchaseOrderDraftWithLines, PurchaseOrderLine, SupplierLogistics } from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);

type ExportInput = {
  reportRunId?: string;
  draftIds?: string[];
  format?: "xlsx" | "csv";
  scope?: "single" | "selected" | "all";
};

type DraftRow = Omit<PurchaseOrderDraftWithLines, "lines">;
type RevisionRow = {
  purchase_order_draft_id: string;
  revision_no: number;
  content_hash: string;
  draft_snapshot: Record<string, unknown>;
  lines_snapshot: PurchaseOrderLine[];
};

function exportFilename(drafts: PurchaseOrderDraftWithLines[], format: "xlsx" | "csv", scope: ExportInput["scope"]) {
  const extension = format;
  if (scope === "single" && drafts[0]) {
    const supplier = poDraftSupplierLabel(drafts[0]).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "") || "supplier";
    return `PO ${supplier} ${poTimestamp()}.${extension}`;
  }
  return `POs${scope === "selected" ? " selected" : ""} ${poTimestamp()}.${extension}`;
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as ExportInput | null;
  const reportRunId = body?.reportRunId;
  const format = body?.format;
  const scope = body?.scope;
  const requestedDraftIds = Array.from(new Set((body?.draftIds || []).filter(Boolean)));
  if (!reportRunId || !format || !scope || !["xlsx", "csv"].includes(format) || !["single", "selected", "all"].includes(scope)) {
    return NextResponse.json({ error: "A valid report run, format, and export scope are required." }, { status: 400 });
  }
  if (scope !== "all" && requestedDraftIds.length === 0) {
    return NextResponse.json({ error: "Select at least one PO draft." }, { status: 400 });
  }

  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  const { data: profile } = await supabase.from("app_profiles").select("role").eq("id", user.id).maybeSingle<{ role: string }>();
  if (!profile || !WRITE_ROLES.has(profile.role)) {
    return NextResponse.json({ error: "Buyer or admin access required." }, { status: 403 });
  }

  let draftsQuery = supabase
    .from("purchase_order_drafts")
    .select("id,report_run_id,ordering_source,source_snapshot,supplier_name,order_path,status,po_number,notes,revision_no,content_hash,last_exported_at,last_exported_by,created_at,updated_at")
    .eq("report_run_id", reportRunId)
    .in("status", [...ACTIVE_PO_STATUSES])
    .order("supplier_name", { ascending: true });
  if (scope !== "all") draftsQuery = draftsQuery.in("id", requestedDraftIds);
  const { data: draftRows, error: draftError } = await draftsQuery.returns<DraftRow[]>();
  if (draftError) return NextResponse.json({ error: draftError.message }, { status: 500 });
  if (!draftRows?.length) return NextResponse.json({ error: "No active PO drafts matched this export." }, { status: 404 });
  if (scope === "single" && draftRows.length !== 1) {
    return NextResponse.json({ error: "A single export must contain exactly one PO draft." }, { status: 400 });
  }

  const { data: revisionRows, error: revisionError } = await supabase
    .from("purchase_order_draft_revisions")
    .select("purchase_order_draft_id,revision_no,content_hash,draft_snapshot,lines_snapshot")
    .in("purchase_order_draft_id", draftRows.map((draft) => draft.id))
    .returns<RevisionRow[]>();
  if (revisionError) return NextResponse.json({ error: revisionError.message }, { status: 500 });
  const revisions = new Map((revisionRows || []).map((revision) => [`${revision.purchase_order_draft_id}:${revision.revision_no}`, revision]));

  const missingRevision = draftRows.find((draft) => !revisions.has(`${draft.id}:${Number(draft.revision_no)}`));
  if (missingRevision) {
    return NextResponse.json({ error: `PO draft ${missingRevision.id} has no immutable current revision. Rebuild the drafts before exporting.` }, { status: 409 });
  }

  let exportDrafts: PurchaseOrderDraftWithLines[] = draftRows.map((draft) => {
    const revision = revisions.get(`${draft.id}:${Number(draft.revision_no)}`)!;
    return { ...draft, ...(revision.draft_snapshot as Partial<PurchaseOrderDraftWithLines>), lines: revision.lines_snapshot || [] };
  });
  const integrationSupabase = createServiceRoleClient();
  let buffer: Buffer;
  let filename = exportFilename(exportDrafts, format, scope);
  const exactRevisions = exportDrafts.map((draft) => {
    const revision = revisions.get(`${draft.id}:${Number(draft.revision_no)}`)!;
    return { draftId: draft.id, revisionNo: revision.revision_no, contentHash: revision.content_hash };
  });
  const exactLines = exportDrafts.flatMap((draft) => (draft.lines || []).map((line) => ({
    draftId: draft.id,
    draftRevisionNo: Number(draft.revision_no),
    lineId: line.id,
    sourceType: line.source_type,
    sourceId: line.source_id,
    sourceLockVersion: line.source_lock_version,
    recommendationId: line.recommendation_id,
    supplierCatalogWineId: line.supplier_catalog_wine_id,
    approvedQty: line.approved_qty,
    productCode: line.product_code,
    productName: line.product_name
  })));

  try {
    exportDrafts = await hydratePoExportProducers(integrationSupabase, exportDrafts);
    const { data: suppliers, error: supplierError } = await supabase
      .from("suppliers")
      .select("id,importer_id,name,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle,notes,active")
      .returns<SupplierLogistics[]>();
    if (supplierError) throw new Error(supplierError.message);
    if (format === "xlsx") {
      const prices = await loadPoExportPrices(integrationSupabase, exportDrafts);
      buffer = await poTemplateXlsxBuffer(exportDrafts, suppliers || [], prices);
    } else {
      buffer = poCsvBuffer(exportDrafts, suppliers || []);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "PO export generation failed.";
    await supabase.from("purchase_order_export_events").insert({
      report_run_id: reportRunId,
      actor_id: user.id,
      format,
      export_scope: scope,
      draft_revisions: exactRevisions,
      line_snapshots: exactLines,
      content_hash: null,
      filename,
      generation_status: "failed",
      error_message: message
    });
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const contentHash = createHash("sha256").update(buffer).digest("hex");
  const generatedAt = new Date().toISOString();
  const { data: exportEvent, error: auditError } = await supabase
    .from("purchase_order_export_events")
    .insert({
      report_run_id: reportRunId,
      actor_id: user.id,
      format,
      export_scope: scope,
      draft_revisions: exactRevisions,
      line_snapshots: exactLines,
      content_hash: contentHash,
      filename,
      generation_status: "succeeded",
      error_message: null,
      generated_at: generatedAt
    })
    .select("id")
    .single<{ id: string }>();
  if (auditError || !exportEvent) {
    return NextResponse.json({ error: auditError?.message || "The export could not be audited, so no file was released." }, { status: 500 });
  }

  await Promise.all(exactRevisions.map((revision) => supabase
    .from("purchase_order_drafts")
    .update({ last_exported_at: generatedAt, last_exported_by: user.id })
    .eq("id", revision.draftId)
    .eq("revision_no", revision.revisionNo)));

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": format === "xlsx"
        ? "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
        : "text/csv; charset=utf-8",
      "Cache-Control": "no-store",
      "X-PO-Export-Event": exportEvent.id,
      "X-PO-Content-SHA256": contentHash
    }
  });
}
