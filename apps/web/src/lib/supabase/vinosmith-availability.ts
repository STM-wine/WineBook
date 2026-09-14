import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

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

  const byProductCode = new Map<string, number>();
  for (const row of rows) {
    const productCode = row.wine_code?.trim().toUpperCase();
    if (!productCode) continue;
    const available = Number(row.available);
    byProductCode.set(
      productCode,
      (byProductCode.get(productCode) || 0) + (Number.isFinite(available) ? Math.max(0, available) : 0)
    );
  }

  return { snapshotAt, byProductCode };
}
