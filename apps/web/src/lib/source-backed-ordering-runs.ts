import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Recommendation, ReportRun } from "./types";
import { fetchAllRecommendationsForRun } from "./supabase/recommendations";
import { carryForwardBuyerState, normalizeOrderingItemCode, ORDERING_BUILDER_VERSION, ORDERING_SOURCE } from "./source-backed-ordering";
import { fetchSourceBackedOrderingData, orderingBusinessDate } from "./source-backed-ordering-server";

type OrderingClient = SupabaseClient<any, "public", any>;

export type OrderingRun = ReportRun & {
  run_type: "quickbooks_sync" | "manual_upload" | "scheduled_email";
  source_file_ids?: string[];
};

export type OrderingSourceMode = "source" | "legacy";

export function orderingSourceMode(value: string | null | undefined): OrderingSourceMode {
  return value?.trim().toLowerCase() === "legacy" ? "legacy" : "source";
}

export async function fetchActiveOrderingRun(supabase: OrderingClient, mode: OrderingSourceMode = "source"): Promise<OrderingRun | null> {
  if (mode === "legacy") return fetchLatestCompletedRun(supabase, undefined, true);
  const sourceRun = await fetchLatestCompletedRun(supabase, "quickbooks_sync");
  if (sourceRun) return sourceRun;
  return fetchLatestCompletedRun(supabase);
}

export async function createSourceBackedOrderingRun(supabase: OrderingClient, createdBy: string | null) {
  const referenceDate = orderingBusinessDate();
  const built = await fetchSourceBackedOrderingData(supabase, { referenceDate });
  const sourceFingerprint = [
    referenceDate,
    built.diagnostics.quickbooks_as_of || "unknown-qb",
    built.diagnostics.vinosmith_available_fingerprint,
    `v${ORDERING_BUILDER_VERSION}`
  ].join("|");

  const { data: existing, error: existingError } = await supabase
    .from("report_runs")
    .select("id,run_type,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot,source_file_ids")
    .eq("run_type", "quickbooks_sync")
    .eq("status", "completed")
    .eq("report_date", referenceDate)
    .contains("diagnostics", { source_fingerprint: sourceFingerprint })
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle<OrderingRun>();
  if (existingError) throw new Error(existingError.message);
  if (existing) {
    return { run: existing, diagnostics: existing.diagnostics || built.diagnostics, rowCount: built.rows.length, reused: true };
  }

  const previousRun = await fetchActiveOrderingRun(supabase);
  if (previousRun) {
    const { count, error } = await supabase
      .from("purchase_order_drafts")
      .select("id", { count: "exact", head: true })
      .eq("report_run_id", previousRun.id)
      .in("status", ["draft", "ready_for_entry"]);
    if (error) throw new Error(error.message);
    if ((count || 0) > 0) {
      throw new Error(`Ordering refresh is locked because ${count} active PO draft${count === 1 ? "" : "s"} still belong to the current run. Enter or cancel those drafts before refreshing source data.`);
    }
  }
  const previousRows = previousRun ? await fetchAllRecommendationsForRun(supabase, previousRun.id) : [];
  const entered = previousRun ? await fetchEnteredItems(supabase, previousRun.id) : { productCodes: new Set<string>(), catalogWineIds: new Set<string>() };
  const carry = carryForwardBuyerState(built.rows, previousRows, entered.productCodes);
  const diagnostics = {
    ...built.diagnostics,
    source_fingerprint: sourceFingerprint,
    approval_carry_forward_count: carry.carried,
    entered_item_exclusion_count: entered.productCodes.size + entered.catalogWineIds.size,
    previous_ordering_run_id: previousRun?.id || null,
    source_file_count: 0
  };

  const { data: run, error: runError } = await supabase
    .from("report_runs")
    .insert({
      run_type: "quickbooks_sync",
      status: "running",
      report_date: referenceDate,
      source_file_ids: [],
      diagnostics,
      configuration_version_id: built.configuration.id,
      configuration_snapshot: built.configuration.values,
      created_by: createdBy
    })
    .select("id,run_type,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot,source_file_ids")
    .single<OrderingRun>();
  if (runError || !run) throw new Error(runError?.message || "Could not create the ordering run.");

  try {
    for (let start = 0; start < carry.rows.length; start += 250) {
      const payload = carry.rows.slice(start, start + 250).map((row) => ({ ...row, report_run_id: run.id }));
      const { error } = await supabase.from("reorder_recommendations").insert(payload);
      if (error) throw new Error(error.message);
    }
    const workbenchCount = previousRun ? await carryForwardWorkbenchItems(supabase, previousRun.id, run.id, entered.catalogWineIds) : 0;
    const completedAt = new Date().toISOString();
    const completedDiagnostics = { ...diagnostics, supplier_hub_workbench_carry_forward_count: workbenchCount };
    const { data: completed, error: completionError } = await supabase
      .from("report_runs")
      .update({ status: "completed", completed_at: completedAt, diagnostics: completedDiagnostics, error_message: null })
      .eq("id", run.id)
      .select("id,run_type,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot,source_file_ids")
      .single<OrderingRun>();
    if (completionError || !completed) throw new Error(completionError?.message || "Could not complete the ordering run.");
    return { run: completed, diagnostics: completedDiagnostics, rowCount: carry.rows.length, reused: false };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Source-backed ordering run failed.";
    await supabase.from("report_runs").update({ status: "failed", completed_at: new Date().toISOString(), error_message: message }).eq("id", run.id);
    throw error;
  }
}

