import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildQuickBooksSalesDashboardDiscoveryRequests,
  createQuickBooksDesktopReadOnlyClient,
  type QuickBooksDateRange,
  type QuickBooksDesktopQbxmlRequest,
  type QuickBooksIteratorMode,
  type QuickBooksQbxmlResponseStatus
} from "@/lib/integrations/quickbooks-desktop";
import { createServiceRoleClient } from "@/lib/supabase/server";

const SOURCE_SYSTEM = "quickbooks_desktop";
const DEFAULT_BACKFILL_START = "2018-08-14";
const DEFAULT_MAX_RETURNED = 200;
const STALE_RUNNING_MINUTES = 30;
const SALES_TRUTH_PRIORITY_YEAR = 2025;
const SALES_TRUTH_WEEKLY_CHUNK_DAYS = 7;
const SALES_TRUTH_WEEKLY_KEY_PREFIX = "weekv3";
const SALES_TRUTH_TWO_WEEK_KEY_PREFIX = "span2v1";
const SALES_TRUTH_MONTHLY_KEY_PREFIX = "monthv1";

export type QuickBooksRecoveryResource =
  | "quickbooks_sales_reps"
  | "quickbooks_customers"
  | "quickbooks_vendors"
  | "quickbooks_items"
  | "quickbooks_invoices"
  | "quickbooks_credit_memos"
  | "quickbooks_receive_payments"
  | "quickbooks_purchase_orders"
  | "quickbooks_txn_deleted";

type SourceSyncCheckpointRow = {
  id: string;
  resource_name: QuickBooksRecoveryResource;
  checkpoint_key: string;
  status: "pending" | "running" | "completed" | "failed" | "needs_repair";
  requested_start_date: string | null;
  requested_end_date: string | null;
  cursor_data: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  last_synced_at: string | null;
  updated_at: string;
  created_at: string;
};

export type QuickBooksRecoveryJob = {
  id: string;
  resourceName: QuickBooksRecoveryResource;
  checkpointKey: string;
  requestedStartDate: string | null;
  requestedEndDate: string | null;
  cursorData: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
};

export type QuickBooksRecoveryRequest = QuickBooksDesktopQbxmlRequest & {
  recoveryJob?: QuickBooksRecoveryJob;
};

export type QuickBooksRecoveryCompletion = {
  hasMore: boolean;
  continuationRequest?: QuickBooksRecoveryRequest;
};

export type QuickBooksRecoveryQueueStatus = {
  configured: boolean;
  autoSeedEnabled: boolean;
  backfillStart: string;
  backfillEnd: string;
  pending: number;
  running: number;
  completed: number;
  failed: number;
  nextJobs: Array<{
    resourceName: string;
    checkpointKey: string;
    requestedStartDate: string | null;
    requestedEndDate: string | null;
    status: string;
  }>;
  error?: string;
};

export async function buildQuickBooksRecoveryQueueStatus(): Promise<QuickBooksRecoveryQueueStatus> {
  let supabase: SupabaseClient;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    return {
      configured: false,
      autoSeedEnabled: isAutoSeedEnabled(),
      backfillStart: getBackfillStart(),
      backfillEnd: getBackfillEnd(),
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      nextJobs: [],
      error: error instanceof Error ? error.message : "Missing Supabase service-role configuration."
    };
  }

  try {
    if (isAutoSeedEnabled()) await ensureQuickBooksRecoveryQueue(supabase);
    const [pending, running, completed, failed, nextJobs] = await Promise.all([
      countJobsByStatus(supabase, ["pending"]),
      countJobsByStatus(supabase, ["running"]),
      countJobsByStatus(supabase, ["completed"]),
      countJobsByStatus(supabase, ["failed", "needs_repair"]),
      readNextPendingJobs(supabase, 8)
    ]);

    return {
      configured: true,
      autoSeedEnabled: isAutoSeedEnabled(),
      backfillStart: getBackfillStart(),
      backfillEnd: getBackfillEnd(),
      pending,
      running,
      completed,
      failed,
      nextJobs
    };
  } catch (error) {
    return {
      configured: true,
      autoSeedEnabled: isAutoSeedEnabled(),
      backfillStart: getBackfillStart(),
      backfillEnd: getBackfillEnd(),
      pending: 0,
      running: 0,
      completed: 0,
      failed: 0,
      nextJobs: [],
      error: error instanceof Error ? error.message : "Could not read QuickBooks recovery queue."
    };
  }
}

