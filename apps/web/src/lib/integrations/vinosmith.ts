import "server-only";

export const VINOSMITH_DISTRIBUTOR_BASE_URL = "https://vinosmith.com/api/distributor";
export const VINOSMITH_SUPPLIER_ORDER_MAX_WINDOW_DAYS = 31;

export const VINOSMITH_DISTRIBUTOR_ENDPOINTS = {
  supplierOrders: "/supplier_orders",
  wines: "/wines",
  prices: "/prices",
  inventory: "/inventory"
} as const;

export const DEFAULT_VINOSMITH_DELIVERY_STATUSES = ["sent-to-warehouse"] as const;

type QueryValue = string | number | boolean | null | undefined;

export type VinosmithId = string;

export type VinosmithResponseMeta = {
  delivery_start_date?: string | null;
  delivery_end_date?: string | null;
  [key: string]: unknown;
};

export type VinosmithApiResponse<TData> = {
  data: TData;
  meta?: VinosmithResponseMeta;
  [key: string]: unknown;
};

export type VinosmithNamedEntity = {
  id?: VinosmithId | null;
  name?: string | null;
  [key: string]: unknown;
};

export type VinosmithWineSnapshot = {
  id: VinosmithId;
  code?: string | null;
  name?: string | null;
  vintage?: string | null;
  unit_set?: number | string | null;
  bottle_size?: string | null;
  bottle_size_label?: string | null;
  supplier_id?: VinosmithId | number | null;
  importer?: VinosmithNamedEntity | string | null;
  producer?: VinosmithNamedEntity | string | null;
  product_family?: VinosmithNamedEntity | string | null;
  fob_price?: number | string | null;
  external_identifier_1?: string | null;
  category?: string | null;
  upc?: string | null;
  country?: string | null;
  region?: string | null;
  appellation?: string | null;
  active?: boolean | null;
  orderable?: boolean | null;
  core?: boolean | null;
  admin_only?: boolean | null;
  inventory_item?: boolean | null;
  created_at?: string | null;
  updated_at?: string | null;
  [key: string]: unknown;
};

export type VinosmithAccountSnapshot = VinosmithNamedEntity & {
  account_number?: string | null;
};

export type VinosmithUserSnapshot = {
  id?: VinosmithId | null;
  email?: string | null;
  full_name?: string | null;
  [key: string]: unknown;
};

export type VinosmithOrderSnapshot = {
  id: VinosmithId;
  [key: string]: unknown;
};

export type VinosmithSupplierOrderSnapshot = {
  id: VinosmithId;
  invoice_number?: string | null;
  po_number?: string | null;
  order_at?: string | null;
  confirmed_at?: string | null;
  delivery_at?: string | null;
  due_at?: string | null;
  paid_at?: string | null;
  delivery_status?: string | null;
  payment_status?: string | null;
  warehouse?: VinosmithNamedEntity | null;
  total_cents?: number | null;
  balance_cents?: number | null;
  [key: string]: unknown;
};

export type VinosmithSupplierOrderLineItem = {
  id: VinosmithId;
  wine: VinosmithWineSnapshot;
  quantity?: number | string | null;
  price_cents?: number | null;
  total_cents?: number | null;
  discount?: number | string | null;
  manual_price?: boolean | null;
  commission_rate?: number | string | null;
  notes?: string | null;
  [key: string]: unknown;
};

export type VinosmithSupplierOrder = {
  account?: VinosmithAccountSnapshot | null;
  user?: VinosmithUserSnapshot | null;
  order?: VinosmithOrderSnapshot | null;
  supplier_order: VinosmithSupplierOrderSnapshot;
  line_items: VinosmithSupplierOrderLineItem[];
  [key: string]: unknown;
};

export type VinosmithSupplierOrdersResponse = VinosmithApiResponse<{
  supplier_orders: VinosmithSupplierOrder[];
}>;

export type VinosmithWinesResponse = VinosmithApiResponse<{
  wines: VinosmithWineSnapshot[];
}>;

export type VinosmithPriceSnapshot = {
  id: VinosmithId;
  label?: string | null;
  type?: string | null;
  price_cents?: number | null;
  bill_back_price_cents?: number | null;
  bill_back_at?: string | null;
  effective_start_at?: string | null;
  effective_end_at?: string | null;
  active?: boolean | null;
  disabled?: boolean | null;
  default?: boolean | null;
  premise?: string | null;
  marketplace?: string | null;
  minimum_quantity?: number | string | null;
  maximum_quantity?: number | string | null;
  reference_discount?: number | string | null;
  external_identifier?: string | null;
  [key: string]: unknown;
};

export type VinosmithPriceRecord = {
  price: VinosmithPriceSnapshot;
  wine: VinosmithWineSnapshot;
  [key: string]: unknown;
};

export type VinosmithPricesResponse = VinosmithApiResponse<{
  prices: VinosmithPriceRecord[];
}>;

export type VinosmithInventoryQuantities = {
  on_hand?: number | string | null;
  available?: number | string | null;
  on_hold?: number | string | null;
  on_order?: number | string | null;
  on_future?: number | string | null;
  on_pending_sync?: number | string | null;
  end_of_stock?: boolean | string | null;
  [key: string]: unknown;
};

export type VinosmithInventoryRecord = {
  wine: VinosmithWineSnapshot;
  inventory: VinosmithInventoryQuantities;
  warehouse?: VinosmithNamedEntity | null;
  [key: string]: unknown;
};

export type VinosmithInventoryResponse = VinosmithApiResponse<{
  inventory: VinosmithInventoryRecord[];
}>;

