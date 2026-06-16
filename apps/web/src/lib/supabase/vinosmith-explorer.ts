import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  VinosmithExplorerAccount,
  VinosmithExplorerCheckpoint,
  VinosmithExplorerContact,
  VinosmithExplorerData,
  VinosmithExplorerInventory,
  VinosmithExplorerOrder,
  VinosmithExplorerPriceSummary,
  VinosmithExplorerSalesRep,
  VinosmithExplorerSyncRun,
  VinosmithExplorerWine
} from "@/lib/types";

const PAGE_SIZE = 1000;
const RECENT_ORDER_LIMIT = 300;

type CountResult = {
  count: number | null;
  error: { message: string } | null;
};

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
        "wine_id,code,name,vintage,importer_name,producer_name,product_family,unit_set,bottle_size,bottle_size_label,fob_price,category,country,region,appellation,active,orderable,core,inventory_item,last_seen_at",
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
      syncRuns: syncRunsResult.data || [],
      checkpoints: checkpointsResult.data || []
    };
  } catch (error) {
    return emptyExplorerData(error instanceof Error ? error.message : "Could not load Vinosmith rescue data.");
  }
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
    checkpoints: []
  };
}

export function unavailableVinosmithExplorerData(error: string): VinosmithExplorerData {
  return emptyExplorerData(error);
}
