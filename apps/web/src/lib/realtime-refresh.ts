export const REALTIME_REFRESH_DEBOUNCE_MS = 250;
export const LOCAL_DRAFT_MUTATION_SETTLE_MS = 750;

type RealtimeRefreshDelayInput = {
  now: number;
  requestedDelayMs?: number;
  blockedUntil: number;
  mutationDepth: number;
};

/**
 * Returns null while a local mutation owns the draft state. Once the mutation
 * finishes, the refresh waits for both the normal debounce and the local
 * settle window so an RSC request cannot race the mutation response.
 */
export function nextRealtimeRefreshDelay({
  now,
  requestedDelayMs = REALTIME_REFRESH_DEBOUNCE_MS,
  blockedUntil,
  mutationDepth
}: RealtimeRefreshDelayInput): number | null {
  if (mutationDepth > 0) return null;
  return Math.max(0, requestedDelayMs, blockedUntil - now);
}