export async function buildNextQuickBooksRecoveryRequests(): Promise<QuickBooksRecoveryRequest[]> {
  let supabase: SupabaseClient;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return buildQuickBooksSalesDashboardDiscoveryRequests() as QuickBooksRecoveryRequest[];
  }

  await ensureQuickBooksRecoveryQueue(supabase);
  await resetStaleRunningJobs(supabase);
  const job = await claimNextRecoveryJob(supabase);
  if (!job) return buildQuickBooksSalesDashboardDiscoveryRequests() as QuickBooksRecoveryRequest[];

  const request = buildRequestForJob(job);
  const recoveryRequest = { ...request, recoveryJob: job };
  if (job.resourceName === "quickbooks_invoices" || job.resourceName === "quickbooks_credit_memos") {
    return [createQuickBooksDesktopReadOnlyClient().buildSalesRepQuery(), recoveryRequest];
  }
  return [recoveryRequest];
}

export async function completeQuickBooksRecoveryJob(
  job: QuickBooksRecoveryJob,
  statuses: QuickBooksQbxmlResponseStatus[],
  recordCount: number | null,
  responseChecksum: string,
  receivedAt: string
): Promise<QuickBooksRecoveryCompletion> {
  const supabase = createServiceRoleClient();
  const firstStatus = statuses[0] || null;
  if (isQuickBooksErrorStatus(firstStatus)) {
    await failQuickBooksRecoveryJob(job, firstStatus?.statusMessage || "QuickBooks recovery request failed.");
    throw new Error(firstStatus?.statusMessage || "QuickBooks recovery request failed.");
  }

  const iteratorId = firstStatus?.iteratorId || null;
  const remaining = firstStatus?.iteratorRemainingCount ?? null;
  const priorRecordCount = numberValue(job.diagnostics.recordCount);
  const totalRecordCount = priorRecordCount + (recordCount || 0);
  const diagnostics = {
    ...job.diagnostics,
    recordCount: totalRecordCount,
    lastRecordCount: recordCount,
    lastResponseChecksum: responseChecksum,
    lastStatus: firstStatus,
    lastReceivedAt: receivedAt,
    completedPages: numberValue(job.diagnostics.completedPages) + 1
  };

  if (iteratorId && remaining && remaining > 0) {
    const continuationJob = {
      ...job,
      cursorData: { iteratorId, iteratorMode: "Continue" },
      diagnostics
    };
    await updateJob(supabase, job.id, {
      status: "running",
      cursor_data: continuationJob.cursorData,
      diagnostics,
      last_synced_at: receivedAt
    });
    const continuationRequest = buildRequestForJob(continuationJob);
    return { hasMore: true, continuationRequest: { ...continuationRequest, recoveryJob: continuationJob } };
  }

  await updateJob(supabase, job.id, {
    status: "completed",
    cursor_data: {},
    diagnostics,
    last_synced_at: receivedAt
  });
  return { hasMore: false };
}

export async function failQuickBooksRecoveryJob(job: QuickBooksRecoveryJob, errorMessage: string) {
  const supabase = createServiceRoleClient();
  await updateJob(supabase, job.id, {
    status: "failed",
    cursor_data: job.cursorData,
    diagnostics: {
      ...job.diagnostics,
      errorMessage,
      failedAt: new Date().toISOString(),
      attempts: numberValue(job.diagnostics.attempts) + 1
    }
  });
}

async function ensureQuickBooksRecoveryQueue(supabase: SupabaseClient) {
  if (!isAutoSeedEnabled()) return;

  const rows = buildSeedRows();
  for (let index = 0; index < rows.length; index += 500) {
    const chunk = rows.slice(index, index + 500);
    const { error } = await supabase.from("source_sync_checkpoints").upsert(chunk, {
      onConflict: "source_system,resource_name,checkpoint_key",
      ignoreDuplicates: true
    });
    if (error) throw new Error(error.message);
  }
  await completeSupersededSalesTruthRows(supabase);
  await completeSupersededPriorityYearWeeklyRows(supabase);
  await consolidatePendingSalesTruthWeeklyRows(supabase);
}

async function completeSupersededSalesTruthRows(supabase: SupabaseClient) {
  for (const window of salesTruthPriorityWindows()) {
    for (const resourceName of salesTruthRecoveryResources()) {
      const supersededAt = new Date().toISOString();
      const { error } = await supabase
        .from("source_sync_checkpoints")
        .update({
          status: "completed",
          diagnostics: {
            recovery: true,
            supersededBy: "weekly_sales_truth_recovery",
            supersededAt
          },
          last_synced_at: supersededAt,
          updated_at: supersededAt
        })
        .eq("source_system", SOURCE_SYSTEM)
        .eq("resource_name", resourceName)
        .eq("status", "pending")
        .not("checkpoint_key", "like", `${SALES_TRUTH_WEEKLY_KEY_PREFIX}:%`)
        .not("checkpoint_key", "like", `${SALES_TRUTH_TWO_WEEK_KEY_PREFIX}:%`)
        .not("checkpoint_key", "like", `${SALES_TRUTH_MONTHLY_KEY_PREFIX}:%`)
        .gte("requested_start_date", window.from || "")
        .lte("requested_start_date", window.to || "");
      if (error) throw new Error(error.message);
    }
  }
}

