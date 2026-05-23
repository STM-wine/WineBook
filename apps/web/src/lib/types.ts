export type AppProfile = {
  id: string;
  email: string;
  full_name: string | null;
  role: "viewer" | "buyer" | "admin";
};

export type ReportRun = {
  id: string;
  report_date: string | null;
  completed_at: string | null;
  diagnostics?: Record<string, unknown> | null;
};

export type Recommendation = {
  id: string;
  report_run_id: string;
  planning_sku: string | null;
  product_name: string | null;
  product_code: string | null;
  supplier_name: string | null;
  brand_manager: string | null;
  is_btg: boolean | null;
  is_core: boolean | null;
  last_30_day_sales: number | string | null;
  last_60_day_sales: number | string | null;
  last_90_day_sales: number | string | null;
  last_365_day_sales?: number | string | null;
  last_12_month_sales?: number | string | null;
  next_30_day_forecast: number | string | null;
  next_60_day_forecast: number | string | null;
  next_90_day_forecast: number | string | null;
  weekly_velocity: number | string | null;
  velocity_trend_pct: number | string | null;
  velocity_trend_label: string | null;
  weeks_on_hand_with_on_order: number | string | null;
  weeks_on_hand: number | string | null;
  true_available: number | string | null;
  on_order: number | string | null;
  recommended_qty_rounded: number | string | null;
  approved_qty: number | string | null;
  recommendation_status: string | null;
  reorder_status: string | null;
  risk_level: string | null;
  pickup_location: string | null;
  order_cost: number | string | null;
  fob: number | string | null;
  pack_size?: number | string | null;
  trucking_cost_per_bottle: number | string | null;
  landed_cost: number | string | null;
  order_path?: "stateside" | "di" | string | null;
};

export type SupplierGroup = {
  supplier: string;
  rows: Recommendation[];
  skuCount: number;
  urgentCount: number;
  recommendedBottles: number;
  approvedBottles: number;
  suggestedValue: number;
  approvedValue: number;
};

export type SupplierLogistics = {
  id: string;
  importer_id: string | null;
  name: string;
  eta_days: number | string | null;
  pick_up_location: string | null;
  freight_forwarder: string | null;
  order_frequency: string | null;
  tdm: string | null;
  trucking_cost_per_bottle: number | string | null;
  notes: string | null;
  active: boolean | null;
};

export type DashboardMetrics = {
  urgent: number;
  low: number;
  recommendedBottles: number;
  approvedBottles: number;
  poValue: number;
  supplierCount: number;
};

export type PurchaseOrderDraft = {
  id: string;
  report_run_id: string | null;
  supplier_name: string | null;
  status: string;
  po_number: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type PurchaseOrderLine = {
  id: string;
  purchase_order_draft_id: string;
  product_name: string | null;
  product_code: string | null;
  planning_sku: string | null;
  recommended_qty: number | string | null;
  approved_qty: number | string | null;
  fob: number | string | null;
  line_cost: number | string | null;
  trucking_cost_per_bottle: number | string | null;
  wine_cost: number | string | null;
  laid_in_cost: number | string | null;
  landed_cost: number | string | null;
};

export type PurchaseOrderDraftWithLines = PurchaseOrderDraft & {
  lines: PurchaseOrderLine[];
};
