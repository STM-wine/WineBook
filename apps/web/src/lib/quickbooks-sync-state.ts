export const QUICKBOOKS_SYNC_ACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;

export type QuickBooksSyncActivityRow = {
  status: string;
  started_at: string;
  diagnostics?: Record<string, unknown> | null;
};

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