async function completeSupersededPriorityYearWeeklyRows(supabase: SupabaseClient) {
  for (const window of priorityYearSalesTruthWindows()) {
    for (const resourceName of salesTruthRecoveryResources()) {
      await completeSupersededPriorityYearRowsByPrefix(supabase, resourceName, window, SALES_TRUTH_WEEKLY_KEY_PREFIX);
      await completeSupersededPriorityYearRowsByPrefix(supabase, resourceName, window, SALES_TRUTH_TWO_WEEK_KEY_PREFIX);
    }
  }
}

async function completeSupersededPriorityYearRowsByPrefix(
  supabase: SupabaseClient,
  resourceName: QuickBooksRecoveryResource,
  window: QuickBooksDateRange,
  checkpointPrefix: string
) {
  const supersededAt = new Date().toISOString();
  const { error } = await supabase
    .from("source_sync_checkpoints")
    .update({
      status: "completed",
      diagnostics: {
        recovery: true,
        supersededBy: "monthly_sales_truth_recovery",
        supersededAt
      },
      last_synced_at: supersededAt,
      updated_at: supersededAt
    })
    .eq("source_system", SOURCE_SYSTEM)
    .eq("resource_name", resourceName)
    .eq("status", "pending")
    .like("checkpoint_key", `${checkpointPrefix}:%`)
    .gte("requested_start_date", window.from || "")
    .lte("requested_start_date", window.to || "");
  if (error) throw new Error(error.message);
}

async function consolidatePendingSalesTruthWeeklyRows(supabase: SupabaseClient) {
  for (const priorityWindow of ytdSalesTruthWindows()) {
    for (const resourceName of salesTruthRecoveryResources()) {
      const pendingWeeklyRows = await readPendingWeeklySalesTruthRows(supabase, resourceName, priorityWindow);
      const groups = groupPendingWeeklyRowsIntoTwoWeekSpans(pendingWeeklyRows);

      for (const group of groups) {
        if (!group.rows.length) continue;

        const consolidatedAt = new Date().toISOString();
        const checkpoint = checkpointRow(resourceName, salesTruthTwoWeekKey(group), group.start, group.end);
        const { error: upsertError } = await supabase.from("source_sync_checkpoints").upsert(
          {
            ...checkpoint,
            diagnostics: {
              recovery: true,
              consolidatedFrom: group.rows.map((row) => row.checkpoint_key),
              consolidatedAt
            }
          },
          {
            onConflict: "source_system,resource_name,checkpoint_key",
            ignoreDuplicates: true
          }
        );
        if (upsertError) throw new Error(upsertError.message);

        const { error: updateError } = await supabase
          .from("source_sync_checkpoints")
          .update({
            status: "completed",
            diagnostics: {
              recovery: true,
              supersededBy: "two_week_sales_truth_recovery",
              supersededAt: consolidatedAt,
              consolidatedInto: checkpoint.checkpoint_key
            },
            last_synced_at: consolidatedAt,
            updated_at: consolidatedAt
          })
          .in(
            "id",
            group.rows.map((row) => row.id)
          )
          .eq("status", "pending");
        if (updateError) throw new Error(updateError.message);
      }
    }
  }
}

async function resetStaleRunningJobs(supabase: SupabaseClient) {
  const staleBefore = new Date(Date.now() - STALE_RUNNING_MINUTES * 60 * 1000).toISOString();
  const { error } = await supabase
    .from("source_sync_checkpoints")
    .update({
      status: "pending",
      diagnostics: { resetReason: "stale_running", resetAt: new Date().toISOString() },
      updated_at: new Date().toISOString()
    })
    .eq("source_system", SOURCE_SYSTEM)
    .in("resource_name", recoveryResources())
    .eq("status", "running")
    .lt("updated_at", staleBefore);
  if (error) throw new Error(error.message);
}

