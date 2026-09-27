export const QUICKBOOKS_SYNC_ACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

export type QuickBooksSyncActivityRow = {
  status: string;
  started_at: string;
  diagnostics?: Record<string, unknown> | null;
};

export function quickBooksSyncCompletedRequestCount(run: QuickBooksSyncActivityRow) {
  const value = run.diagnostics?.completed_request_count;
  if (typeof value === "number" && Number.isFinite(value)) return Math.max(0, value);
  if (typeof value === "string" && value.trim()) {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return Math.max(0, parsed);
  }
  return null;
}

export function isQuickBooksSyncNonMaterialFailure(run: QuickBooksSyncActivityRow | null) {
  return Boolean(
    run
    && run.status === "failed"
    && quickBooksSyncCompletedRequestCount(run) === 0
  );
}

export function quickBooksSyncLastActivityAt(run: QuickBooksSyncActivityRow) {
  const diagnosticValue = run.diagnostics?.last_activity_at;
  return typeof diagnosticValue === "string" && diagnosticValue.trim()
    ? diagnosticValue
    : run.started_at;
}

export function isQuickBooksSyncActivelyRunning(
  run: QuickBooksSyncActivityRow | null,
  now = new Date()
) {
  if (!run || run.status !== "running") return false;
  const lastActivityMs = Date.parse(quickBooksSyncLastActivityAt(run));
  if (!Number.isFinite(lastActivityMs)) return false;
  return now.getTime() - lastActivityMs <= QUICKBOOKS_SYNC_ACTIVITY_TIMEOUT_MS;
}
