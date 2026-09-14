import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createVinosmithDistributorClient } from "@/lib/integrations/vinosmith";
import { aggregateVinosmithAvailable } from "@/lib/vinosmith-availability-data";

type InventoryRow = {
  wine_id: string;
  snapshot_at: string;
  available: number | string | null;
  wine_code: string | null;
};

export type LatestVinosmithAvailability = {
  snapshotAt: string;
  byProductCode: Map<string, number>;
};

const PAGE_SIZE = 1000;

export async function fetchLiveVinosmithAvailability(options: {
  token?: string;
  fetchImpl?: typeof fetch;
  now?: () => Date;
} = {}): Promise<LatestVinosmithAvailability> {
  const fetchImpl = options.fetchImpl || ((input, init = {}) =>
    fetch(input, {
      ...init,
      signal: init.signal || AbortSignal.timeout(20_000)
    }));
  const client = createVinosmithDistributorClient({
    token: options.token,
    fetchImpl,
    userAgent: "Stem-WineBook-Order-Summary-Available/1.0"
  });
  const response = await client.getInventory();
  const records = response.data?.inventory;
  if (!Array.isArray(records)) {
    throw new Error("Vinosmith Get Available returned no inventory rows.");
  }

  return {
    snapshotAt: (options.now || (() => new Date()))().toISOString(),
    byProductCode: aggregateVinosmithAvailable(records.map((record) => ({
      wineCode: record.wine?.code,
      available: record.inventory?.available
    })))
  };
}

export async function fetchLatestVinosmithAvailability(
  supabase: SupabaseClient
): Promise<LatestVinosmithAvailability | null> {
  const { data: firstPage, error: firstPageError } = await supabase
    .from("vinosmith_inventory_snapshots")
    .select("wine_id,snapshot_at,available,wine_code:raw_data->wine->>code")
    .not("snapshot_at", "is", null)
    .order("snapshot_at", { ascending: false })
    .order("wine_id", { ascending: true })
    .range(0, PAGE_SIZE - 1)
    .returns<InventoryRow[]>();

  if (firstPageError) throw new Error(firstPageError.message);
  const snapshotAt = firstPage?.[0]?.snapshot_at;
  if (!snapshotAt) return null;

  const rows = (firstPage || []).filter((row) => row.snapshot_at === snapshotAt);
  for (let from = PAGE_SIZE; rows.length === from; from += PAGE_SIZE) {
    const { data, error } = await supabase
      .from("vinosmith_inventory_snapshots")
      .select("wine_id,snapshot_at,available,wine_code:raw_data->wine->>code")
      .eq("snapshot_at", snapshotAt)
      .order("wine_id", { ascending: true })
      .range(from, from + PAGE_SIZE - 1)
      .returns<InventoryRow[]>();
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  const byProductCode = aggregateVinosmithAvailable(rows.map((row) => ({
    wineCode: row.wine_code,
    available: row.available
  })));

  return { snapshotAt, byProductCode };
}