async function claimNextRecoveryJob(supabase: SupabaseClient): Promise<QuickBooksRecoveryJob | null> {
  for (const resourceName of initialRecoveryResources()) {
    const row = await readFirstPendingJobForResource(supabase, resourceName);
    if (!row) continue;
    const job = await claimPendingRecoveryRow(supabase, row);
    if (job) return job;
  }

  const priorityItemRow = await readFirstManualPriorityItemJob(supabase);
  if (priorityItemRow) {
    const job = await claimPendingRecoveryRow(supabase, priorityItemRow);
    if (job) return job;
  }

  const ytdSalesTruthRow = await readFirstPendingYtdSalesTruthJob(supabase);
  if (ytdSalesTruthRow) {
    const job = await claimPendingRecoveryRow(supabase, ytdSalesTruthRow);
    if (job) return job;
  }

  for (const resourceName of itemRecoveryResources()) {
    const row = await readFirstPendingJobForResource(supabase, resourceName);
    if (!row) continue;
    const job = await claimPendingRecoveryRow(supabase, row);
    if (job) return job;
  }

  const priorityYearSalesTruthRow = await readFirstPendingPriorityYearSalesTruthJob(supabase);
  if (priorityYearSalesTruthRow) {
    const job = await claimPendingRecoveryRow(supabase, priorityYearSalesTruthRow);
    if (job) return job;
  }

  for (const resourceName of followUpRecoveryResources()) {
    const row = await readFirstPendingJobForResource(supabase, resourceName);
    if (!row) continue;
    const job = await claimPendingRecoveryRow(supabase, row);
    if (job) return job;
  }

  return null;
}

async function claimPendingRecoveryRow(supabase: SupabaseClient, row: SourceSyncCheckpointRow) {
  const diagnostics = {
    ...(row.diagnostics || {}),
    attempts: numberValue(row.diagnostics?.attempts) + 1,
    claimedAt: new Date().toISOString()
  };
  const { data: updated, error: updateError } = await supabase
    .from("source_sync_checkpoints")
    .update({ status: "running", diagnostics, updated_at: new Date().toISOString() })
    .eq("id", row.id)
    .eq("status", "pending")
    .select("id,resource_name,checkpoint_key,status,requested_start_date,requested_end_date,cursor_data,diagnostics,last_synced_at,updated_at,created_at")
    .single<SourceSyncCheckpointRow>();

  return updateError || !updated ? null : toRecoveryJob(updated);
}

async function countJobsByStatus(supabase: SupabaseClient, statuses: SourceSyncCheckpointRow["status"][]) {
  const { count, error } = await supabase
    .from("source_sync_checkpoints")
    .select("id", { count: "exact", head: true })
    .eq("source_system", SOURCE_SYSTEM)
    .in("resource_name", recoveryResources())
    .in("status", statuses);
  if (error) throw new Error(error.message);
  return count || 0;
}

async function readNextPendingJobs(supabase: SupabaseClient, limit: number) {
  const jobs: QuickBooksRecoveryQueueStatus["nextJobs"] = [];
  for (const resourceName of initialRecoveryResources()) {
    jobs.push(...toNextJobs(await readPendingJobsForResource(supabase, resourceName, limit - jobs.length)));
    if (jobs.length >= limit) return jobs;
  }

  jobs.push(...toNextJobs(await readPendingYtdSalesTruthJobs(supabase, limit - jobs.length)));
  if (jobs.length >= limit) return jobs;

  jobs.push(...toNextJobs(await readManualPriorityItemJobs(supabase, limit - jobs.length)));
  if (jobs.length >= limit) return jobs;

  for (const resourceName of itemRecoveryResources()) {
    jobs.push(...toNextJobs(await readPendingJobsForResource(supabase, resourceName, limit - jobs.length)));
    if (jobs.length >= limit) return jobs;
  }

  jobs.push(...toNextJobs(await readPendingPriorityYearSalesTruthJobs(supabase, limit - jobs.length)));
  if (jobs.length >= limit) return jobs;

  for (const resourceName of followUpRecoveryResources()) {
    jobs.push(...toNextJobs(await readPendingJobsForResource(supabase, resourceName, limit - jobs.length)));
    if (jobs.length >= limit) break;
  }
  return jobs;
}

function toNextJobs(rows: SourceSyncCheckpointRow[]): QuickBooksRecoveryQueueStatus["nextJobs"] {
  return rows.map((row) => ({
    resourceName: row.resource_name,
    checkpointKey: row.checkpoint_key,
    requestedStartDate: row.requested_start_date,
    requestedEndDate: row.requested_end_date,
    status: row.status
  }));
}

async function readFirstPendingJobForResource(supabase: SupabaseClient, resourceName: QuickBooksRecoveryResource) {
  return (await readPendingJobsForResource(supabase, resourceName, 1))[0] || null;
}

async function readFirstManualPriorityItemJob(supabase: SupabaseClient) {
  return (await readManualPriorityItemJobs(supabase, 1))[0] || null;
}

async function readManualPriorityItemJobs(supabase: SupabaseClient, limit: number) {
  if (limit <= 0) return [];

  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .select("id,resource_name,checkpoint_key,status,requested_start_date,requested_end_date,cursor_data,diagnostics,last_synced_at,updated_at,created_at")
    .eq("source_system", SOURCE_SYSTEM)
    .eq("resource_name", "quickbooks_items")
    .eq("status", "pending")
    .contains("diagnostics", { manualPriority: "data_health" })
    .order("updated_at", { ascending: true })
    .limit(limit)
    .returns<SourceSyncCheckpointRow[]>();

  if (error) throw new Error(error.message);
  return data || [];
}

