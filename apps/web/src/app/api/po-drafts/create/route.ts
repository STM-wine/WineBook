import { NextResponse } from "next/server";
import { applyDiContainerRecommendations, diCapacityViolations, orderPath } from "@/lib/di-planning";
import { asNumber } from "@/lib/order-data";
import { formatInteger } from "@/lib/order-data";
import { loadImporterDefaults, mergeSupplierDefaults } from "@/lib/supplier-defaults";
import { createClient } from "@/lib/supabase/server";
import type { Recommendation, SupplierLogistics } from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);
const ACTIVE_PO_STATUSES = ["draft", "ready_for_entry"];

function normalizeSupplier(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

function draftOrderPathFromNotes(notes: string | null | undefined) {
  return /order path:\s*(direct import|di)/i.test(notes || "") ? "di" : "stateside";
}

function draftGroupKey(supplier: string, path: "stateside" | "di") {
  return `${normalizeSupplier(supplier)}::${path}`;
}

function orderPathLabel(path: "stateside" | "di") {
  return path === "di" ? "Direct Import" : "Stateside";
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
    .select("supplier_name,notes")
    .eq("report_run_id", reportRunId)
    .in("status", ACTIVE_PO_STATUSES);

  if (activeDraftsError) {
    return NextResponse.json({ error: activeDraftsError.message }, { status: 500 });
  }

  const activeDraftsBySupplierPath = new Set(
    (activeDrafts || []).map((draft) =>
      draftGroupKey(draft.supplier_name?.trim() || "Unassigned", draftOrderPathFromNotes(draft.notes))
    )
  );

  const { data: recommendations, error: recommendationsError } = await supabase
    .from("reorder_recommendations")
    .select("*")
    .eq("report_run_id", reportRunId)
    .returns<Recommendation[]>();

  if (recommendationsError) {
    return NextResponse.json({ error: recommendationsError.message }, { status: 500 });
  }

  const poRows = applyDiContainerRecommendations(recommendations || []).filter(
    (row) =>
      ["approved", "edited"].includes(row.recommendation_status || "") &&
      Math.round(asNumber(row.approved_qty)) > 0
  );
  const capacityViolations = diCapacityViolations(poRows);
  if (capacityViolations.length > 0) {
    return NextResponse.json(
      {
        error: capacityViolations
          .map(
            (violation) =>
              `Unable to submit ${violation.containerGroup} / ${violation.originPort}: ${formatInteger(violation.totalBottles)} bottles exceeds ${formatInteger(violation.capacityBottles)} bottle container capacity by ${formatInteger(violation.overByBottles)}.`
          )
          .join(" ")
      },
      { status: 400 }
    );
  }

  const grouped = new Map<string, { supplier: string; orderPath: "stateside" | "di"; rows: Recommendation[] }>();
  for (const row of poRows) {
    const supplier = row.supplier_name?.trim() || "Unassigned";
    const path = orderPath(row);
    const key = draftGroupKey(supplier, path);
    if (activeDraftsBySupplierPath.has(key)) continue;
    const group = grouped.get(key) || { supplier, orderPath: path, rows: [] };
    group.rows.push(row);
    grouped.set(key, group);
  }

  const created: string[] = [];
  const skipped = Array.from(activeDraftsBySupplierPath).map((key) => `${key}: active draft already exists`);
  const errors: string[] = [];
  const { data: supplierRows } = await supabase
    .from("suppliers")
    .select("name,trucking_cost_per_bottle,pick_up_location,eta_days,freight_forwarder,notes")
    .returns<SupplierLogistics[]>();
  const supplierDefaults = await loadImporterDefaults();
  const suppliers = mergeSupplierDefaults(supplierRows || [], supplierDefaults);
  const supplierMetadata = new Map(suppliers.map((row) => [normalizeSupplier(row.name), row]));

  for (const { supplier, orderPath: path, rows } of grouped.values()) {
    const metadata = supplierMetadata.get(normalizeSupplier(supplier));
    const { data: draft, error: draftError } = await supabase
      .from("purchase_order_drafts")
      .insert({
        supplier_name: supplier,
        report_run_id: reportRunId,
        status: "draft",
        notes: [
          "Created from global PO Drafts action.",
          `Order path: ${orderPathLabel(path)}.`,
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

    created.push(`${supplier} (${orderPathLabel(path)})`);
  }

  return NextResponse.json({ created, skipped, errors });
}
