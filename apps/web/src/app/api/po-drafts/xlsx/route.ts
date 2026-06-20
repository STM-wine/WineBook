import { NextRequest, NextResponse } from "next/server";
import { poTemplateXlsxBuffer } from "@/lib/po-export";
import { ACTIVE_PO_STATUSES } from "@/lib/po-status";
import { poDraftSupplierLabel, poTimestamp } from "@/lib/po-utils";
import { loadImporterDefaults, mergeSupplierDefaults } from "@/lib/supplier-defaults";
import { createClient } from "@/lib/supabase/server";
import type { PurchaseOrderDraftWithLines, SupplierLogistics } from "@/lib/types";

async function hydrateLineProducers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  drafts: PurchaseOrderDraftWithLines[]
) {
  const catalogWineIds = Array.from(
    new Set(
      drafts
        .flatMap((draft) => draft.lines || [])
        .filter((line) => !line.producer_name?.trim())
        .map((line) => line.supplier_catalog_wine_id)
        .filter((id): id is string => typeof id === "string" && id.trim().length > 0)
    )
  );

  if (catalogWineIds.length === 0) {
    return drafts;
  }

  const { data: catalogWines, error } = await supabase
    .from("supplier_catalog_wines")
    .select("id,producer")
    .in("id", catalogWineIds)
    .returns<Array<{ id: string; producer: string | null }>>();

  if (error) {
    throw new Error(error.message);
  }

  const producersById = new Map((catalogWines || []).map((wine) => [wine.id, wine.producer || null]));
  return drafts.map((draft) => ({
    ...draft,
    lines: (draft.lines || []).map((line) => ({
      ...line,
      producer_name: line.producer_name || (line.supplier_catalog_wine_id ? producersById.get(line.supplier_catalog_wine_id) || null : null)
    }))
  }));
}

export async function GET(request: NextRequest) {
  const reportRunId = request.nextUrl.searchParams.get("reportRunId");
  const draftId = request.nextUrl.searchParams.get("draftId");
  const draftIds = (request.nextUrl.searchParams.get("draftIds") || "")
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  if (!reportRunId) {
    return NextResponse.json({ error: "Missing reportRunId." }, { status: 400 });
  }

  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  let draftsQuery = supabase
    .from("purchase_order_drafts")
    .select(`
      id,
      report_run_id,
      supplier_name,
      status,
      po_number,
      notes,
      created_at,
      updated_at,
      lines:purchase_order_lines (
        id,
        purchase_order_draft_id,
        recommendation_id,
        supplier_catalog_wine_id,
        producer_name,
        product_name,
        product_code,
        planning_sku,
        recommended_qty,
        approved_qty,
        fob,
        line_cost,
        trucking_cost_per_bottle,
        wine_cost,
        laid_in_cost,
        landed_cost,
        is_new_item,
        new_item_warning
      )
    `)
    .eq("report_run_id", reportRunId)
    .in("status", [...ACTIVE_PO_STATUSES])
    .order("supplier_name", { ascending: true });

  if (draftId) {
    draftsQuery = draftsQuery.eq("id", draftId);
  } else if (draftIds.length > 0) {
    draftsQuery = draftsQuery.in("id", draftIds);
  }

  const { data: drafts, error } = await draftsQuery.returns<PurchaseOrderDraftWithLines[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  if (draftId && (!drafts || drafts.length === 0)) {
    return NextResponse.json({ error: "PO draft is not active or was not found." }, { status: 404 });
  }

  if (draftIds.length > 0 && (!drafts || drafts.length === 0)) {
    return NextResponse.json({ error: "No active PO drafts matched the selected drafts." }, { status: 404 });
  }

  let exportDrafts: PurchaseOrderDraftWithLines[];
  try {
    exportDrafts = await hydrateLineProducers(supabase, drafts || []);
  } catch (producerError) {
    return NextResponse.json(
      { error: producerError instanceof Error ? producerError.message : "Could not load producer names." },
      { status: 500 }
    );
  }

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id,importer_id,name,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle,notes,active")
    .returns<SupplierLogistics[]>();
  const supplierDefaults = await loadImporterDefaults();
  const mergedSuppliers = mergeSupplierDefaults(suppliers || [], supplierDefaults);

  const buffer = await poTemplateXlsxBuffer(exportDrafts, mergedSuppliers);
  const supplierFilenamePart =
    draftId && exportDrafts[0]
      ? poDraftSupplierLabel(exportDrafts[0])
          .toLowerCase()
          .replace(/[^a-z0-9]+/g, "-")
          .replace(/(^-|-$)/g, "") || "supplier"
      : "all";
  const filename = draftId ? `PO ${supplierFilenamePart} ${poTimestamp()}.xlsx` : `POs ${poTimestamp()}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store"
    }
  });
}