export function isSourceBackedRun(run: Pick<OrderingRun, "run_type" | "diagnostics"> | null | undefined) {
  return run?.run_type === "quickbooks_sync" && run.diagnostics?.ordering_source === ORDERING_SOURCE;
}

async function fetchLatestCompletedRun(supabase: OrderingClient, runType?: OrderingRun["run_type"], excludeSource = false) {
  let query = supabase
    .from("report_runs")
    .select("id,run_type,report_date,completed_at,diagnostics,configuration_version_id,configuration_snapshot,source_file_ids")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1);
  if (runType) query = query.eq("run_type", runType);
  if (excludeSource) query = query.neq("run_type", "quickbooks_sync");
  const { data, error } = await query.maybeSingle<OrderingRun>();
  if (error) throw new Error(error.message);
  return data || null;
}

async function fetchEnteredItems(supabase: OrderingClient, reportRunId: string) {
  const { data, error } = await supabase
    .from("purchase_order_drafts")
    .select("lines:purchase_order_lines(product_code,supplier_catalog_wine_id)")
    .eq("report_run_id", reportRunId)
    .eq("status", "entered_in_quickbooks")
    .returns<Array<{ lines: Array<{ product_code: string | null; supplier_catalog_wine_id: string | null }> }>>();
  if (error) throw new Error(error.message);
  const lines = (data || []).flatMap((draft) => draft.lines || []);
  return {
    productCodes: new Set(lines.map((line) => normalizeOrderingItemCode(line.product_code)).filter(Boolean)),
    catalogWineIds: new Set(lines.map((line) => line.supplier_catalog_wine_id).filter((id): id is string => Boolean(id)))
  };
}

async function carryForwardWorkbenchItems(supabase: OrderingClient, previousRunId: string, nextRunId: string, enteredCatalogWineIds: ReadonlySet<string>) {
  const { data, error } = await supabase
    .from("supplier_catalog_workbench_items")
    .select("supplier_catalog_wine_id,recommended_qty,approved_qty,recommendation_status,order_path,active,notes,created_by")
    .eq("report_run_id", previousRunId)
    .eq("active", true);
  if (error) throw new Error(error.message);
  const rows = (data || []).filter((row) => !enteredCatalogWineIds.has(row.supplier_catalog_wine_id));
  if (!rows.length) return 0;
  const { error: insertError } = await supabase.from("supplier_catalog_workbench_items").upsert(
    rows.map((row) => ({ ...row, report_run_id: nextRunId, updated_at: new Date().toISOString() })),
    { onConflict: "report_run_id,supplier_catalog_wine_id" }
  );
  if (insertError) throw new Error(insertError.message);
  return rows.length;
}

export function overlayCurrentSourceRows(recommendations: Recommendation[], currentRows: Array<Record<string, any>>) {
  const currentByCode = new Map(currentRows.map((row) => [normalizeOrderingItemCode(row.product_code), row]));
  return recommendations.map((recommendation) => {
    const current = currentByCode.get(normalizeOrderingItemCode(recommendation.product_code));
    if (!current) return recommendation;
    return {
      ...recommendation,
      ...current,
      id: recommendation.id,
      report_run_id: recommendation.report_run_id,
      recommendation_status: recommendation.recommendation_status,
      approved_qty: recommendation.approved_qty,
      order_path: recommendation.order_path
    } as Recommendation;
  });
}
