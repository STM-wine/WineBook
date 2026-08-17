import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  VinosmithExplorerAccount,
  VinosmithExplorerCheckpoint,
  VinosmithExplorerContact,
  VinosmithExplorerData,
  VinosmithExplorerInventory,
  VinosmithExplorerOrder,
  VinosmithExplorerPriceSummary,
  VinosmithProductHealth,
  VinosmithProductHealthIssue,
  VinosmithExplorerSalesRep,
  VinosmithExplorerSyncRun,
  VinosmithExplorerWine
} from "@/lib/types";

const PAGE_SIZE = 1000;
const RECENT_ORDER_LIMIT = 300;
const PRODUCT_HEALTH_EXAMPLE_LIMIT = 80;

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

const VINOSMITH_WINE_HEALTH_COLUMNS = "wine_id,code,name,vintage,importer_name,producer_name,product_family,unit_set,bottle_size,bottle_size_label,fob_price,category,country,region,appellation,active,orderable,core,inventory_item,last_seen_at";

export async function fetchVinosmithProductHealthData(supabase: SupabaseClient): Promise<VinosmithProductHealth> {
  const [wines, syncRunsResult, checkpointsResult, quickBooksItems] = await Promise.all([
    fetchAll<VinosmithExplorerWine>(
      supabase,
      "vinosmith_wines",
      VINOSMITH_WINE_HEALTH_COLUMNS,
      "name"
    ),
    supabase
      .from("source_sync_runs")
      .select("id,sync_type,status,requested_start_date,requested_end_date,started_at,completed_at,error_message")
      .eq("source_system", "vinosmith")
      .order("started_at", { ascending: false })
      .limit(12)
      .returns<VinosmithExplorerSyncRun[]>(),
    supabase
      .from("source_sync_checkpoints")
      .select("resource_name,checkpoint_key,status,last_synced_at,requested_start_date,requested_end_date")
      .eq("source_system", "vinosmith")
      .order("resource_name", { ascending: true })
      .limit(100)
      .returns<VinosmithExplorerCheckpoint[]>(),
    fetchQuickBooksItems(supabase)
  ]);

  if (syncRunsResult.error) throw new Error(syncRunsResult.error.message);
  if (checkpointsResult.error) throw new Error(checkpointsResult.error.message);

  return buildProductHealth({
    wines,
    quickBooksItems,
    syncRuns: syncRunsResult.data || [],
    checkpoints: checkpointsResult.data || []
  });
}

export async function fetchVinosmithExplorerData(supabase: SupabaseClient): Promise<VinosmithExplorerData> {
  try {
    const [
      wines,
      accounts,
      contacts,
      salesReps,
      priceRows,
      latestInventory,
      recentOrdersResult,
      syncRunsResult,
      checkpointsResult,
      latestWinesResponse,
      pricesCount,
      ordersCount,
      orderLinesCount,
      prearrivalsCount
    ] = await Promise.all([
      fetchAll<VinosmithExplorerWine>(
        supabase,
        "vinosmith_wines",
        VINOSMITH_WINE_HEALTH_COLUMNS,
        "name"
      ),
      fetchAll<VinosmithExplorerAccount>(
        supabase,
        "vinosmith_accounts",
        "account_id,name,code,status,kind,shipping_city,shipping_state,phone_number,website_url,last_seen_at",
        "name"
      ),
      fetchAll<VinosmithExplorerContact>(
        supabase,
        "vinosmith_account_contacts",
        "contact_id,account_id,full_name,email,phone,buyer,primary_contact",
        "account_id"
      ),
      fetchAll<VinosmithExplorerSalesRep>(
        supabase,
        "vinosmith_account_sales_reps",
        "account_id,user_id,full_name,email",
        "account_id"
      ),
      fetchAll<{ wine_id: string | null; price_cents: number | null; bill_back_price_cents: number | null; active: boolean | null; disabled: boolean | null }>(
        supabase,
        "vinosmith_prices",
        "wine_id,price_cents,bill_back_price_cents,active,disabled",
        "wine_id"
      ),
      fetchLatestInventory(supabase),
      supabase
        .from("vinosmith_order_headers")
        .select("supplier_order_id,account_id,account_name,user_full_name,invoice_number,po_number,delivery_at,delivery_status,payment_status,total_cents")
        .order("delivery_at", { ascending: false })
        .limit(RECENT_ORDER_LIMIT)
        .returns<VinosmithExplorerOrder[]>(),
      supabase
        .from("source_sync_runs")
        .select("id,sync_type,status,requested_start_date,requested_end_date,started_at,completed_at,error_message")
        .eq("source_system", "vinosmith")
        .order("started_at", { ascending: false })
        .limit(12)
        .returns<VinosmithExplorerSyncRun[]>(),
      supabase
        .from("source_sync_checkpoints")
        .select("resource_name,checkpoint_key,status,last_synced_at,requested_start_date,requested_end_date")
        .eq("source_system", "vinosmith")
        .order("resource_name", { ascending: true })
        .limit(100)
        .returns<VinosmithExplorerCheckpoint[]>(),
      fetchLatestResponseCount(supabase, "wines"),
      countRows(supabase, "vinosmith_prices"),
      countRows(supabase, "vinosmith_order_headers"),
      countRows(supabase, "vinosmith_order_lines"),
      countRows(supabase, "vinosmith_prearrivals")
    ]);

    const inventoryWineIds = new Set(latestInventory.rows.map((row) => row.wine_id).filter(Boolean));
    const syncRuns = syncRunsResult.data || [];
    const checkpoints = checkpointsResult.data || [];

    return {
      error: null,
      counts: {
        wines: wines.length,
        latestWinesResponse,
        accounts: accounts.length,
        contacts: contacts.length,
        salesReps: salesReps.length,
        prices: pricesCount,
        latestInventoryRows: latestInventory.rows.length,
        latestInventoryWines: inventoryWineIds.size,
        orders: ordersCount,
        orderLines: orderLinesCount,
        prearrivals: prearrivalsCount
      },
      latestInventorySnapshotDate: latestInventory.snapshotDate,
      wines,
      inventory: latestInventory.rows,
      priceSummaries: summarizePrices(priceRows),
      accounts,
      contacts,
      salesReps,
      recentOrders: recentOrdersResult.data || [],
      syncRuns,
      checkpoints,
      productHealth: emptyProductHealth("Open Settings > Data Health for product health diagnostics.")
    };
  } catch (error) {
    return emptyExplorerData(error instanceof Error ? error.message : "Could not load Vinosmith rescue data.");
  }
}

