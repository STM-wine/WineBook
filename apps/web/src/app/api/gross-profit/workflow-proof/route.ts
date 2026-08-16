import { NextRequest, NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

type ProofClient = SupabaseClient<any, "public", any>;

type QuickBooksInvoiceRow = {
  txn_id: string;
  ref_number: string | null;
  txn_date: string | null;
  ship_date: string | null;
  customer_full_name: string | null;
};

type QuickBooksInvoiceLineRow = {
  txn_id: string;
  txn_line_id: string | null;
  item_full_name: string | null;
  description: string | null;
  quantity: number | string | null;
  rate: number | string | null;
  amount: number | string | null;
};

type VinosmithOrderHeaderRow = {
  supplier_order_id: string;
  invoice_number: string | null;
  account_name: string | null;
  delivery_at: string | null;
};

type VinosmithOrderLineRow = {
  line_item_id: string;
  supplier_order_id: string;
  wine_code: string | null;
  wine_name: string | null;
  quantity_bottles: number | string | null;
  price_cents: number | string | null;
  price_id: string | null;
  price_label: string | null;
  total_cents: number | string | null;
  discount: number | string | null;
  manual_price: boolean | null;
};

type VinosmithPriceRow = {
  price_id: string;
  price_cents: number | string | null;
  bill_back_price_cents: number | string | null;
  label: string | null;
  wine_id: string | null;
};

type MatchExample = {
  invoiceNumber: string | null;
  item: string | null;
  quantity: number | null;
  amountCents: number | null;
  reason: string;
};

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 400;

export async function GET(request: NextRequest) {
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

  let supabase: ProofClient;
  try {
    supabase = createServiceRoleClient();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Gross profit workflow proof is not configured.";
    return NextResponse.json({ error: message }, { status: 500 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const dateFrom = validDate(request.nextUrl.searchParams.get("from")) || "2025-01-01";
  const dateTo = validDate(request.nextUrl.searchParams.get("to")) || today;

  try {
    return NextResponse.json(await buildWorkflowProof(supabase, dateFrom, dateTo));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not build gross profit workflow proof.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

async function buildWorkflowProof(supabase: ProofClient, dateFrom: string, dateTo: string) {
  const [quickBooksInvoices, vinosmithHeaders] = await Promise.all([
    fetchQuickBooksInvoices(supabase, dateFrom, dateTo),
    fetchVinosmithOrderHeaders(supabase, dateFrom, dateTo)
  ]);
  const [quickBooksLines, vinosmithLines] = await Promise.all([
    fetchQuickBooksLines(supabase, quickBooksInvoices.map((row) => row.txn_id)),
    fetchVinosmithLines(supabase, vinosmithHeaders.map((row) => row.supplier_order_id))
  ]);
  const prices = await fetchVinosmithPrices(
    supabase,
    vinosmithLines.map((row) => row.price_id || "").filter(Boolean)
  );

  const invoicesByTxnId = new Map(quickBooksInvoices.map((row) => [row.txn_id, row]));
  const headersById = new Map(vinosmithHeaders.map((row) => [row.supplier_order_id, row]));
  const priceById = new Map(prices.map((row) => [row.price_id, row]));
  const vinoInvoiceNumbers = new Set(vinosmithHeaders.map((row) => normalizeKey(row.invoice_number)).filter(Boolean));
  const invoiceLineLookup = buildVinosmithLineLookup(vinosmithLines, headersById);
  const examples: MatchExample[] = [];

  let invoiceNumberMatches = 0;
  quickBooksInvoices.forEach((invoice) => {
    if (vinoInvoiceNumbers.has(normalizeKey(invoice.ref_number))) invoiceNumberMatches += 1;
  });

  const stats = {
    quickBooksInvoices: quickBooksInvoices.length,
    quickBooksInvoiceLines: quickBooksLines.length,
    vinosmithOrders: vinosmithHeaders.length,
    vinosmithOrderLines: vinosmithLines.length,
    invoiceNumberMatches,
    exactLineMatches: 0,
    partialLineMatches: 0,
    unmatchedQuickBooksLines: 0,
    matchedWithVinosmithPriceId: 0,
    matchedPriceRows: 0,
    matchedBillbackRows: 0,
    manualNoBillbackRows: 0,
    sampleRows: 0
  };

  quickBooksLines.forEach((line) => {
    const invoice = invoicesByTxnId.get(line.txn_id) || null;
    const lineMatch = findVinosmithMatch(line, invoice, invoiceLineLookup);

    if (!lineMatch) {
      stats.unmatchedQuickBooksLines += 1;
      pushExample(examples, line, invoice, "No Vinosmith line match");
      return;
    }

    if (lineMatch.matchType === "exact") stats.exactLineMatches += 1;
    else stats.partialLineMatches += 1;

    const vinoLine = lineMatch.line;
    if (vinoLine.manual_price) {
      stats.manualNoBillbackRows += 1;
      return;
    }
    if (isSampleLine(vinoLine)) {
      stats.sampleRows += 1;
      return;
    }
    if (vinoLine.price_id) stats.matchedWithVinosmithPriceId += 1;

    const price = vinoLine.price_id ? priceById.get(vinoLine.price_id) : null;
    if (price) {
      stats.matchedPriceRows += 1;
      if (numberOrNull(price.bill_back_price_cents) !== null) stats.matchedBillbackRows += 1;
    } else if (vinoLine.price_id) {
      pushExample(examples, line, invoice, "Vinosmith line has price_id but no price row");
    }
  });

  return {
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    ...stats,
    examples
  };
}

function buildVinosmithLineLookup(lines: VinosmithOrderLineRow[], headersById: Map<string, VinosmithOrderHeaderRow>) {
  const lookup = new Map<string, VinosmithOrderLineRow[]>();

  lines.forEach((line) => {
    const header = headersById.get(line.supplier_order_id) || null;
    const invoiceNumber = normalizeKey(header?.invoice_number);
    const wineCode = normalizeKey(line.wine_code);
    if (!invoiceNumber || !wineCode) return;

    const quantity = numberOrNull(line.quantity_bottles);
    const totalCents = integerOrNull(line.total_cents);
    const priceCents = integerOrNull(line.price_cents);
    const keys = [
      keyFor(invoiceNumber, wineCode, quantity, totalCents, "total"),
      keyFor(invoiceNumber, wineCode, quantity, priceCents, "unit"),
      keyFor(invoiceNumber, wineCode, quantity, null, "quantity")
    ].filter(Boolean);

    keys.forEach((key) => {
      const existing = lookup.get(key) || [];
      existing.push(line);
      lookup.set(key, existing);
    });
  });

  return lookup;
}

function findVinosmithMatch(
  line: QuickBooksInvoiceLineRow,
  invoice: QuickBooksInvoiceRow | null,
  lookup: Map<string, VinosmithOrderLineRow[]>
) {
  const invoiceNumber = normalizeKey(invoice?.ref_number);
  if (!invoiceNumber) return null;

  const quantity = numberOrNull(line.quantity);
  const amountCents = centsOrNull(line.amount);
  const rateCents = centsOrNull(line.rate);

  for (const itemKey of itemKeys(line.item_full_name || line.description)) {
    const exactKeys = [
      keyFor(invoiceNumber, itemKey, quantity, amountCents, "total"),
      keyFor(invoiceNumber, itemKey, quantity, rateCents, "unit")
    ].filter(Boolean);
    for (const key of exactKeys) {
      const match = lookup.get(key)?.[0];
      if (match) return { line: match, matchType: "exact" as const };
    }

    const partial = lookup.get(keyFor(invoiceNumber, itemKey, quantity, null, "quantity"))?.[0];
    if (partial) return { line: partial, matchType: "partial" as const };
  }

  return null;
}

async function fetchQuickBooksInvoices(supabase: ProofClient, dateFrom: string, dateTo: string) {
  return fetchAll<QuickBooksInvoiceRow>((from, to) =>
    supabase
      .from("quickbooks_invoices")
      .select("txn_id,ref_number,txn_date,ship_date,customer_full_name")
      .gte("txn_date", dateFrom)
      .lte("txn_date", dateTo)
      .order("txn_date", { ascending: true })
      .range(from, to)
      .returns<QuickBooksInvoiceRow[]>()
  );
}

async function fetchQuickBooksLines(supabase: ProofClient, txnIds: string[]) {
  const rows: QuickBooksInvoiceLineRow[] = [];
  for (const chunk of chunks(unique(txnIds), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<QuickBooksInvoiceLineRow>((from, to) =>
        supabase
          .from("quickbooks_invoice_lines")
          .select("txn_id,txn_line_id,item_full_name,description,quantity,rate,amount")
          .in("txn_id", chunk)
          .order("txn_id", { ascending: true })
          .order("line_sequence", { ascending: true })
          .range(from, to)
          .returns<QuickBooksInvoiceLineRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchVinosmithOrderHeaders(supabase: ProofClient, dateFrom: string, dateTo: string) {
  return fetchAll<VinosmithOrderHeaderRow>((from, to) =>
    supabase
      .from("vinosmith_order_headers")
      .select("supplier_order_id,invoice_number,account_name,delivery_at")
      .gte("delivery_at", `${dateFrom}T00:00:00`)
      .lte("delivery_at", `${dateTo}T23:59:59`)
      .order("delivery_at", { ascending: true })
      .range(from, to)
      .returns<VinosmithOrderHeaderRow[]>()
  );
}

async function fetchVinosmithLines(supabase: ProofClient, supplierOrderIds: string[]) {
  const rows: VinosmithOrderLineRow[] = [];
  for (const chunk of chunks(unique(supplierOrderIds), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<VinosmithOrderLineRow>((from, to) =>
        supabase
          .from("vinosmith_order_lines")
          .select("line_item_id,supplier_order_id,wine_code,wine_name,quantity_bottles,price_cents,price_id,price_label,total_cents,discount,manual_price")
          .in("supplier_order_id", chunk)
          .order("supplier_order_id", { ascending: true })
          .range(from, to)
          .returns<VinosmithOrderLineRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchVinosmithPrices(supabase: ProofClient, priceIds: string[]) {
  const rows: VinosmithPriceRow[] = [];
  for (const chunk of chunks(unique(priceIds), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<VinosmithPriceRow>((from, to) =>
        supabase
          .from("vinosmith_prices")
          .select("price_id,price_cents,bill_back_price_cents,label,wine_id")
          .in("price_id", chunk)
          .order("price_id", { ascending: true })
          .range(from, to)
          .returns<VinosmithPriceRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchAll<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function keyFor(invoiceNumber: string, itemKey: string, quantity: number | null, cents: number | null, mode: string) {
  if (!invoiceNumber || !itemKey || quantity === null) return "";
  return [invoiceNumber, itemKey, quantity.toFixed(4), mode, cents === null ? "" : String(cents)].join("|");
}

function itemKeys(value: string | null | undefined) {
  const full = normalizeKey(value);
  if (!full) return [];
  const terminal = normalizeKey(full.split(":").at(-1));
  return unique([full, terminal]);
}

function isSampleLine(line: VinosmithOrderLineRow) {
  const totalCents = integerOrNull(line.total_cents);
  const discount = numberOrNull(line.discount);
  return totalCents === 0 || (discount !== null && discount >= 100);
}

function pushExample(
  examples: MatchExample[],
  line: QuickBooksInvoiceLineRow,
  invoice: QuickBooksInvoiceRow | null,
  reason: string
) {
  if (examples.length >= 25) return;
  examples.push({
    invoiceNumber: invoice?.ref_number || null,
    item: line.item_full_name || line.description,
    quantity: numberOrNull(line.quantity),
    amountCents: centsOrNull(line.amount),
    reason
  });
}

function canViewSettings(role: string, permissionRows: Array<{ permission: string }>) {
  if (role === "admin" || role === "buyer") return true;
  return permissionRows.some((row) => row.permission === "view_settings");
}

function validDate(value: string | null) {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function normalizeKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function integerOrNull(value: unknown) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

function centsOrNull(value: unknown) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number * 100);
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