export type VinosmithSupplierOrdersParams = {
  deliveryStartDate: string;
  deliveryEndDate: string;
  accountId?: string;
};

export type VinosmithDistributorClientOptions = {
  token?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  userAgent?: string;
};

export class VinosmithApiError extends Error {
  status: number;
  statusText: string;
  bodySnippet: string;

  constructor(message: string, details: { status: number; statusText: string; bodySnippet: string }) {
    super(message);
    this.name = "VinosmithApiError";
    this.status = details.status;
    this.statusText = details.statusText;
    this.bodySnippet = details.bodySnippet;
  }
}

export function createVinosmithDistributorClient(options: VinosmithDistributorClientOptions = {}) {
  const token = (options.token || process.env.VINOSMITH_API_TOKEN || "").trim();
  const baseUrl = normalizeBaseUrl(options.baseUrl || VINOSMITH_DISTRIBUTOR_BASE_URL);
  const fetchImpl = options.fetchImpl || fetch;
  const userAgent = options.userAgent || "Stem-WineBook-Vinosmith-Distributor/1.0";

  if (!token) {
    throw new Error("Missing VINOSMITH_API_TOKEN for Vinosmith Distributor API access.");
  }

  async function getJson<TData>(path: string, query?: Record<string, QueryValue>) {
    const url = buildUrl(baseUrl, path, query);
    const response = await fetchImpl(url, {
      method: "GET",
      cache: "no-store",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${token}`,
        "User-Agent": userAgent
      }
    });

    if (!response.ok) {
      const bodySnippet = (await response.text()).slice(0, 2000);
      throw new VinosmithApiError(`Vinosmith request failed with HTTP ${response.status}.`, {
        status: response.status,
        statusText: response.statusText,
        bodySnippet
      });
    }

    return (await response.json()) as TData;
  }

  return {
    getSupplierOrders(params: VinosmithSupplierOrdersParams) {
      assertSupplierOrderWindow(params.deliveryStartDate, params.deliveryEndDate);
      return getJson<VinosmithSupplierOrdersResponse>(VINOSMITH_DISTRIBUTOR_ENDPOINTS.supplierOrders, {
        delivery_start_date: params.deliveryStartDate,
        delivery_end_date: params.deliveryEndDate,
        account_id: params.accountId
      });
    },
    getWines() {
      return getJson<VinosmithWinesResponse>(VINOSMITH_DISTRIBUTOR_ENDPOINTS.wines);
    },
    getPrices() {
      return getJson<VinosmithPricesResponse>(VINOSMITH_DISTRIBUTOR_ENDPOINTS.prices);
    },
    getInventory() {
      return getJson<VinosmithInventoryResponse>(VINOSMITH_DISTRIBUTOR_ENDPOINTS.inventory);
    }
  };
}

export type VinosmithDistributorClient = ReturnType<typeof createVinosmithDistributorClient>;

export function filterSupplierOrdersByRequestedDeliveryWindow(
  supplierOrders: VinosmithSupplierOrder[],
  params: VinosmithSupplierOrdersParams
) {
  assertSupplierOrderWindow(params.deliveryStartDate, params.deliveryEndDate);
  return supplierOrders.filter((supplierOrder) => {
    const deliveryDate = toIsoDate(supplierOrder.supplier_order.delivery_at);
    return Boolean(deliveryDate && deliveryDate >= params.deliveryStartDate && deliveryDate <= params.deliveryEndDate);
  });
}

export function filterSupplierOrdersByDeliveryStatus(
  supplierOrders: VinosmithSupplierOrder[],
  statuses: readonly string[] = DEFAULT_VINOSMITH_DELIVERY_STATUSES
) {
  const allowed = new Set(statuses);
  return supplierOrders.filter((supplierOrder) => allowed.has(String(supplierOrder.supplier_order.delivery_status || "")));
}

export function supplierOrderLineBottleQuantity(lineItem: VinosmithSupplierOrderLineItem) {
  const cases = Number(lineItem.quantity || 0);
  const unitSet = Number(lineItem.wine.unit_set || 1);
  if (!Number.isFinite(cases) || !Number.isFinite(unitSet)) {
    return 0;
  }
  return cases * unitSet;
}

export function assertSupplierOrderWindow(deliveryStartDate: string, deliveryEndDate: string) {
  const start = parseIsoDateOnly(deliveryStartDate, "deliveryStartDate");
  const end = parseIsoDateOnly(deliveryEndDate, "deliveryEndDate");
  if (end.getTime() < start.getTime()) {
    throw new Error("Vinosmith supplier_orders deliveryEndDate must be on or after deliveryStartDate.");
  }
  const elapsedDays = Math.round((end.getTime() - start.getTime()) / 86_400_000);
  if (elapsedDays > VINOSMITH_SUPPLIER_ORDER_MAX_WINDOW_DAYS) {
    throw new Error(
      `Vinosmith supplier_orders windows may not exceed ${VINOSMITH_SUPPLIER_ORDER_MAX_WINDOW_DAYS} days.`
    );
  }
}

function normalizeBaseUrl(value: string) {
  return value.replace(/\/+$/, "");
}

function buildUrl(baseUrl: string, path: string, query?: Record<string, QueryValue>) {
  const url = new URL(`${baseUrl}${path}`);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== null && value !== undefined && value !== "") {
      url.searchParams.set(key, String(value));
    }
  }
  return url;
}

function toIsoDate(value: string | null | undefined) {
  if (!value) return null;
  return value.slice(0, 10);
}

function parseIsoDateOnly(value: string, label: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error(`${label} must use YYYY-MM-DD format.`);
  }
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${label} must be a valid calendar date.`);
  }
  return parsed;
}