type QuickBooksHealthItem = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  custom_fields: Record<string, unknown> | null;
  last_seen_at: string | null;
};

async function fetchQuickBooksItems(supabase: SupabaseClient) {
  return fetchAll<QuickBooksHealthItem>(
    supabase,
    "quickbooks_items",
    "list_id,name,full_name,is_active,custom_fields,last_seen_at",
    "full_name"
  );
}

async function fetchAll<T>(
  supabase: SupabaseClient,
  table: string,
  columns: string,
  orderBy?: string,
  filters: Array<{ column: string; value: string | number | boolean | null }> = []
) {
  const rows: T[] = [];
  let from = 0;

  while (true) {
    let query = supabase
      .from(table)
      .select(columns)
      .range(from, from + PAGE_SIZE - 1);
    for (const filter of filters) {
      query = query.eq(filter.column, filter.value);
    }
    if (orderBy) {
      query = query.order(orderBy, { ascending: true });
    }
    const { data, error } = await query.returns<T[]>();

    if (error) {
      throw new Error(error.message);
    }

    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return rows;
}

async function countRows(supabase: SupabaseClient, table: string) {
  const { count, error } = (await supabase
    .from(table)
    .select("*", { count: "exact", head: true })) as CountResult;
  if (error) {
    throw new Error(error.message);
  }
  return count || 0;
}

async function fetchLatestResponseCount(supabase: SupabaseClient, resource: string) {
  const { data, error } = await supabase
    .from("source_api_responses")
    .select("record_count")
    .eq("source_system", "vinosmith")
    .eq("request_identifier", resource)
    .order("fetched_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ record_count: number | null }>();

  if (error) {
    throw new Error(error.message);
  }

  return data?.record_count ?? null;
}

async function fetchLatestInventory(supabase: SupabaseClient) {
  const { data: latest, error } = await supabase
    .from("vinosmith_inventory_snapshots")
    .select("source_sync_run_id,snapshot_at,snapshot_date")
    .order("snapshot_at", { ascending: false })
    .limit(1)
    .maybeSingle<{ source_sync_run_id: string | null; snapshot_at: string | null; snapshot_date: string | null }>();

  if (error) {
    throw new Error(error.message);
  }
  if (!latest?.snapshot_date) {
    return { snapshotDate: null, rows: [] as VinosmithExplorerInventory[] };
  }

  if (!latest.source_sync_run_id && !latest.snapshot_at) {
    return { snapshotDate: latest.snapshot_date, rows: [] as VinosmithExplorerInventory[] };
  }

  const rows = await fetchAll<VinosmithExplorerInventory>(
    supabase,
    "vinosmith_inventory_snapshots",
    "wine_id,warehouse_name,available,on_hand,on_hold,on_order,on_future,on_pending_sync,end_of_stock,snapshot_date,snapshot_at",
    "wine_id",
    latest.source_sync_run_id
      ? [{ column: "source_sync_run_id", value: latest.source_sync_run_id }]
      : [{ column: "snapshot_at", value: latest.snapshot_at as string }]
  );

  return { snapshotDate: latest.snapshot_date, rows };
}

function summarizePrices(
  prices: Array<{
    wine_id: string | null;
    price_cents: number | null;
    bill_back_price_cents: number | null;
    active: boolean | null;
    disabled: boolean | null;
  }>
) {
  const summaries = new Map<string, VinosmithExplorerPriceSummary>();

  for (const price of prices) {
    if (!price.wine_id) continue;
    const summary =
      summaries.get(price.wine_id) ||
      ({
        wine_id: price.wine_id,
        prices: 0,
        activePrices: 0,
        minPriceCents: null,
        maxPriceCents: null,
        billBacks: 0
      } satisfies VinosmithExplorerPriceSummary);

    summary.prices += 1;
    if (price.active !== false && price.disabled !== true) {
      summary.activePrices += 1;
    }
    if (typeof price.price_cents === "number") {
      summary.minPriceCents = summary.minPriceCents === null ? price.price_cents : Math.min(summary.minPriceCents, price.price_cents);
      summary.maxPriceCents = summary.maxPriceCents === null ? price.price_cents : Math.max(summary.maxPriceCents, price.price_cents);
    }
    if (typeof price.bill_back_price_cents === "number" && price.bill_back_price_cents > 0) {
      summary.billBacks += 1;
    }
    summaries.set(price.wine_id, summary);
  }

  return Array.from(summaries.values());
}

function buildProductHealth({
  wines,
  quickBooksItems,
  syncRuns,
  checkpoints
}: {
  wines: VinosmithExplorerWine[];
  quickBooksItems: QuickBooksHealthItem[];
  syncRuns: VinosmithExplorerSyncRun[];
  checkpoints: VinosmithExplorerCheckpoint[];
}): VinosmithProductHealth {
  const latestCompletedRun = syncRuns.find((run) => run.status === "completed") || null;
  const latestSuccessfulPullAt =
    latestCompletedRun?.completed_at ||
    latestCompletedRun?.started_at ||
    latestCheckpointAt(checkpoints);
  const previousCompletedRun = syncRuns.filter((run) => run.status === "completed")[1] || null;
  const changedRecordsWindowStart = previousCompletedRun?.completed_at || previousCompletedRun?.started_at || null;
  const changedRecordsSinceLastSync = changedRecordsWindowStart
    ? wines.filter((wine) => isAtOrAfter(wine.last_seen_at, changedRecordsWindowStart)).length
    : null;

  const wineLookup = buildWineLookup(wines);
  const quickBooksLookup = buildQuickBooksLookup(quickBooksItems);
  const matchedWineIds = new Set<string>();
  const activeQbVsInactiveVs: VinosmithProductHealthIssue[] = [];
  const activeQbVsMissingVs: VinosmithProductHealthIssue[] = [];

  quickBooksItems.forEach((item) => {
    const itemCode = itemCodeFromQuickBooks(item);
    const wine = resolveVinosmithWine(item, itemCode, wineLookup);
    if (wine) matchedWineIds.add(wine.wine_id);
    if (item.is_active === false) return;

    if (!wine) {
      activeQbVsMissingVs.push(issueFromQuickBooksItem(item, itemCode, "QB active / no VS match", "Active", "Missing"));
    } else if (!isVinosmithActive(wine)) {
      activeQbVsInactiveVs.push(issueFromPair(item, itemCode, wine, "QB active / VS inactive"));
    }
  });

  const activeOrderableVsVsInactiveQb: VinosmithProductHealthIssue[] = [];
  const activeOrderableVsVsMissingQb: VinosmithProductHealthIssue[] = [];
  const metadataGaps: VinosmithProductHealthIssue[] = [];

  wines.forEach((wine) => {
    const matchedItem = resolveQuickBooksItem(wine, quickBooksLookup);
    const vsActive = isVinosmithActive(wine);
    if (matchedItem) matchedWineIds.add(wine.wine_id);

    if (vsActive && (!wine.importer_name || !wine.producer_name)) {
      metadataGaps.push(issueFromWine(wine, metadataGapLabel(wine), matchedItem?.is_active === false ? "Inactive" : matchedItem ? "Active" : "Missing"));
    }

    if (!vsActive) return;
    if (!matchedItem) {
      activeOrderableVsVsMissingQb.push(issueFromWine(wine, "VS active/orderable / no QB match", "Missing"));
    } else if (matchedItem.is_active === false) {
      activeOrderableVsVsInactiveQb.push(issueFromPair(matchedItem, itemCodeFromQuickBooks(matchedItem), wine, "VS active/orderable / QB inactive"));
    }
  });

  const qbActiveVsInactiveOrMissingVs = [...activeQbVsInactiveVs, ...activeQbVsMissingVs];
  const vsActiveOrderableVsInactiveOrMissingQb = [...activeOrderableVsVsInactiveQb, ...activeOrderableVsVsMissingQb];
  const unmatchedItemCodes = [...activeQbVsMissingVs, ...activeOrderableVsVsMissingQb];

  return {
    latestSuccessfulPullAt,
    latestCompletedRunId: latestCompletedRun?.id || null,
    failedRecentSyncs: syncRuns.filter((run) => run.status === "failed").length,
    activeQbVsInactiveOrMissingVs: qbActiveVsInactiveOrMissingVs.length,
    activeQbVsInactiveVs: activeQbVsInactiveVs.length,
    activeQbVsMissingVs: activeQbVsMissingVs.length,
    activeOrderableVsVsInactiveOrMissingQb: vsActiveOrderableVsInactiveOrMissingQb.length,
    activeOrderableVsVsInactiveQb: activeOrderableVsVsInactiveQb.length,
    activeOrderableVsVsMissingQb: activeOrderableVsVsMissingQb.length,
    missingSupplierImporterOrBrand: metadataGaps.length,
    unmatchedItemCodes: unmatchedItemCodes.length,
    changedRecordsSinceLastSync,
    changedRecordsWindowStart,
    changedRecordsNote: changedRecordsWindowStart
      ? "Estimated from Vinosmith last_seen_at against the previous completed sync run."
      : "Not available until at least two completed Vinosmith sync runs are recorded.",
    examples: {
      qbActiveVsInactiveOrMissingVs: qbActiveVsInactiveOrMissingVs.slice(0, PRODUCT_HEALTH_EXAMPLE_LIMIT),
      vsActiveOrderableVsInactiveOrMissingQb: vsActiveOrderableVsInactiveOrMissingQb.slice(0, PRODUCT_HEALTH_EXAMPLE_LIMIT),
      metadataGaps: metadataGaps.slice(0, PRODUCT_HEALTH_EXAMPLE_LIMIT),
      unmatchedItemCodes: unmatchedItemCodes.slice(0, PRODUCT_HEALTH_EXAMPLE_LIMIT)
    }
  };
}

function buildWineLookup(wines: VinosmithExplorerWine[]) {
  const byCode = new Map<string, VinosmithExplorerWine>();
  const byName = new Map<string, VinosmithExplorerWine>();
  wines.forEach((wine) => {
    if (wine.code) byCode.set(normalizeKey(wine.code), wine);
    if (wine.name) byName.set(normalizeKey(wine.name), wine);
  });
  return { byCode, byName };
}

function buildQuickBooksLookup(items: QuickBooksHealthItem[]) {
  const byCode = new Map<string, QuickBooksHealthItem[]>();
  const byName = new Map<string, QuickBooksHealthItem[]>();
  items.forEach((item) => {
    addQuickBooksLookupValue(byCode, itemCodeFromQuickBooks(item), item);
    addQuickBooksLookupValue(byName, item.full_name, item);
    addQuickBooksLookupValue(byName, item.name, item);
  });
  return { byCode, byName };
}

function addQuickBooksLookupValue(lookup: Map<string, QuickBooksHealthItem[]>, value: unknown, item: QuickBooksHealthItem) {
  const key = normalizeKey(value);
  if (!key) return;
  const existing = lookup.get(key) || [];
  existing.push(item);
  lookup.set(key, existing);
}

function resolveVinosmithWine(
  item: QuickBooksHealthItem,
  itemCode: string,
  lookup: ReturnType<typeof buildWineLookup>
) {
  return lookup.byCode.get(normalizeKey(itemCode)) ||
    lookup.byName.get(normalizeKey(item.full_name)) ||
    lookup.byName.get(normalizeKey(item.name)) ||
    null;
}

function resolveQuickBooksItem(wine: VinosmithExplorerWine, lookup: ReturnType<typeof buildQuickBooksLookup>) {
  const candidates = [
    ...(lookup.byCode.get(normalizeKey(wine.code)) || []),
    ...(lookup.byName.get(normalizeKey(wine.name)) || [])
  ];
  if (candidates.length === 0) return null;
  return candidates.find((item) => item.is_active !== false) || candidates[0] || null;
}

function issueFromQuickBooksItem(
  item: QuickBooksHealthItem,
  itemCode: string,
  issue: string,
  quickBooksStatus: string,
  vinosmithStatus: string
): VinosmithProductHealthIssue {
  return {
    id: item.list_id,
    itemCode,
    productName: item.full_name || item.name || "Unnamed QuickBooks item",
    supplierName: null,
    quickBooksStatus,
    vinosmithStatus,
    issue,
    lastSeenAt: item.last_seen_at
  };
}

function issueFromWine(wine: VinosmithExplorerWine, issue: string, quickBooksStatus: string): VinosmithProductHealthIssue {
  return {
    id: wine.wine_id,
    itemCode: wine.code,
    productName: wine.name || "Unnamed Vinosmith wine",
    supplierName: wine.importer_name,
    quickBooksStatus,
    vinosmithStatus: statusLabelForVinosmith(wine),
    issue,
    lastSeenAt: wine.last_seen_at
  };
}

function issueFromPair(
  item: QuickBooksHealthItem,
  itemCode: string,
  wine: VinosmithExplorerWine,
  issue: string
): VinosmithProductHealthIssue {
  return {
    id: `${item.list_id}:${wine.wine_id}`,
    itemCode: itemCode || wine.code,
    productName: wine.name || item.full_name || item.name || "Unnamed product",
    supplierName: wine.importer_name,
    quickBooksStatus: item.is_active === false ? "Inactive" : "Active",
    vinosmithStatus: statusLabelForVinosmith(wine),
    issue,
    lastSeenAt: wine.last_seen_at || item.last_seen_at
  };
}

function statusLabelForVinosmith(wine: VinosmithExplorerWine) {
  if (wine.active === true && wine.orderable === true) return "Active + orderable";
  if (wine.active === true) return "Active";
  if (wine.orderable === true) return "Orderable";
  if (wine.active === false || wine.orderable === false) return "Inactive";
  return "Unknown";
}

function metadataGapLabel(wine: VinosmithExplorerWine) {
  const gaps = [
    wine.importer_name ? null : "supplier/importer",
    wine.producer_name ? null : "brand/producer"
  ].filter(Boolean);
  return `Missing ${gaps.join(" + ")}`;
}

function latestCheckpointAt(checkpoints: VinosmithExplorerCheckpoint[]) {
  return checkpoints
    .map((checkpoint) => checkpoint.last_synced_at)
    .filter((value): value is string => Boolean(value))
    .sort((a, b) => new Date(b).getTime() - new Date(a).getTime())[0] || null;
}

function isAtOrAfter(value: string | null | undefined, start: string) {
  if (!value) return false;
  const valueTime = new Date(value).getTime();
  const startTime = new Date(start).getTime();
  return Number.isFinite(valueTime) && Number.isFinite(startTime) && valueTime >= startTime;
}

function isVinosmithActive(wine: VinosmithExplorerWine | null) {
  return wine?.active === true || wine?.orderable === true;
}

function itemCodeFromQuickBooks(item: QuickBooksHealthItem) {
  return textFromCustomFields(item.custom_fields, [
    "item_number",
    "itemNumber",
    "ItemNumber",
    "sku",
    "SKU",
    "product_code",
    "productCode",
    "ProductCode"
  ]) || item.name || item.full_name || item.list_id;
}

function normalizeKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function textFromCustomFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const fields = value as Record<string, unknown>;

  for (const key of keys) {
    const direct = fields[key];
    if (typeof direct === "string" && direct.trim()) return direct.trim();
    if (direct && typeof direct === "object" && !Array.isArray(direct)) {
      const nested = direct as Record<string, unknown>;
      const text = nested.value ?? nested.Value ?? nested.text ?? nested.Text;
      if (typeof text === "string" && text.trim()) return text.trim();
    }
  }

  return "";
}

function emptyExplorerData(error: string | null): VinosmithExplorerData {
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

function emptyProductHealth(changedRecordsNote: string): VinosmithProductHealth {
  return {
    latestSuccessfulPullAt: null,
    latestCompletedRunId: null,
    failedRecentSyncs: 0,
    activeQbVsInactiveOrMissingVs: 0,
    activeQbVsInactiveVs: 0,
    activeQbVsMissingVs: 0,
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