async function readFirstPendingYtdSalesTruthJob(supabase: SupabaseClient) {
  return (await readPendingYtdSalesTruthJobs(supabase, 1))[0] || null;
}

async function readFirstPendingPriorityYearSalesTruthJob(supabase: SupabaseClient) {
  return (await readPendingPriorityYearSalesTruthJobs(supabase, 1))[0] || null;
}

async function readPendingYtdSalesTruthJobs(supabase: SupabaseClient, limit: number) {
  return readPendingSalesTruthJobsForWindows(supabase, limit, ytdSalesTruthWindows());
}

async function readPendingPriorityYearSalesTruthJobs(supabase: SupabaseClient, limit: number) {
  return readPendingSalesTruthJobsForWindows(supabase, limit, priorityYearSalesTruthWindows());
}

async function readPendingSalesTruthJobsForWindows(supabase: SupabaseClient, limit: number, windows: QuickBooksDateRange[]) {
  if (limit <= 0) return [];

  const requestedRows: SourceSyncCheckpointRow[] = [];
  for (const window of windows) {
    if (requestedRows.length >= limit) break;
    const rows = await readPendingJobsForResourceWindow(supabase, salesTruthRecoveryResources(), limit - requestedRows.length, window);
    requestedRows.push(...rows);
  }
  return requestedRows;
}

async function readPendingJobsForResource(supabase: SupabaseClient, resourceName: QuickBooksRecoveryResource, limit: number) {
  if (limit <= 0) return [];

  const requestedRows: SourceSyncCheckpointRow[] = [];
  for (const window of recoveryPriorityWindows()) {
    if (requestedRows.length >= limit) break;
    const rows = await readPendingJobsForResourceWindow(supabase, resourceName, limit - requestedRows.length, window);
    requestedRows.push(...rows);
  }
  if (requestedRows.length >= limit) return requestedRows;

  const rows = await readPendingJobsForResourceWindow(supabase, resourceName, limit - requestedRows.length, null);
  requestedRows.push(...rows);
  return requestedRows;
}

async function readPendingJobsForResourceWindow(
  supabase: SupabaseClient,
  resourceName: QuickBooksRecoveryResource | QuickBooksRecoveryResource[],
  limit: number,
  window: QuickBooksDateRange | null
) {
  if (limit <= 0) return [];

  let query = supabase
    .from("source_sync_checkpoints")
    .select("id,resource_name,checkpoint_key,status,requested_start_date,requested_end_date,cursor_data,diagnostics,last_synced_at,updated_at,created_at")
    .eq("source_system", SOURCE_SYSTEM)
    .eq("status", "pending");

  if (Array.isArray(resourceName)) {
    query = query.in("resource_name", resourceName);
  } else {
    query = query.eq("resource_name", resourceName);
  }

  if (window?.from || window?.to) {
    if (window.from) query = query.gte("requested_start_date", window.from);
    if (window.to) query = query.lte("requested_start_date", window.to);
  } else {
    query = query.is("requested_start_date", null);
  }

  const { data, error } = await query
    .order("requested_start_date", { ascending: false, nullsFirst: true })
    .order("resource_name", { ascending: false })
    .order("checkpoint_key", { ascending: false })
    .limit(limit)
    .returns<SourceSyncCheckpointRow[]>();
  if (error) throw new Error(error.message);
  return data || [];
}

async function readPendingWeeklySalesTruthRows(
  supabase: SupabaseClient,
  resourceName: QuickBooksRecoveryResource,
  window: QuickBooksDateRange
) {
  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .select("id,resource_name,checkpoint_key,status,requested_start_date,requested_end_date,cursor_data,diagnostics,last_synced_at,updated_at,created_at")
    .eq("source_system", SOURCE_SYSTEM)
    .eq("resource_name", resourceName)
    .eq("status", "pending")
    .like("checkpoint_key", `${SALES_TRUTH_WEEKLY_KEY_PREFIX}:%`)
    .gte("requested_start_date", window.from || "")
    .lte("requested_start_date", window.to || "")
    .order("requested_start_date", { ascending: false })
    .limit(1000)
    .returns<SourceSyncCheckpointRow[]>();
  if (error) throw new Error(error.message);
  return (data || []).filter((row) => row.requested_start_date && row.requested_end_date);
}

