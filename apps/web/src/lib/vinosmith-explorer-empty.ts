import type { VinosmithExplorerData, VinosmithProductHealth } from "./types";
export function emptyExplorerData(error: string | null): VinosmithExplorerData {
  return {
    error,
    counts: {
      wines: 0,
      latestWinesResponse: null,
      accounts: 0,
      contacts: 0,
      salesReps: 0,
      prices: 0,
      latestInventoryRows: 0,
      latestInventoryWines: 0,
      orders: 0,
      orderLines: 0,
      prearrivals: 0
    },
    latestInventorySnapshotDate: null,
    wines: [],
    inventory: [],
    priceSummaries: [],
    accounts: [],
    contacts: [],
    salesReps: [],
    recentOrders: [],
    syncRuns: [],
    checkpoints: [],
    productHealth: emptyProductHealth("Not available because Vinosmith plumbing data could not be loaded.")
  };
}

export function emptyProductHealth(changedRecordsNote: string): VinosmithProductHealth {
  return {
    latestSuccessfulPullAt: null,
    latestCompletedRunId: null,
    failedRecentSyncs: 0,
    activeQbVsInactiveOrMissingVs: 0,
    activeQbVsInactiveVs: 0,
    activeQbVsMissingVs: 0,
    activeQbVsUnknownVs: 0,
    activeOrderableVsVsInactiveOrMissingQb: 0,
    activeOrderableVsVsInactiveQb: 0,
    activeOrderableVsVsMissingQb: 0,
    missingSupplierImporterOrBrand: 0,
    unmatchedItemCodes: 0,
    changedRecordsSinceLastSync: null,
    changedRecordsWindowStart: null,
    changedRecordsNote,
    examples: {
      qbActiveVsInactiveOrMissingVs: [],
      vsActiveOrderableVsInactiveOrMissingQb: [],
      metadataGaps: [],
      unmatchedItemCodes: []
    }
  };
}

export function unavailableVinosmithExplorerData(error: string): VinosmithExplorerData {
  return emptyExplorerData(error);
}