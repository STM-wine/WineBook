import { describe, expect, it } from "vitest";
import {
  LOCAL_DRAFT_MUTATION_SETTLE_MS,
  REALTIME_REFRESH_DEBOUNCE_MS,
  nextRealtimeRefreshDelay
} from "./realtime-refresh";

describe("realtime refresh coordination", () => {
  it("defers refreshes while a local draft mutation is active", () => {
    expect(nextRealtimeRefreshDelay({
      now: 1_000,
      blockedUntil: 0,
      mutationDepth: 1
    })).toBeNull();
  });

  it("honors the post-mutation settle window", () => {
    expect(nextRealtimeRefreshDelay({
      now: 1_000,
      blockedUntil: 1_000 + LOCAL_DRAFT_MUTATION_SETTLE_MS,
      mutationDepth: 0
    })).toBe(LOCAL_DRAFT_MUTATION_SETTLE_MS);
  });

  it("uses the normal debounce once no mutation block remains", () => {
    expect(nextRealtimeRefreshDelay({
      now: 1_000,
      blockedUntil: 900,
      mutationDepth: 0
    })).toBe(REALTIME_REFRESH_DEBOUNCE_MS);
  });

  it("preserves a longer caller-requested delay", () => {
    expect(nextRealtimeRefreshDelay({
      now: 1_000,
      requestedDelayMs: 1_200,
      blockedUntil: 1_500,
      mutationDepth: 0
    })).toBe(1_200);
  });
});