function groupPendingWeeklyRowsIntoTwoWeekSpans(rows: SourceSyncCheckpointRow[]) {
  const groups: Array<{ start: string; end: string; rows: SourceSyncCheckpointRow[] }> = [];
  let index = 0;

  while (index < rows.length) {
    const current = rows[index];
    const next = rows[index + 1];
    const canPair =
      Boolean(next?.requested_start_date && next.requested_end_date && current.requested_start_date) &&
      dayBefore(current.requested_start_date || "") === next?.requested_end_date;
    const groupRows = canPair && next ? [current, next] : [current];
    const dates = groupRows.flatMap((row) => [row.requested_start_date || "", row.requested_end_date || ""]).filter(Boolean);

    groups.push({
      start: dates.reduce((earliest, date) => minDateString(earliest, date)),
      end: dates.reduce((latest, date) => maxDateString(latest, date)),
      rows: groupRows
    });
    index += groupRows.length;
  }

  return groups;
}

function buildRequestForJob(job: QuickBooksRecoveryJob): QuickBooksDesktopQbxmlRequest {
  const client = createQuickBooksDesktopReadOnlyClient();
  const maxReturned = getMaxReturned();
  const iterator = iteratorFor(job.cursorData);
  const txnDateRange = dateRangeFor(job);

  if (job.resourceName === "quickbooks_sales_reps") return client.buildSalesRepQuery();
  if (job.resourceName === "quickbooks_customers") return client.buildCustomerQuery({ maxReturned, activeStatus: "All", iterator });
  if (job.resourceName === "quickbooks_vendors") return client.buildVendorQuery({ maxReturned, activeStatus: "All", iterator });
  if (job.resourceName === "quickbooks_items") {
    if (useInventoryOnlyItemQuery(job)) return client.buildItemInventoryQuery({ maxReturned, activeStatus: "All", iterator });
    return client.buildItemQuery({ maxReturned, activeStatus: "All", iterator });
  }
  if (job.resourceName === "quickbooks_invoices") {
    return client.buildInvoiceQuery({
      requestId: job.checkpointKey,
      maxReturned,
      iterator,
      ...(iterator?.mode === "Continue" ? {} : { txnDateRange }),
      includeLineItems: true,
      includeLinkedTxns: true
    });
  }
  if (job.resourceName === "quickbooks_credit_memos") {
    return client.buildCreditMemoQuery({
      requestId: job.checkpointKey,
      maxReturned,
      iterator,
      ...(iterator?.mode === "Continue" ? {} : { txnDateRange }),
      includeLineItems: true,
      includeLinkedTxns: true
    });
  }
  if (job.resourceName === "quickbooks_receive_payments") {
    return client.buildReceivePaymentQuery({
      requestId: job.checkpointKey,
      maxReturned,
      iterator,
      ...(iterator?.mode === "Continue" ? {} : { txnDateRange })
    });
  }
  if (job.resourceName === "quickbooks_purchase_orders") {
    return client.buildPurchaseOrderQuery({
      requestId: job.checkpointKey,
      maxReturned,
      iterator,
      ...(iterator?.mode === "Continue" ? {} : { txnDateRange }),
      includeLineItems: true,
      includeLinkedTxns: true
    });
  }
  return client.buildTxnDeletedQuery({
    requestId: job.checkpointKey,
    maxReturned,
    iterator,
    ...(iterator?.mode === "Continue" ? {} : { deletedDateRange: txnDateRange }),
    txnDeletedTypes: ["Invoice", "CreditMemo", "ReceivePayment", "PurchaseOrder", "Bill", "VendorCredit"]
  });
}

function buildSeedRows() {
  const rows = [
    checkpointRow("quickbooks_sales_reps", "all", null, null),
    checkpointRow("quickbooks_customers", "all", null, null),
    checkpointRow("quickbooks_vendors", "all", null, null),
    checkpointRow("quickbooks_items", "all", null, null)
  ];

  for (const week of salesTruthWeeklyWindows()) {
    rows.push(checkpointRow("quickbooks_credit_memos", salesTruthWeeklyKey(week), week.start, week.end));
    rows.push(checkpointRow("quickbooks_invoices", salesTruthWeeklyKey(week), week.start, week.end));
  }

  for (const month of salesTruthMonthlyWindows()) {
    rows.push(checkpointRow("quickbooks_credit_memos", salesTruthMonthlyKey(month), month.start, month.end));
    rows.push(checkpointRow("quickbooks_invoices", salesTruthMonthlyKey(month), month.start, month.end));
  }

  for (const date of eachDate(getBackfillStart(), getBackfillEnd())) {
    if (isPrioritySalesTruthDate(date)) continue;
    rows.push(checkpointRow("quickbooks_credit_memos", date, date, date));
    rows.push(checkpointRow("quickbooks_invoices", date, date, date));
  }

  for (const month of eachMonth(getBackfillStart(), getBackfillEnd())) {
    rows.push(checkpointRow("quickbooks_receive_payments", month.key, month.start, month.end));
    rows.push(checkpointRow("quickbooks_purchase_orders", month.key, month.start, month.end));
    rows.push(checkpointRow("quickbooks_txn_deleted", month.key, month.start, month.end));
  }

  return rows;
}

