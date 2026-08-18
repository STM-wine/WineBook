export type ProductWorkspaceSource = "quickbooks" | "vinosmith" | "supplier_hub" | "stem";

export type ProductWorkspaceStatusKey =
  | "active_match"
  | "inactive_match"
  | "qb_active_vs_inactive"
  | "qb_active_vs_missing"
  | "qb_active_vs_unknown"
  | "qb_active_non_product"
  | "qb_inactive_vs_unknown"
  | "qb_inactive_vs_active"
  | "vs_active_qb_missing";

export type ProductWorkspacePriceLevel = {
  id: string;
  name: string;
  bottlePrice: number | null;
  depletionAllowance: number;
  calculatedGpPercent: number | null;
  isFrontline: boolean;
  isBest: boolean;
  source: "Vinosmith" | "Supplier Hub";
};

export type ProductWorkspaceRow = {
  id: string;
  itemCode: string;
  productName: string;
  brand: string | null;
  vintage: string | null;
  pack: string | null;
  supplierName: string | null;
  supplierSource: string | null;
  revenueCenter: string;
  active: boolean | null;
  statusKey: ProductWorkspaceStatusKey;
  statusLabel: string;
  statusDetail: string;
  fob: number | null;
  fobSource: string | null;
  laidIn: number | null;
  laidInSource: string | null;
  landedCost: number | null;
  frontline: number | null;
  bestPrice: number | null;
  lowestGpPercent: number | null;
  lastSold: string | null;
  ytdSales: number | null;
  sourceHealth: "ready" | "partial" | "needs_review";
  sourceHealthLabel: string;
  sourceBadges: ProductWorkspaceSource[];
  quickbooks: {
    listId: string;
    fullName: string;
    purchaseCost: number | null;
    averageCost: number | null;
    salesPrice: number | null;
    itemType: string | null;
    lastSeenAt: string | null;
  };
  vinosmith: {
    wineId: string;
    code: string | null;
    name: string | null;
    active: boolean | null;
    orderable: boolean | null;
    lastSeenAt: string | null;
  } | null;
  supplierCatalog: {
    id: string;
    displayName: string;
    conversionStatus: string;
    lifecycleStatus: string;
    quickbooksSyncStatus: string;
  } | null;
  priceLevels: ProductWorkspacePriceLevel[];
  gpExplanation: string;
};

export type ProductWorkspaceSummary = {
  total: number;
  active: number;
  inactive: number;
  visible: number;
  ready: number;
  partial: number;
  needsReview: number;
  lifecycleMismatches: number;
  qbActiveVsInactive: number;
  qbActiveVsMissing: number;
  qbActiveVsUnknown: number;
  vsStatusUnknown: number;
  qbInactiveVsActive: number;
  vsActiveQbMissing: number;
};

export type ProductWorkspaceResponse = {
  rows: ProductWorkspaceRow[];
  summary: ProductWorkspaceSummary;
  includeInactive: boolean;
  generatedAt: string;
};
