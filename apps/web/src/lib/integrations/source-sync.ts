import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export const SOURCE_SYSTEMS = ["quickbooks_desktop", "vinosmith", "email", "manual", "stem"] as const;
export const SOURCE_SYNC_TYPES = ["discovery", "historical_backfill", "daily_refresh", "parity_check", "manual_poc"] as const;
export const SOURCE_SYNC_STATUSES = ["pending", "running", "completed", "failed", "cancelled"] as const;
export const SOURCE_CHECKPOINT_STATUSES = ["pending", "running", "completed", "failed", "needs_repair"] as const;
export const PRODUCT_SOURCE_MATCH_STATUSES = ["unmapped", "candidate", "matched", "ignored", "conflict"] as const;

export type SourceSystem = (typeof SOURCE_SYSTEMS)[number];
export type SourceSyncType = (typeof SOURCE_SYNC_TYPES)[number];
export type SourceSyncStatus = (typeof SOURCE_SYNC_STATUSES)[number];
export type SourceCheckpointStatus = (typeof SOURCE_CHECKPOINT_STATUSES)[number];
export type ProductSourceMatchStatus = (typeof PRODUCT_SOURCE_MATCH_STATUSES)[number];

export type SourceSyncRun = {
  id: string;
  source_system: SourceSystem;
  sync_type: SourceSyncType;
  status: SourceSyncStatus;
  requested_start_date: string | null;
  requested_end_date: string | null;
  started_at: string;
  completed_at: string | null;
  triggered_by: string | null;
  worker_name: string | null;
  parameters: Record<string, unknown>;
  diagnostics: Record<string, unknown>;
  error_message: string | null;
  created_at: string;
};

export type SourceApiResponse = {
  id: string;
  source_sync_run_id: string | null;
  source_system: SourceSystem;
  endpoint: string;
  request_method: string;
  request_identifier: string | null;
  requested_params: Record<string, unknown>;
  returned_metadata: Record<string, unknown>;
  response_status: number | null;
  response_status_text: string | null;
  content_type: string | null;
  byte_size: number | null;
  checksum: string | null;
  raw_storage_path: string | null;
  record_count: number | null;
  fetched_at: string;
  created_at: string;
};

export type SourceSyncCheckpoint = {
  id: string;
  source_system: SourceSystem;
  resource_name: string;
  checkpoint_key: string;
  status: SourceCheckpointStatus;
  requested_start_date: string | null;
  requested_end_date: string | null;
  completed_through: string | null;
  cursor_data: Record<string, unknown>;
  last_source_sync_run_id: string | null;
  diagnostics: Record<string, unknown>;
  last_synced_at: string | null;
  created_at: string;
  updated_at: string;
};

export type ProductSourceLink = {
  id: string;
  product_id: string | null;
  source_system: SourceSystem;
  source_entity_type: string;
  source_id: string;
  source_code: string | null;
  source_name: string | null;
  match_status: ProductSourceMatchStatus;
  confidence: number | string;
  is_primary: boolean;
  metadata: Record<string, unknown>;
  first_seen_at: string;
  last_seen_at: string;
  created_at: string;
  updated_at: string;
};

export type CreateSourceSyncRunInput = {
  sourceSystem: SourceSystem;
  syncType: SourceSyncType;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  triggeredBy?: string | null;
  workerName?: string | null;
  parameters?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
};

export type RecordSourceApiResponseInput = {
  sourceSystem: SourceSystem;
  endpoint: string;
  sourceSyncRunId?: string | null;
  requestMethod?: string;
  requestIdentifier?: string | null;
  requestedParams?: Record<string, unknown>;
  returnedMetadata?: Record<string, unknown>;
  responseStatus?: number | null;
  responseStatusText?: string | null;
  contentType?: string | null;
  byteSize?: number | null;
  checksum?: string | null;
  rawStoragePath?: string | null;
  recordCount?: number | null;
  fetchedAt?: string | null;
};

export type UpsertSourceSyncCheckpointInput = {
  sourceSystem: SourceSystem;
  resourceName: string;
  checkpointKey: string;
  status?: SourceCheckpointStatus;
  requestedStartDate?: string | null;
  requestedEndDate?: string | null;
  completedThrough?: string | null;
  cursorData?: Record<string, unknown>;
  lastSourceSyncRunId?: string | null;
  diagnostics?: Record<string, unknown>;
  lastSyncedAt?: string | null;
};

export type UpsertProductSourceLinkInput = {
  sourceSystem: SourceSystem;
  sourceEntityType: string;
  sourceId: string;
  productId?: string | null;
  sourceCode?: string | null;
  sourceName?: string | null;
  matchStatus?: ProductSourceMatchStatus;
  confidence?: number;
  isPrimary?: boolean;
  metadata?: Record<string, unknown>;
};

