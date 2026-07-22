import { NextResponse } from "next/server";
import { applyDiContainerRecommendations, diCapacityViolations, orderPath } from "@/lib/di-planning";
import { asNumber, mergeSupplierCatalogRows } from "@/lib/order-data";
import { formatInteger } from "@/lib/order-data";
import { ACTIVE_PO_STATUSES } from "@/lib/po-status";
import { loadImporterDefaults, mergeSupplierDefaults } from "@/lib/supplier-defaults";
import { fetchAllRecommendationsForRun } from "@/lib/supabase/recommendations";
import { createClient } from "@/lib/supabase/server";
import type {
  PurchaseOrderDraftWithLines,
  Recommendation,
  SupplierCatalogWine,
  SupplierLogistics
} from "@/lib/types";

const WRITE_ROLES = new Set(["buyer", "admin"]);

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
    .select("id,supplier_name,notes")
    .eq("report_run_id", reportRunId)
    .in("status", [...ACTIVE_PO_STATUSES]);

  if (activeDraftsError) {
    return NextResponse.json({ error: activeDraftsError.message }, { status: 500 });
  }

  const { data: enteredDrafts, error: enteredDraftsError } = await supabase
    .from("purchase_order_drafts")
    .select(`
      id,
      lines:purchase_order_lines (
        recommendation_id,
        supplier_catalog_wine_id
      )
    `)
    .eq("report_run_id", reportRunId)
    .eq("status", "entered_in_quickbooks")
    .returns<Array<{ id: string; lines: Array<{ recommendation_id: string | null; supplier_catalog_wine_id: string | null }> }>>();

  if (enteredDraftsError) {
    return NextResponse.json({ error: enteredDraftsError.message }, { status: 500 });
  }

  const enteredRecommendationIds = new Set(
    (enteredDrafts || []).flatMap((draft) =>
      (draft.lines || [])
        .map((line) => line.recommendation_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );
  const enteredCatalogWineIds = new Set(
    (enteredDrafts || []).flatMap((draft) =>
      (draft.lines || [])
        .map((line) => line.supplier_catalog_wine_id)
        .filter((id): id is string => typeof id === "string" && id.length > 0)
    )
  );

  const activeDraftsBySupplierPath = new Map(
    (activeDrafts || []).map((draft) => [
      draftGroupKey(draft.supplier_name?.trim() || "Unassigned", draftOrderPathFromNotes(draft.notes)),
      draft.id as string
    ])
  );

  let recommendations: Recommendation[];
  let supplierCatalogWines: SupplierCatalogWine[] = [];
  try {
    const fetchedRecommendations = await fetchAllRecommendationsForRun(supabase, reportRunId);
    const { data: catalogWines, error: catalogError } = await supabase
      .from("supplier_catalog_wines")
      .select(`
        *,
        workbench_items:supplier_catalog_workbench_items (*)
      `)
      .returns<SupplierCatalogWine[]>();

    if (catalogError) {
      throw new Error(catalogError.message);
    }

    supplierCatalogWines = catalogWines || [];
    recommendations = mergeSupplierCatalogRows(fetchedRecommendations, supplierCatalogWines, reportRunId);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load recommendations." },
      { status: 500 }
    );
  }

  const poRows = applyDiContainerRecommendations(recommendations).filter(
    (row) => {
      if (!["approved", "edited"].includes(row.recommendation_status || "")) return false;
      if (Math.round(asNumber(row.approved_qty)) <= 0) return false;
      if (row.supplier_catalog_wine_id) {
        return !enteredCatalogWineIds.has(row.supplier_catalog_wine_id);
      }
      return !enteredRecommendationIds.has(row.id);
    }
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
    const group = grouped.get(key) || { supplier, orderPath: path, rows: [] };
    group.rows.push(row);
    grouped.set(key, group);
  }

  const created: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];
  const errors: string[] = [];
  const { data: supplierRows } = await supabase
    .from("suppliers")
    .select("name,trucking_cost_per_bottle,pick_up_location,eta_days,freight_forwarder,notes")
    .returns<SupplierLogistics[]>();
  const supplierDefaults = await loadImporterDefaults();
  const suppliers = mergeSupplierDefaults(supplierRows || [], supplierDefaults);
  const supplierMetadata = new Map(suppliers.map((row) => [normalizeSupplier(row.name), row]));
  const catalogProducersById = new Map(
    supplierCatalogWines.map((wine) => [wine.id, wine.producer?.trim() || null])
  );

  for (const { supplier, orderPath: path, rows } of grouped.values()) {
    const metadata = supplierMetadata.get(normalizeSupplier(supplier));
    const groupKey = draftGroupKey(supplier, path);
    let draft = activeDraftsBySupplierPath.get(groupKey) ? { id: activeDraftsBySupplierPath.get(groupKey) as string } : null;

    if (!draft) {
      const { data: createdDraft, error: draftError } = await supabase
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

      if (draftError || !createdDraft) {
        errors.push(`${supplier}: ${draftError?.message || "Could not create draft."}`);
        continue;
      }
      draft = createdDraft;
    }

    const { data: existingLines, error: existingLinesError } = await supabase
      .from("purchase_order_lines")
      .select("id,recommendation_id,supplier_catalog_wine_id")
      .eq("purchase_order_draft_id", draft.id)
      .returns<Array<{ id: string; recommendation_id: string | null; supplier_catalog_wine_id: string | null }>>();

    if (existingLinesError) {
      errors.push(`${supplier}: ${existingLinesError.message}`);
      continue;
    }

    const approvedRecommendationIds = new Set(rows.filter((row) => !row.supplier_catalog_wine_id).map((row) => row.id));
    const approvedCatalogWineIds = new Set(rows.map((row) => row.supplier_catalog_wine_id).filter(Boolean));
    const staleLineIds = (existingLines || [])
      .filter((line) => {
        if (line.supplier_catalog_wine_id) return !approvedCatalogWineIds.has(line.supplier_catalog_wine_id);
        if (line.recommendation_id) return !approvedRecommendationIds.has(line.recommendation_id);
        return false;
      })
      .map((line) => line.id);

    if (staleLineIds.length > 0) {
      const { error: deleteError } = await supabase.from("purchase_order_lines").delete().in("id", staleLineIds);
      if (deleteError) {
        errors.push(`${supplier}: ${deleteError.message}`);
        continue;
      }
    }

    const existingLineEntries: Array<[string, string]> = [];
    for (const line of existingLines || []) {
      if (line.supplier_catalog_wine_id && approvedCatalogWineIds.has(line.supplier_catalog_wine_id)) {
        existingLineEntries.push([`catalog:${line.supplier_catalog_wine_id}`, line.id]);
      } else if (line.recommendation_id && approvedRecommendationIds.has(line.recommendation_id)) {
        existingLineEntries.push([`recommendation:${line.recommendation_id}`, line.id]);
      }
    }
    const existingLineIds = new Map(existingLineEntries);
    const linePayloads = rows.map((row) => {
      const approvedQty = Math.max(0, Math.round(asNumber(row.approved_qty)));
      const recommendedQty = Math.max(0, Math.round(asNumber(row.recommended_qty_rounded)));
      const fob = asNumber(row.fob);
      const supplierTrucking = asNumber(metadata?.trucking_cost_per_bottle);
      const trucking = asNumber(row.trucking_cost_per_bottle) || supplierTrucking;
      const wineCost = fob * approvedQty;
      const laidInCost = trucking * approvedQty;

      return {
        line_key: row.supplier_catalog_wine_id ? `catalog:${row.supplier_catalog_wine_id}` : `recommendation:${row.id}`,
        purchase_order_draft_id: draft.id,
        recommendation_id: row.supplier_catalog_wine_id ? null : row.id,
        supplier_catalog_wine_id: row.supplier_catalog_wine_id || null,
        producer_name: row.supplier_catalog_wine_id ? catalogProducersById.get(row.supplier_catalog_wine_id) || null : null,
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
        line_cost: wineCost,
        is_new_item: Boolean(row.is_new_item),
        new_item_warning: row.new_item_warning || null
      };
    });

    const insertPayloads = linePayloads.filter((line) => !existingLineIds.has(line.line_key));
    const updatePayloads = linePayloads.filter((line) => existingLineIds.has(line.line_key));

    for (const line of updatePayloads) {
      const lineId = existingLineIds.get(line.line_key);
      if (!lineId) continue;
      const { line_key: _lineKey, ...lineUpdate } = line;
      const { error: updateError } = await supabase.from("purchase_order_lines").update(lineUpdate).eq("id", lineId);
      if (updateError) {
        errors.push(`${supplier}: ${updateError.message}`);
      }
    }

    const { error: linesError } = insertPayloads.length
      ? await supabase.from("purchase_order_lines").insert(insertPayloads.map(({ line_key: _lineKey, ...line }) => line))
      : { error: null };
    if (linesError) {
      errors.push(`${supplier}: ${linesError.message}`);
      continue;
    }

    if (insertPayloads.length || updatePayloads.length || staleLineIds.length) {
      const summary = `${supplier} (${orderPathLabel(path)})`;
      if (activeDraftsBySupplierPath.has(groupKey)) {
        updated.push(summary);
      } else {
        created.push(summary);
      }
    } else {
      skipped.push(`${supplier} (${orderPathLabel(path)}): no approved lines changed`);
    }
  }

  const { data: drafts, error: draftsError } = await supabase
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
    .order("created_at", { ascending: false })
    .returns<PurchaseOrderDraftWithLines[]>();

  if (draftsError) {
    return NextResponse.json({ error: draftsError.message }, { status: 500 });
  }

  return NextResponse.json({ created, updated, skipped, errors, drafts: drafts || [] });
}
