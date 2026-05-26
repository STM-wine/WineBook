import { NextResponse } from "next/server";
import { applyDiContainerRecommendations } from "@/lib/di-planning";
import { asNumber } from "@/lib/order-data";
import { loadImporterDefaults, mergeSupplierDefaults } from "@/lib/supplier-defaults";
import { createClient } from "@/lib/supabase/server";
import type { Recommendation, SupplierLogistics } from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);
const ACTIVE_PO_STATUSES = ["draft", "ready_for_entry"];

function normalizeSupplier(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

async function requireWriteAccess() {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return { error: "Sign in required.", status: 401 as const };
  }

  const { data: profile } = await supabase
    .from("app_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  if (!profile || !WRITE_ROLES.has(profile.role)) {
    return { error: "Buyer or admin access required.", status: 403 as const };
  }

  return { supabase, user };
}

export async function POST(request: Request) {
  const body = (await request.json().catch(() => null)) as { reportRunId?: string } | null;
  const reportRunId = body?.reportRunId;

  if (!reportRunId) {
    return NextResponse.json({ error: "Missing report run id." }, { status: 400 });
  }

  const access = await requireWriteAccess();
  if ("error" in access) {
    return NextResponse.json({ error: access.error }, { status: access.status });
  }

  const { supabase, user } = access;

  const { data: activeDrafts, error: activeDraftsError } = await supabase
    .from("purchase_order_drafts")
    .select("supplier_name")
    .eq("report_run_id", reportRunId)
    .in("status", ACTIVE_PO_STATUSES);

  if (activeDraftsError) {
    return NextResponse.json({ error: activeDraftsError.message }, { status: 500 });
  }

  const activeSuppliers = new Set(
    (activeDrafts || []).map((draft) => draft.supplier_name?.trim()).filter(Boolean)
  );

  const { data: recommendations, error: recommendationsError } = await supabase
    .from("reorder_recommendations")
    .select("*")
    .eq("report_run_id", reportRunId)
    .returns<Recommendation[]>();

  if (recommendationsError) {
    return NextResponse.json({ error: recommendationsError.message }, { status: 500 });
  }

  const grouped = new Map<string, Recommendation[]>();
  const poRows = applyDiContainerRecommendations(recommendations || []).filter(
    (row) =>
      ["approved", "edited"].includes(row.recommendation_status || "") &&
      Math.round(asNumber(row.approved_qty)) > 0
  );

  for (const row of poRows) {
    const supplier = row.supplier_name?.trim() || "Unassigned";
    if (activeSuppliers.has(supplier)) continue;
    const rows = grouped.get(supplier) || [];
    rows.push(row);
    grouped.set(supplier, rows);
  }

  const created: string[] = [];
  const skipped = Array.from(activeSuppliers).map((supplier) => `${supplier}: active draft already exists`);
  const errors: string[] = [];
  const { data: supplierRows } = await supabase
    .from("suppliers")
    .select("name,trucking_cost_per_bottle,pick_up_location,eta_days,freight_forwarder,notes")
    .returns<SupplierLogistics[]>();
  const supplierDefaults = await loadImporterDefaults();
  const suppliers = mergeSupplierDefaults(supplierRows || [], supplierDefaults);
  const supplierMetadata = new Map(suppliers.map((row) => [normalizeSupplier(row.name), row]));

  for (const [supplier, rows] of grouped.entries()) {
    const metadata = supplierMetadata.get(normalizeSupplier(supplier));
    const { data: draft, error: draftError } = await supabase
      .from("purchase_order_drafts")
      .insert({
        supplier_name: supplier,
        report_run_id: reportRunId,
        status: "draft",
        notes: [
          "Created from global PO Drafts action.",
          metadata?.pick_up_location ? `Pickup: ${metadata.pick_up_location}.` : "",
          metadata?.eta_days ? `ETA: ${metadata.eta_days} days.` : ""
        ]
          .filter(Boolean)
          .join(" "),
        created_by: user.id
      })
      .select("id")
      .single<{ id: string }>();

    if (draftError || !draft) {
      errors.push(`${supplier}: ${draftError?.message || "Could not create draft."}`);
      continue;
    }

    const linePayloads = rows.map((row) => {
      const approvedQty = Math.max(0, Math.round(asNumber(row.approved_qty)));
      const recommendedQty = Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
      const fob = asNumber(row.fob);
      const supplierTrucking = asNumber(metadata?.trucking_cost_per_bottle);
      const trucking = asNumber(row.trucking_cost_per_bottle) || supplierTrucking;
      const wineCost = fob * approvedQty;
      const laidInCost = trucking * approvedQty;

      return {
        purchase_order_draft_id: draft.id,
        recommendation_id: row.id,
        product_name: row.product_name,
        product_code: row.product_code,
        planning_sku: row.planning_sku,
        recommended_qty: recommendedQty,
        approved_qty: approvedQty,
        fob,
        trucking_cost_per_bottle: trucking,
        wine_cost: wineCost,
        laid_in_cost: laidInCost,
        landed_cost: wineCost + laidInCost,
        line_cost: wineCost
      };
    });

    const { error: linesError } = await supabase.from("purchase_order_lines").insert(linePayloads);
    if (linesError) {
      errors.push(`${supplier}: ${linesError.message}`);
      continue;
    }

    created.push(supplier);
  }

  return NextResponse.json({ created, skipped, errors });
}