export async function createSourceSyncRun(supabase: SupabaseClient, input: CreateSourceSyncRunInput) {
  const payload = {
    source_system: input.sourceSystem,
    sync_type: input.syncType,
    status: "running" satisfies SourceSyncStatus,
    requested_start_date: input.requestedStartDate || null,
    requested_end_date: input.requestedEndDate || null,
    triggered_by: input.triggeredBy || null,
    worker_name: input.workerName || null,
    parameters: input.parameters || {},
    diagnostics: input.diagnostics || {}
  };

  const { data, error } = await supabase.from("source_sync_runs").insert(payload).select("*").single<SourceSyncRun>();
  if (error || !data) {
    throw new Error(error?.message || "Could not create source sync run.");
  }
  return data;
}

export async function completeSourceSyncRun(
  supabase: SupabaseClient,
  sourceSyncRunId: string,
  diagnostics?: Record<string, unknown>
) {
  const payload = {
    status: "completed" satisfies SourceSyncStatus,
    completed_at: new Date().toISOString(),
    ...(diagnostics ? { diagnostics } : {})
  };

  const { data, error } = await supabase
    .from("source_sync_runs")
    .update(payload)
    .eq("id", sourceSyncRunId)
    .select("*")
    .single<SourceSyncRun>();
  if (error || !data) {
    throw new Error(error?.message || "Could not complete source sync run.");
  }
  return data;
}

export async function failSourceSyncRun(supabase: SupabaseClient, sourceSyncRunId: string, errorMessage: string) {
  const { data, error } = await supabase
    .from("source_sync_runs")
    .update({
      status: "failed" satisfies SourceSyncStatus,
      completed_at: new Date().toISOString(),
      error_message: errorMessage
    })
    .eq("id", sourceSyncRunId)
    .select("*")
    .single<SourceSyncRun>();
  if (error || !data) {
    throw new Error(error?.message || "Could not fail source sync run.");
  }
  return data;
}

export async function recordSourceApiResponse(supabase: SupabaseClient, input: RecordSourceApiResponseInput) {
  const payload = {
    source_sync_run_id: input.sourceSyncRunId || null,
    source_system: input.sourceSystem,
    endpoint: input.endpoint,
    request_method: input.requestMethod || "GET",
    request_identifier: input.requestIdentifier || null,
    requested_params: input.requestedParams || {},
    returned_metadata: input.returnedMetadata || {},
    response_status: input.responseStatus ?? null,
    response_status_text: input.responseStatusText || null,
    content_type: input.contentType || null,
    byte_size: input.byteSize ?? null,
    checksum: input.checksum || null,
    raw_storage_path: input.rawStoragePath || null,
    record_count: input.recordCount ?? null,
    fetched_at: input.fetchedAt || new Date().toISOString()
  };

  const { data, error } = await supabase.from("source_api_responses").insert(payload).select("*").single<SourceApiResponse>();
  if (error || !data) {
    throw new Error(error?.message || "Could not record source API response.");
  }
  return data;
}

export async function upsertSourceSyncCheckpoint(supabase: SupabaseClient, input: UpsertSourceSyncCheckpointInput) {
  const payload = {
    source_system: input.sourceSystem,
    resource_name: input.resourceName,
    checkpoint_key: input.checkpointKey,
    status: input.status || ("pending" satisfies SourceCheckpointStatus),
    requested_start_date: input.requestedStartDate || null,
    requested_end_date: input.requestedEndDate || null,
    completed_through: input.completedThrough || null,
    cursor_data: input.cursorData || {},
    last_source_sync_run_id: input.lastSourceSyncRunId || null,
    diagnostics: input.diagnostics || {},
    last_synced_at: input.lastSyncedAt || null,
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .upsert(payload, { onConflict: "source_system,resource_name,checkpoint_key" })
    .select("*")
    .single<SourceSyncCheckpoint>();
  if (error || !data) {
    throw new Error(error?.message || "Could not upsert source sync checkpoint.");
  }
  return data;
}

export async function upsertProductSourceLink(supabase: SupabaseClient, input: UpsertProductSourceLinkInput) {
  const payload = {
    product_id: input.productId || null,
    source_system: input.sourceSystem,
    source_entity_type: input.sourceEntityType,
    source_id: input.sourceId,
    source_code: input.sourceCode || null,
    source_name: input.sourceName || null,
    match_status: input.matchStatus || ("unmapped" satisfies ProductSourceMatchStatus),
    confidence: Math.max(0, Math.min(1, input.confidence || 0)),
    is_primary: Boolean(input.isPrimary),
    metadata: input.metadata || {},
    last_seen_at: new Date().toISOString(),
    updated_at: new Date().toISOString()
  };

  const { data, error } = await supabase
    .from("product_source_links")
    .upsert(payload, { onConflict: "source_system,source_entity_type,source_id" })
    .select("*")
    .single<ProductSourceLink>();
  if (error || !data) {
    throw new Error(error?.message || "Could not upsert product source link.");
  }
  return data;
}
