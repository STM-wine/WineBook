import { NextRequest, NextResponse } from "next/server";
import { poTemplateXlsxBuffer } from "@/lib/po-export";
import { poTimestamp } from "@/lib/po-utils";
import { loadImporterDefaults, mergeSupplierDefaults } from "@/lib/supplier-defaults";
import { createClient } from "@/lib/supabase/server";
import type { PurchaseOrderDraftWithLines, SupplierLogistics } from "@/lib/types";

export async function GET(request: NextRequest) {
  const reportRunId = request.nextUrl.searchParams.get("reportRunId");
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

  const { data: drafts, error } = await supabase
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
        landed_cost
      )
    `)
    .eq("report_run_id", reportRunId)
    .neq("status", "cancelled")
    .order("supplier_name", { ascending: true })
    .returns<PurchaseOrderDraftWithLines[]>();

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const { data: suppliers } = await supabase
    .from("suppliers")
    .select("id,importer_id,name,eta_days,pick_up_location,freight_forwarder,order_frequency,tdm,trucking_cost_per_bottle,notes,active")
    .returns<SupplierLogistics[]>();
  const supplierDefaults = await loadImporterDefaults();
  const mergedSuppliers = mergeSupplierDefaults(suppliers || [], supplierDefaults);

  const buffer = await poTemplateXlsxBuffer(drafts || [], mergedSuppliers);
  const filename = `POs ${poTimestamp()}.xlsx`;

  return new NextResponse(buffer, {
    headers: {
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Cache-Control": "no-store"
    }
  });
}
