import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ReportRun } from "./types";
import { fetchAllRecommendationsForRun } from "./supabase/recommendations";
import { carryForwardBuyerState, normalizeOrderingItemCode, ORDERING_BUILDER_VERSION } from "./source-backed-ordering";
import { fetchSourceBackedOrderingData, orderingBusinessDate } from "./source-backed-ordering-server";
import { catalogReconciliationUpdates, missingSourceRowsForRun } from "./ordering-run-overlay";
export { isSourceBackedRun, overlayCurrentSourceRows, sourceRunNeedsCurrentOverlay } from "./ordering-run-overlay";

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
  await reconcileSupplierCatalog(supabase, built.rows);
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
      const previousRows = await fetchAllRecommendationsForRun(supabase, previousRun.id);
      const missingRows = missingSourceRowsForRun(previousRows, built.rows);
      await insertRecommendationRows(supabase, previousRun.id, missingRows);
      return {
        run: previousRun,
        diagnostics: {
          ...(previousRun.diagnostics || {}),
          live_source_row_count: built.rows.length,
          newly_discovered_rows_added: missingRows.length,
          active_po_draft_lock_count: count
        },
        rowCount: previousRows.length + missingRows.length,
        reused: true
      };
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
    await insertRecommendationRows(supabase, run.id, carry.rows);
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

async function insertRecommendationRows(
  supabase: OrderingClient,
  reportRunId: string,
  rows: Array<Record<string, any>>
) {
  for (let start = 0; start < rows.length; start += 250) {
    const payload = rows.slice(start, start + 250).map((row) => ({ ...row, report_run_id: reportRunId }));
    const { error } = await supabase.from("reorder_recommendations").insert(payload);
    if (error) throw new Error(error.message);
  }
}

async function reconcileSupplierCatalog(
  supabase: OrderingClient,
  currentRows: Array<Record<string, any>>
) {
  const [{ data: suppliers, error: supplierError }, { data: catalogRows, error: catalogError }] = await Promise.all([
    supabase.from("suppliers").select("id,name"),
    supabase
      .from("supplier_catalog_wines")
      .select("id,supplier_id,supplier_name,display_name,planning_sku,quickbooks_item_number,quickbooks_sync_status")
  ]);
  if (supplierError) throw new Error(supplierError.message);
  if (catalogError) throw new Error(catalogError.message);

  const canonicalSupplierNames = new Map(
    (suppliers || []).map((supplier: { id: string; name: string }) => [supplier.id, supplier.name])
  );
  const updates = catalogReconciliationUpdates(
    (catalogRows || []),
    currentRows,
    canonicalSupplierNames
  );

  for (let start = 0; start < updates.length; start += 50) {
    const results = await Promise.all(
      updates.slice(start, start + 50).map((update) =>
        supabase
          .from("supplier_catalog_wines")
          .update({ ...update.values, updated_at: new Date().toISOString() })
          .eq("id", update.id)
      )
    );
    const failed = results.find((result) => result.error);
    if (failed?.error) throw new Error(failed.error.message);
  }
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
  const { data, error } = await supabase.rpc("carry_forward_supplier_workbench_items", {
    p_previous_report_run_id: previousRunId,
    p_next_report_run_id: nextRunId,
    p_excluded_catalog_wine_ids: Array.from(enteredCatalogWineIds)
  });
  if (error) throw new Error(error.message);
  return Number(data) || 0;
}