function checkpointRow(resourceName: QuickBooksRecoveryResource, checkpointKey: string, startDate: string | null, endDate: string | null) {
  return {
    source_system: SOURCE_SYSTEM,
    resource_name: resourceName,
    checkpoint_key: checkpointKey,
    status: "pending",
    requested_start_date: startDate,
    requested_end_date: endDate,
    cursor_data: {},
    diagnostics: { recovery: true }
  };
}

function recoveryResources(): QuickBooksRecoveryResource[] {
  return [
    ...initialRecoveryResources(),
    ...salesTruthRecoveryResources(),
    ...itemRecoveryResources(),
    ...followUpRecoveryResources()
  ];
}

function initialRecoveryResources(): QuickBooksRecoveryResource[] {
  return [
    "quickbooks_sales_reps",
    "quickbooks_customers",
    "quickbooks_vendors"
  ];
}

function salesTruthRecoveryResources(): QuickBooksRecoveryResource[] {
  return [
    "quickbooks_invoices",
    "quickbooks_credit_memos"
  ];
}

function itemRecoveryResources(): QuickBooksRecoveryResource[] {
  return [
    "quickbooks_items"
  ];
}

function followUpRecoveryResources(): QuickBooksRecoveryResource[] {
  return [
    "quickbooks_receive_payments",
    "quickbooks_purchase_orders",
    "quickbooks_txn_deleted"
  ];
}

function recoveryPriorityWindows(): QuickBooksDateRange[] {
  const backfillStart = getBackfillStart();
  const backfillEnd = getBackfillEnd();
  const priorityYearStart = `${SALES_TRUTH_PRIORITY_YEAR}-01-01`;
  const olderEnd = dayBefore(priorityYearStart);

  return [
    ...salesTruthPriorityWindows(),
    clampDateRange({ from: backfillStart, to: olderEnd }, backfillStart, backfillEnd)
  ].filter((window): window is QuickBooksDateRange => Boolean(window));
}

function salesTruthPriorityWindows(): QuickBooksDateRange[] {
  return [
    ...ytdSalesTruthWindows(),
    ...priorityYearSalesTruthWindows()
  ];
}

function ytdSalesTruthWindows(): QuickBooksDateRange[] {
  const backfillStart = getBackfillStart();
  const backfillEnd = getBackfillEnd();
  const ytdYear = Number(backfillEnd.slice(0, 4));
  const ytdStart = `${ytdYear}-01-01`;

  return [
    clampDateRange({ from: ytdStart, to: backfillEnd }, backfillStart, backfillEnd)
  ].filter((window): window is QuickBooksDateRange => Boolean(window));
}

function priorityYearSalesTruthWindows(): QuickBooksDateRange[] {
  const backfillStart = getBackfillStart();
  const backfillEnd = getBackfillEnd();
  const priorityYearStart = `${SALES_TRUTH_PRIORITY_YEAR}-01-01`;
  const priorityYearEnd = `${SALES_TRUTH_PRIORITY_YEAR}-12-31`;

  return [
    clampDateRange({ from: priorityYearStart, to: priorityYearEnd }, backfillStart, backfillEnd)
  ].filter((window): window is QuickBooksDateRange => Boolean(window));
}

function salesTruthWeeklyWindows() {
  return ytdSalesTruthWindows().flatMap((window) => eachFixedWindow(window.from || "", window.to || "", SALES_TRUTH_WEEKLY_CHUNK_DAYS));
}

function salesTruthWeeklyKey(window: { start: string; end: string }) {
  return `${SALES_TRUTH_WEEKLY_KEY_PREFIX}:${window.start}:${window.end}`;
}

function salesTruthTwoWeekKey(window: { start: string; end: string }) {
  return `${SALES_TRUTH_TWO_WEEK_KEY_PREFIX}:${window.start}:${window.end}`;
}

function salesTruthMonthlyWindows() {
  return priorityYearSalesTruthWindows().flatMap((window) => eachMonth(window.from || "", window.to || ""));
}

function salesTruthMonthlyKey(window: { start: string; end: string }) {
  return `${SALES_TRUTH_MONTHLY_KEY_PREFIX}:${window.start}:${window.end}`;
}

function isPrioritySalesTruthDate(date: string) {
  return salesTruthPriorityWindows().some((window) => (!window.from || date >= window.from) && (!window.to || date <= window.to));
}

function clampDateRange(range: QuickBooksDateRange, minimum: string, maximum: string): QuickBooksDateRange | null {
  const from = maxDateString(range.from || minimum, minimum);
  const to = minDateString(range.to || maximum, maximum);
  return from <= to ? { from, to } : null;
}

