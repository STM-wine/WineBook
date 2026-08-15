import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";
import { fetchAllRecommendationsForRun } from "@/lib/supabase/recommendations";

const ITEM_FIELDS = [
  "quantity_on_hand",
  "quantity_on_order",
  "quantity_on_sales_order",
  "average_cost",
  "purchase_cost",
  "sales_price"
] as const;

const ITEM_TYPES = [
  "Inventory",
  "NonInventory",
  "Service",
  "OtherCharge",
  "InventoryAssembly",
  "Group",
  "SalesTax",
  "FixedAsset"
] as const;

type QuickBooksSummaryClient = SupabaseClient<any, "public", any>;

type QuickBooksItemShadowRow = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  quantity_on_hand: number | string | null;
  quantity_on_order: number | string | null;
  quantity_on_sales_order: number | string | null;
  average_cost: number | string | null;
  purchase_cost: number | string | null;
  sales_price: number | string | null;
  custom_fields: Record<string, unknown> | null;
};

type ShadowIssue = {
  productCode: string | null;
  productName: string | null;
  supplierName: string | null;
  issue: string;
  currentValue: string | number | null;
  quickbooksValue: string | number | null;
};

export async function GET() {
  const authSupabase = await createClient();
  const {
    data: { user }
  } = await authSupabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const { data: profile, error: profileError } = await authSupabase
    .from("app_profiles")
    .select("id,role")
    .eq("id", user.id)
    .maybeSingle<{ id: string; role: string }>();

  if (profileError) {
    return NextResponse.json({ error: profileError.message }, { status: 500 });
  }
  if (!profile) {
    return NextResponse.json({ error: "Account is not enabled." }, { status: 403 });
  }

  const { data: permissionRows, error: permissionError } = await authSupabase
    .from("app_profile_permissions")
    .select("permission")
    .eq("profile_id", user.id)
    .returns<Array<{ permission: string }>>();

  if (permissionError) {
    return NextResponse.json({ error: permissionError.message }, { status: 500 });
  }
  if (!canViewSettings(profile.role, permissionRows || [])) {
    return NextResponse.json({ error: "Settings access required." }, { status: 403 });
  }

  let supabase: ReturnType<typeof createServiceRoleClient>;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "QuickBooks item master summary is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  try {
    const [statusCounts, fieldCoverage, itemTypes, inventorySnapshots, itemCheckpoint, salesCoverage, orderingShadow] = await Promise.all([
      itemStatusCounts(supabase),
      itemFieldCoverage(supabase),
      itemTypeCounts(supabase),
      countRows(supabase, "quickbooks_inventory_snapshots"),
      latestItemCheckpoint(supabase),
      quickBooksSalesCoverage(supabase),
      orderingShadowComparison(supabase)
    ]);

    return NextResponse.json({
      statusCounts,
      fieldCoverage,
      itemTypes,
      inventorySnapshots,
      itemCheckpoint,
      salesCoverage,
      orderingShadow
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load QuickBooks item master summary.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function itemStatusCounts(supabase: QuickBooksSummaryClient) {
  const [total, active, inactive, unknown] = await Promise.all([
    countRows(supabase, "quickbooks_items"),
    countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", true)),
    countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", false)),
    countRows(supabase, "quickbooks_items", (query) => query.is("is_active", null))
  ]);

  return { total, active, inactive, unknown };
}

async function itemFieldCoverage(supabase: QuickBooksSummaryClient) {
  const rows = await Promise.all(
    ITEM_FIELDS.map(async (field) => {
      const [present, activePresent] = await Promise.all([
        countRows(supabase, "quickbooks_items", (query) => query.not(field, "is", null)),
        countRows(supabase, "quickbooks_items", (query) => query.eq("is_active", true).not(field, "is", null))
      ]);

      return {
        field,
        present,
        activePresent
      };
    })
  );

  return rows;
}

async function itemTypeCounts(supabase: QuickBooksSummaryClient) {
  const rows = await Promise.all(
    ITEM_TYPES.map(async (itemType) => ({
      itemType,
      count: await countRows(supabase, "quickbooks_items", (query) => query.eq("item_type", itemType))
    }))
  );

  return rows;
}

async function latestItemCheckpoint(supabase: QuickBooksSummaryClient) {
  const { data, error } = await supabase
    .from("source_sync_checkpoints")
    .select("checkpoint_key,status,cursor_data,diagnostics,last_synced_at,updated_at")
    .eq("source_system", "quickbooks_desktop")
    .eq("resource_name", "quickbooks_items")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(error.message);

  return data || null;
}

async function orderingShadowComparison(supabase: QuickBooksSummaryClient) {
  const { data: latestRun, error: runError } = await supabase
    .from("report_runs")
    .select("id,report_date,completed_at")
    .eq("status", "completed")
    .order("completed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (runError) throw new Error(runError.message);
  if (!latestRun?.id) {
    return {
      latestReport: null,
      recommendationRows: 0,
      productCodeRows: 0,
      missingProductCodeRows: 0,
      exactMatchRows: 0,
      noMatchRows: 0,
      activeMatchRows: 0,
      inactiveOnlyRows: 0,
      duplicateActiveRows: 0,
      duplicateInactiveRows: 0,
      costMismatchRows: 0,
      quantityMismatchRows: 0,
      onOrderMismatchRows: 0,
      examples: []
    };
  }

  const [recommendations, quickbooksItems] = await Promise.all([
    fetchAllRecommendationsForRun(supabase, latestRun.id),
    fetchAllQuickBooksItemsForShadow(supabase)
  ]);
  const itemLookup = buildQuickBooksLookup(quickbooksItems);
  const examples: ShadowIssue[] = [];
  const stats = {
    recommendationRows: recommendations.length,
    productCodeRows: 0,
    missingProductCodeRows: 0,
    exactMatchRows: 0,
    noMatchRows: 0,
    activeMatchRows: 0,
    inactiveOnlyRows: 0,
    duplicateActiveRows: 0,
    duplicateInactiveRows: 0,
    costMismatchRows: 0,
    quantityMismatchRows: 0,
    onOrderMismatchRows: 0
  };

  recommendations.forEach((row) => {
    const productCode = normalizeKey(row.product_code);
    if (!productCode) {
      stats.missingProductCodeRows += 1;
      pushExample(examples, row, "Missing current product code", null, null);
      return;
    }

    stats.productCodeRows += 1;
    const candidates = itemLookup.get(productCode) || [];
    if (candidates.length === 0) {
      stats.noMatchRows += 1;
      pushExample(examples, row, "No exact QuickBooks match", productCode, null);
      return;
    }

    stats.exactMatchRows += 1;
    const activeCandidates = candidates.filter((item) => item.is_active !== false);
    const inactiveCandidates = candidates.filter((item) => item.is_active === false);

    if (activeCandidates.length > 0) stats.activeMatchRows += 1;
    if (activeCandidates.length === 0 && inactiveCandidates.length > 0) {
      stats.inactiveOnlyRows += 1;
      pushExample(examples, row, "Only inactive QuickBooks matches", productCode, inactiveCandidates[0]?.full_name || inactiveCandidates[0]?.name || null);
    }
    if (activeCandidates.length > 1) {
      stats.duplicateActiveRows += 1;
      pushExample(examples, row, "Duplicate active QuickBooks matches", productCode, activeCandidates.length);
    }
    if (inactiveCandidates.length > 1) {
      stats.duplicateInactiveRows += 1;
      pushExample(examples, row, "Duplicate inactive QuickBooks matches", productCode, inactiveCandidates.length);
    }

    const bestCandidate = activeCandidates[0] || inactiveCandidates[0];
    if (!bestCandidate) return;

    const currentCost = numberOrNull(row.fob);
    const quickbooksCost = numberOrNull(bestCandidate.purchase_cost) ?? numberOrNull(bestCandidate.average_cost);
    if (currentCost !== null && quickbooksCost !== null && Math.abs(currentCost - quickbooksCost) > 0.01) {
      stats.costMismatchRows += 1;
      pushExample(examples, row, "Cost mismatch", currentCost, quickbooksCost);
    }

    const currentOnHand = numberOrNull(row.true_available);
    const quickbooksOnHand = numberOrNull(bestCandidate.quantity_on_hand);
    if (currentOnHand !== null && quickbooksOnHand !== null && Math.abs(currentOnHand - quickbooksOnHand) > 0.01) {
      stats.quantityMismatchRows += 1;
      pushExample(examples, row, "On-hand quantity mismatch", currentOnHand, quickbooksOnHand);
    }

    const currentOnOrder = numberOrNull(row.on_order);
    const quickbooksOnOrder = numberOrNull(bestCandidate.quantity_on_order);
    if (currentOnOrder !== null && quickbooksOnOrder !== null && Math.abs(currentOnOrder - quickbooksOnOrder) > 0.01) {
      stats.onOrderMismatchRows += 1;
      pushExample(examples, row, "On-order quantity mismatch", currentOnOrder, quickbooksOnOrder);
    }
  });

  return {
    latestReport: latestRun,
    ...stats,
    examples
  };
}

async function quickBooksSalesCoverage(supabase: QuickBooksSummaryClient) {
  const currentYear = new Date().getUTCFullYear();
  const today = new Date().toISOString().slice(0, 10);
  const currentYearRange = {
    label: `${currentYear} YTD`,
    from: `${currentYear}-01-01`,
    to: today
  };
  const priorYearRange = {
    label: "2025 full year",
    from: "2025-01-01",
    to: "2025-12-31"
  };

  const [currentYearCoverage, priorYearCoverage, checkpointCoverage] = await Promise.all([
    salesTransactionCoverageForRange(supabase, currentYearRange),
    salesTransactionCoverageForRange(supabase, priorYearRange),
    salesCheckpointCoverageForRange(supabase, priorYearRange)
  ]);

  return {
    currentYear: currentYearCoverage,
    priorYear: priorYearCoverage,
    checkpointCoverage
  };
}

async function salesTransactionCoverageForRange(
  supabase: QuickBooksSummaryClient,
  range: { label: string; from: string; to: string }
) {
  const [invoiceCoverage, creditMemoCoverage] = await Promise.all([
    tableDateCoverage(supabase, "quickbooks_invoices", range.from, range.to),
    tableDateCoverage(supabase, "quickbooks_credit_memos", range.from, range.to)
  ]);

  return {
    ...range,
    invoices: invoiceCoverage,
    creditMemos: creditMemoCoverage
  };
}

async function tableDateCoverage(supabase: QuickBooksSummaryClient, table: string, from: string, to: string) {
  const [count, earliest, latest] = await Promise.all([
    countRows(supabase, table, (query) => query.gte("txn_date", from).lte("txn_date", to)),
    firstDateForTable(supabase, table, from, to, true),
    firstDateForTable(supabase, table, from, to, false)
  ]);

  return { count, earliestTxnDate: earliest, latestTxnDate: latest };
}

async function firstDateForTable(supabase: QuickBooksSummaryClient, table: string, from: string, to: string, ascending: boolean) {
  const { data, error } = await supabase
    .from(table)
    .select("txn_date")
    .gte("txn_date", from)
    .lte("txn_date", to)
    .order("txn_date", { ascending, nullsFirst: false })
    .limit(1)
    .maybeSingle<{ txn_date: string | null }>();

  if (error) throw new Error(error.message);
  return data?.txn_date || null;
}

async function salesCheckpointCoverageForRange(
  supabase: QuickBooksSummaryClient,
  range: { from: string; to: string }
) {
  const resources = ["quickbooks_invoices", "quickbooks_credit_memos"] as const;
  const statuses = ["pending", "running", "completed", "failed", "needs_repair"] as const;
  const rows = await Promise.all(
    resources.flatMap((resourceName) =>
      statuses.map(async (status) => ({
        resourceName,
        status,
        count: await countRows(supabase, "source_sync_checkpoints", (query) =>
          query
            .eq("source_system", "quickbooks_desktop")
            .eq("resource_name", resourceName)
            .eq("status", status)
            .gte("requested_start_date", range.from)
            .lte("requested_start_date", range.to)
        )
      }))
    )
  );

  return rows;
}

async function fetchAllQuickBooksItemsForShadow(supabase: QuickBooksSummaryClient) {
  const rows: QuickBooksItemShadowRow[] = [];
  const pageSize = 1000;
  let from = 0;

  while (true) {
    const { data, error } = await supabase
      .from("quickbooks_items")
      .select(`
        list_id,
        name,
        full_name,
        is_active,
        quantity_on_hand,
        quantity_on_order,
        quantity_on_sales_order,
        average_cost,
        purchase_cost,
        sales_price,
        custom_fields
      `)
      .order("list_id", { ascending: true })
      .range(from, from + pageSize - 1)
      .returns<QuickBooksItemShadowRow[]>();

    if (error) throw new Error(error.message);

    const page = data || [];
    rows.push(...page);
    if (page.length < pageSize) break;
    from += pageSize;
  }

  return rows;
}

function buildQuickBooksLookup(items: QuickBooksItemShadowRow[]) {
  const lookup = new Map<string, QuickBooksItemShadowRow[]>();

  items.forEach((item) => {
    [
      item.name,
      item.full_name,
      textFromCustomFields(item.custom_fields, [
        "item_number",
        "itemNumber",
        "ItemNumber",
        "sku",
        "SKU",
        "product_code",
        "productCode",
        "ProductCode"
      ])
    ].forEach((value) => {
      const key = normalizeKey(value);
      if (!key) return;
      const existing = lookup.get(key) || [];
      if (!existing.some((entry) => entry.list_id === item.list_id)) {
        existing.push(item);
      }
      lookup.set(key, existing);
    });
  });

  return lookup;
}

function pushExample(
  examples: ShadowIssue[],
  row: { product_code: string | null; product_name: string | null; supplier_name: string | null },
  issue: string,
  currentValue: string | number | null,
  quickbooksValue: string | number | null
) {
  if (examples.length >= 25) return;
  examples.push({
    productCode: row.product_code,
    productName: row.product_name,
    supplierName: row.supplier_name,
    issue,
    currentValue,
    quickbooksValue
  });
}

async function countRows(
  supabase: QuickBooksSummaryClient,
  table: string,
  applyFilter?: (query: any) => any
) {
  const baseQuery = supabase.from(table).select("*", { count: "exact", head: true });
  const query = applyFilter ? applyFilter(baseQuery) : baseQuery;
  const { count, error } = await query;

  if (error) throw new Error(error.message);
  return count || 0;
}

function canViewSettings(role: string, permissionRows: Array<{ permission: string }>) {
  if (role === "admin" || role === "buyer") return true;
  return permissionRows.some((row) => row.permission === "view_settings");
}

function normalizeKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
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
