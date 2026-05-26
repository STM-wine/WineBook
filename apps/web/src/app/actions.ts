"use server";

import { revalidatePath } from "next/cache";
import { applyDiContainerRecommendations, diCapacityViolations, orderPath } from "@/lib/di-planning";
import { asNumber, formatInteger } from "@/lib/order-data";
import { createClient } from "@/lib/supabase/server";
import type { Recommendation } from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);
const VALID_STATUSES = new Set(["rejected", "approved", "edited", "deferred"]);
const VALID_ORDER_PATHS = new Set(["stateside", "di"]);
const ACTIVE_PO_STATUSES = ["draft", "ready_for_entry"];
const VALID_PO_STATUSES = new Set(["draft", "ready_for_entry", "entered_in_quickbooks", "cancelled"]);

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
    throw new Error("Sign in required.");
  }

  const { data: profile } = await supabase
    .from("app_profiles")
    .select("role")
    .eq("id", user.id)
    .maybeSingle<{ role: string }>();

  if (!profile || !WRITE_ROLES.has(profile.role)) {
    throw new Error("Buyer or admin access required.");
  }

  return { supabase, user };
}

export async function updateRecommendationApproval(input: {
  id: string;
  recommendationStatus: string;
  approvedQty: number;
}) {
  const recommendationStatus = input.recommendationStatus;
  const approvedQty = Math.max(0, Math.round(Number(input.approvedQty) || 0));

  if (!input.id) {
    throw new Error("Missing recommendation id.");
  }
  if (!VALID_STATUSES.has(recommendationStatus)) {
    throw new Error("Unsupported recommendation status.");
  }

  const { supabase } = await requireWriteAccess();

  const { error } = await supabase
    .from("reorder_recommendations")
    .update({
      recommendation_status: recommendationStatus,
      approved_qty: approvedQty
    })
    .eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  // Order Review keeps approval state optimistically in the client. Avoid a
  // full route revalidation here so rapid checkbox work does not freeze.
}

export async function updateRecommendationOrderPath(input: {
  id: string;
  orderPath: "stateside" | "di";
  approvedQty?: number;
  recommendationStatus?: string;
}) {
  if (!input.id) {
    throw new Error("Missing recommendation id.");
  }
  if (!VALID_ORDER_PATHS.has(input.orderPath)) {
    throw new Error("Unsupported order path.");
  }
  if (input.recommendationStatus && !VALID_STATUSES.has(input.recommendationStatus)) {
    throw new Error("Unsupported recommendation status.");
  }

  const { supabase } = await requireWriteAccess();
  const payload: {
    order_path: "stateside" | "di";
    approved_qty?: number;
    recommendation_status?: string;
  } = { order_path: input.orderPath };

  if (input.approvedQty !== undefined) {
    payload.approved_qty = Math.max(0, Math.round(Number(input.approvedQty) || 0));
  }
  if (input.recommendationStatus) {
    payload.recommendation_status = input.recommendationStatus;
  }

  const { error } = await supabase
    .from("reorder_recommendations")
    .update(payload)
    .eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function createPurchaseOrderDrafts(reportRunId: string) {
  if (!reportRunId) {
    throw new Error("Missing report run id.");
  }

  const { supabase, user } = await requireWriteAccess();

  const { data: activeDrafts, error: activeDraftsError } = await supabase
    .from("purchase_order_drafts")
    .select("supplier_name,notes")
    .eq("report_run_id", reportRunId)
    .in("status", ACTIVE_PO_STATUSES);

  if (activeDraftsError) {
    throw new Error(activeDraftsError.message);
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
    throw new Error(recommendationsError.message);
  }

  const poRows = applyDiContainerRecommendations(recommendations || []).filter(
    (row) =>
      ["approved", "edited"].includes(row.recommendation_status || "") &&
      Math.round(asNumber(row.approved_qty)) > 0
  );
  const capacityViolations = diCapacityViolations(poRows);
  if (capacityViolations.length > 0) {
    throw new Error(
      capacityViolations
        .map(
          (violation) =>
            `Unable to submit ${violation.containerGroup} / ${violation.originPort}: ${formatInteger(violation.totalBottles)} bottles exceeds ${formatInteger(violation.capacityBottles)} bottle container capacity by ${formatInteger(violation.overByBottles)}.`
        )
        .join(" ")
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

  for (const { supplier, orderPath: path, rows } of grouped.values()) {
    const { data: draft, error: draftError } = await supabase
      .from("purchase_order_drafts")
      .insert({
        supplier_name: supplier,
        report_run_id: reportRunId,
        status: "draft",
        notes: `Created from global PO Drafts action. Order path: ${orderPathLabel(path)}.`,
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
      const trucking = asNumber(row.trucking_cost_per_bottle);
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

  revalidatePath("/");
  return { created, skipped, errors };
}

export async function updatePurchaseOrderDraftStatus(input: { id: string; status: string }) {
  if (!input.id) {
    throw new Error("Missing PO draft id.");
  }
  if (!VALID_PO_STATUSES.has(input.status)) {
    throw new Error("Unsupported PO draft status.");
  }

  const { supabase, user } = await requireWriteAccess();
  const { error } = await supabase
    .from("purchase_order_drafts")
    .update({
      status: input.status,
      reviewed_by: user.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}

export async function deletePurchaseOrderLine(input: { id: string; draftId: string }) {
  if (!input.id) {
    throw new Error("Missing PO line id.");
  }
  if (!input.draftId) {
    throw new Error("Missing PO draft id.");
  }

  const { supabase, user } = await requireWriteAccess();
  const { error } = await supabase.from("purchase_order_lines").delete().eq("id", input.id);

  if (error) {
    throw new Error(error.message);
  }

  await supabase
    .from("purchase_order_drafts")
    .update({
      reviewed_by: user.id,
      updated_at: new Date().toISOString()
    })
    .eq("id", input.draftId);

  revalidatePath("/");
}

export async function saveSupplierLogistics(input: {
  id?: string;
  name: string;
  importerId?: string;
  etaDays?: number;
  pickUpLocation?: string;
  freightForwarder?: string;
  orderFrequency?: string;
  tdm?: string;
  truckingCostPerBottle?: number;
  notes?: string;
  active?: boolean;
}) {
  const name = input.name.trim();
  if (!name) {
    throw new Error("Supplier name is required.");
  }

  const { supabase } = await requireWriteAccess();
  const payload = {
    name,
    importer_id: input.importerId?.trim() || null,
    eta_days: Math.max(0, Math.round(Number(input.etaDays) || 0)),
    pick_up_location: input.pickUpLocation?.trim() || null,
    freight_forwarder: input.freightForwarder?.trim() || null,
    order_frequency: input.orderFrequency?.trim() || null,
    tdm: input.tdm?.trim() || null,
    trucking_cost_per_bottle: Math.max(0, Number(input.truckingCostPerBottle) || 0),
    notes: input.notes?.trim() || null,
    active: input.active ?? true,
    updated_at: new Date().toISOString()
  };

  const query = input.id
    ? supabase.from("suppliers").update(payload).eq("id", input.id)
    : supabase.from("suppliers").insert(payload);

  const { error } = await query;
  if (error) {
    throw new Error(error.message);
  }

  revalidatePath("/");
}