function dayBefore(value: string) {
  const date = new Date(value + "T00:00:00.000Z");
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function iteratorFor(cursorData: Record<string, unknown>) {
  const iteratorId = stringValue(cursorData.iteratorId);
  if (!iteratorId) return { mode: "Start" as QuickBooksIteratorMode };
  return { mode: "Continue" as QuickBooksIteratorMode, iteratorId };
}

function dateRangeFor(job: QuickBooksRecoveryJob): QuickBooksDateRange | undefined {
  if (!job.requestedStartDate && !job.requestedEndDate) return undefined;
  return { from: job.requestedStartDate || undefined, to: job.requestedEndDate || undefined };
}

function useInventoryOnlyItemQuery(job: QuickBooksRecoveryJob) {
  return job.diagnostics.itemQueryMode === "inventory_only" || job.diagnostics.requestType === "ItemInventoryQueryRq";
}

function toRecoveryJob(row: SourceSyncCheckpointRow): QuickBooksRecoveryJob {
  return {
    id: row.id,
    resourceName: row.resource_name,
    checkpointKey: row.checkpoint_key,
    requestedStartDate: row.requested_start_date,
    requestedEndDate: row.requested_end_date,
    cursorData: row.cursor_data || {},
    diagnostics: row.diagnostics || {}
  };
}

async function updateJob(supabase: SupabaseClient, id: string, values: Record<string, unknown>) {
  const { error } = await supabase.from("source_sync_checkpoints").update({ ...values, updated_at: new Date().toISOString() }).eq("id", id);
  if (error) throw new Error(error.message);
}

function eachDate(start: string, end: string) {
  const dates: string[] = [];
  const current = new Date(start + "T00:00:00.000Z");
  const last = new Date(end + "T00:00:00.000Z");
  while (current <= last) {
    dates.push(current.toISOString().slice(0, 10));
    current.setUTCDate(current.getUTCDate() + 1);
  }
  return dates;
}

function eachFixedWindow(start: string, end: string, days: number) {
  const windows: Array<{ start: string; end: string }> = [];
  const first = new Date(start + "T00:00:00.000Z");
  const final = new Date(end + "T00:00:00.000Z");
  const current = new Date(first);

  while (current <= final) {
    const windowStart = new Date(current);
    const windowEnd = new Date(current);
    windowEnd.setUTCDate(windowEnd.getUTCDate() + days - 1);
    windows.push({
      start: windowStart.toISOString().slice(0, 10),
      end: minDateString(windowEnd.toISOString().slice(0, 10), end)
    });
    current.setUTCDate(current.getUTCDate() + days);
  }

  return windows;
}

function eachMonth(start: string, end: string) {
  const months: Array<{ key: string; start: string; end: string }> = [];
  const first = new Date(start + "T00:00:00.000Z");
  const final = new Date(end + "T00:00:00.000Z");
  const current = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1));

  while (current <= final) {
    const monthStart = new Date(current);
    const nextMonth = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + 1, 1));
    const monthEnd = new Date(nextMonth);
    monthEnd.setUTCDate(monthEnd.getUTCDate() - 1);

    months.push({
      key: monthStart.toISOString().slice(0, 7),
      start: maxDateString(monthStart.toISOString().slice(0, 10), start),
      end: minDateString(monthEnd.toISOString().slice(0, 10), end)
    });
    current.setUTCMonth(current.getUTCMonth() + 1);
  }

  return months;
}

function maxDateString(a: string, b: string) {
  return a >= b ? a : b;
}

function minDateString(a: string, b: string) {
  return a <= b ? a : b;
}

function getBackfillStart() {
  return process.env.QUICKBOOKS_RECOVERY_BACKFILL_START || DEFAULT_BACKFILL_START;
}

function getBackfillEnd() {
  return process.env.QUICKBOOKS_RECOVERY_BACKFILL_END || currentDateString();
}

function getMaxReturned() {
  const value = Number(process.env.QUICKBOOKS_RECOVERY_MAX_RETURNED || DEFAULT_MAX_RETURNED);
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : DEFAULT_MAX_RETURNED;
}

function isAutoSeedEnabled() {
  return process.env.QUICKBOOKS_RECOVERY_AUTO_SEED !== "false";
}

function numberValue(value: unknown) {
  const numeric = Number(value || 0);
  return Number.isFinite(numeric) ? numeric : 0;
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function currentDateString() {
  return new Date().toISOString().slice(0, 10);
}

function isQuickBooksErrorStatus(status: QuickBooksQbxmlResponseStatus | null) {
  return status?.statusSeverity === "Error" || Boolean(status?.statusCode && status.statusCode >= 3000);
}
