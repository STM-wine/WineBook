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
const DEFAULT_BACKFILL_END = "2026-08-14";
const DEFAULT_MAX_RETURNED = 200;
const STALE_RUNNING_MINUTES = 30;

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
  status: "pending" | "running" | "completed" | "failed" | "cancelled" | "needs_repair";
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
    const { data, error } = await supabase
      .from("source_sync_checkpoints")
      .select("resource_name,checkpoint_key,status,requested_start_date,requested_end_date,cursor_data,diagnostics,updated_at,created_at")
      .eq("source_system", SOURCE_SYSTEM)
      .in("resource_name", recoveryResources())
      .returns<Array<Omit<SourceSyncCheckpointRow, "id" | "last_synced_at">>>();

    if (error) throw new Error(error.message);
    const rows = data || [];
    const pendingRows = rows.filter((row) => row.status === "pending").sort(compareRecoveryRows).slice(0, 8);
    return {
      configured: true,
      autoSeedEnabled: isAutoSeedEnabled(),
      backfillStart: getBackfillStart(),
      backfillEnd: getBackfillEnd(),
      pending: rows.filter((row) => row.status === "pending").length,
      running: rows.filter((row) => row.status === "running").length,
      completed: rows.filter((row) => row.status === "completed").length,
      failed: rows.filter((row) => row.status === "failed" || row.status === "needs_repair").length,
      nextJobs: pendingRows.map((row) => ({
        resourceName: row.resource_name,
        checkpointKey: row.checkpoint_key,
        requestedStartDate: row.requested_start_date,
        requestedEndDate: row.requested_end_date,
        status: row.status
      }))
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
) {
  const supabase = createServiceRoleClient();
  const firstStatus = statuses[0] || null;
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
    await updateJob(supabase, job.id, {
      status: "pending",
      cursor_data: { iteratorId, iteratorMode: "Continue" },
      diagnostics,
      last_synced_at: receivedAt
    });
    return;
  }

  await updateJob(supabase, job.id, {
    status: "completed",
    cursor_data: {},
    diagnostics,
    last_synced_at: receivedAt
  });
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
  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .select("id,resource_name,checkpoint_key,status,requested_start_date,requested_end_date,cursor_data,diagnostics,last_synced_at,updated_at,created_at")
    .eq("source_system", SOURCE_SYSTEM)
    .in("resource_name", recoveryResources())
    .eq("status", "pending")
    .limit(250)
    .returns<SourceSyncCheckpointRow[]>();
  if (error) throw new Error(error.message);

  const row = (data || []).sort(compareRecoveryRows)[0];
  if (!row) return null;

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

  if (updateError || !updated) return null;
  return toRecoveryJob(updated);
}

function buildRequestForJob(job: QuickBooksRecoveryJob): QuickBooksDesktopQbxmlRequest {
  const client = createQuickBooksDesktopReadOnlyClient();
  const maxReturned = getMaxReturned();
  const iterator = iteratorFor(job.cursorData);
  const txnDateRange = dateRangeFor(job);

  if (job.resourceName === "quickbooks_sales_reps") return client.buildSalesRepQuery();
  if (job.resourceName === "quickbooks_customers") return client.buildCustomerQuery({ maxReturned, activeStatus: "All", iterator });
  if (job.resourceName === "quickbooks_vendors") return client.buildVendorQuery({ maxReturned, activeStatus: "All", iterator });
  if (job.resourceName === "quickbooks_items") return client.buildItemQuery({ maxReturned, activeStatus: "All", iterator });
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

  for (const date of eachDate(getBackfillStart(), getBackfillEnd())) {
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

function compareRecoveryRows(a: Pick<SourceSyncCheckpointRow, "resource_name" | "requested_start_date" | "checkpoint_key" | "created_at">, b: Pick<SourceSyncCheckpointRow, "resource_name" | "requested_start_date" | "checkpoint_key" | "created_at">) {
  const priority = resourcePriority(a.resource_name) - resourcePriority(b.resource_name);
  if (priority !== 0) return priority;
  const dateCompare = (a.requested_start_date || "0000-00-00").localeCompare(b.requested_start_date || "0000-00-00");
  if (dateCompare !== 0) return dateCompare;
  return a.checkpoint_key.localeCompare(b.checkpoint_key);
}

function resourcePriority(resourceName: string) {
  if (resourceName === "quickbooks_sales_reps") return 0;
  if (resourceName === "quickbooks_customers") return 1;
  if (resourceName === "quickbooks_vendors") return 2;
  if (resourceName === "quickbooks_items") return 3;
  if (resourceName === "quickbooks_credit_memos") return 4;
  if (resourceName === "quickbooks_invoices") return 5;
  if (resourceName === "quickbooks_receive_payments") return 6;
  if (resourceName === "quickbooks_purchase_orders") return 7;
  if (resourceName === "quickbooks_txn_deleted") return 8;
  return 99;
}

function recoveryResources(): QuickBooksRecoveryResource[] {
  return [
    "quickbooks_sales_reps",
    "quickbooks_customers",
    "quickbooks_vendors",
    "quickbooks_items",
    "quickbooks_credit_memos",
    "quickbooks_invoices",
    "quickbooks_receive_payments",
    "quickbooks_purchase_orders",
    "quickbooks_txn_deleted"
  ];
}

function iteratorFor(cursorData: Record<string, unknown>) {
  const iteratorId = stringValue(cursorData.iteratorId);
  if (!iteratorId) return undefined;
  return { mode: "Continue" as QuickBooksIteratorMode, iteratorId };
}

function dateRangeFor(job: QuickBooksRecoveryJob): QuickBooksDateRange | undefined {
  if (!job.requestedStartDate && !job.requestedEndDate) return undefined;
  return { from: job.requestedStartDate || undefined, to: job.requestedEndDate || undefined };
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
  return process.env.QUICKBOOKS_RECOVERY_BACKFILL_END || DEFAULT_BACKFILL_END;
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
