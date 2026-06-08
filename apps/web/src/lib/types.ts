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

export type SupplierCatalogWine = {
  id: string;
  supplier_id: string | null;
  supplier_name: string;
  producer: string;
  wine_name: string;
  vintage: string;
  pack_size: number | string;
  bottle_size: string;
  pricing_basis: string;
  fob_bottle: number | string;
  fob_case: number | string;
  laid_in_per_bottle: number | string;
  landed_bottle_cost: number | string;
  frontline_bottle_price: number | string;
  best_price: number | string | null;
  gross_profit_margin: number | string;
  availability_status: string;
  conversion_status: string;
  display_name: string;
  planning_sku: string;
  planning_sku_without_vintage: string;
  diagnostics: Record<string, unknown> | null;
  quickbooks_item_id: string | null;
  quickbooks_item_name: string | null;
  quickbooks_sync_status: string;
  product_lifecycle_status: string;
  accounting_create_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type WineRequest = {
  id: string;
  request_id: string;
  account_customer: string;
  requested_quantity: number | string;
  needed_by_date: string | null;
  placement_type: string;
  source_type: string;
  supplier_catalog_wine_id: string | null;
  wine_display_name: string;
  supplier_name: string;
  requester_name: string;
  notes: string | null;
  request_status: string;
  fulfillment_status: string;
  approval_decision: string | null;
  approver_name: string | null;
  ordering_workflow_payload: Record<string, unknown> | null;
  created_at: string;
  updated_at: string;
};

export type PriceChangeEvent = {
  id: string;
  supplier_catalog_wine_id: string | null;
  supplier: string;
  wine: string;
  vintage: string;
  old_fob: number | string | null;
  new_fob: number | string | null;
  old_frontline: number | string | null;
  new_frontline: number | string | null;
  old_best_price: number | string | null;
  new_best_price: number | string | null;
  margin_before: number | string | null;
  margin_after: number | string | null;
  effective_date: string | null;
  reason: string | null;
  status: string;
  fob_increase: boolean;
  created_at: string;
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
  recommendation_id?: string | null;
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
