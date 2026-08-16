import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

export type GrossProfitClient = SupabaseClient<any, "public", any>;

type QuickBooksInvoiceRow = {
  txn_id: string;
  ref_number: string | null;
  txn_date: string | null;
  ship_date: string | null;
  customer_list_id: string | null;
  customer_full_name: string | null;
  sales_rep_ref: Record<string, unknown> | null;
  subtotal: number | string | null;
  total_amount: number | string | null;
  linked_txns?: unknown;
};

type QuickBooksCreditMemoRow = {
  txn_id: string;
  ref_number: string | null;
  txn_date: string | null;
  customer_list_id: string | null;
  customer_full_name: string | null;
  subtotal: number | string | null;
  total_amount: number | string | null;
  linked_txns: unknown;
  raw_data: Record<string, unknown> | null;
};

type QuickBooksLineRow = {
  id: string;
  txn_id: string;
  txn_line_id: string | null;
  line_sequence: number | null;
  item_list_id: string | null;
  item_full_name: string | null;
  description: string | null;
  quantity: number | string | null;
  rate: number | string | null;
  amount: number | string | null;
};

type QuickBooksItemRow = {
  list_id: string;
  full_name: string | null;
  purchase_cost: number | string | null;
  average_cost: number | string | null;
  sales_price: number | string | null;
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
  wine_id: string | null;
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
  active: boolean | null;
  disabled: boolean | null;
};

type VinosmithWineCostRow = {
  wine_id: string;
  fob_price: number | string | null;
  stem_laid_in_per_bottle: number | string | null;
  stem_laid_in_source: string | null;
};

type GrossProfitCostSource =
  | "quickbooks_items.purchase_cost_current_plus_stem_laid_in"
  | "quickbooks_items.average_cost_current_plus_stem_laid_in"
  | "missing_current_item_cost";

export type GrossProfitConfidenceBucket =
  | "qb_price_qb_cost_vinosmith_price_id_billback"
  | "qb_price_qb_cost_vinosmith_exact_price_billback"
  | "qb_price_qb_cost_vinosmith_unique_label_current_price_billback"
  | "qb_price_qb_cost_vinosmith_price_no_billback"
  | "qb_price_qb_cost_manual_no_billback"
  | "sample_zero_dollar_or_100_discount"
  | "missing_vinosmith_line"
  | "credit_workflow_missing_vinosmith_line"
  | "ambiguous_vinosmith_line"
  | "ambiguous_vinosmith_price"
  | "missing_vinosmith_price";

export type GrossProfitCenterLine = {
  grossProfitCenterLineId: string;
  transactionType: "invoice" | "credit_memo";
  transactionId: string;
  transactionLineId: string | null;
  transactionLineSequence: number | null;
  transactionRefNumber: string | null;
  linkedInvoiceTxnId: string | null;
  linkedInvoiceRefNumber: string | null;
  salesDate: string | null;
  customerListId: string | null;
  customerFullName: string | null;
  salesRep: string | null;
  itemListId: string | null;
  itemFullName: string | null;
  description: string | null;
  quantity: number | null;
  qbUnitPrice: number | null;
  qbGrossSales: number | null;
  qbFobPerBottle: number | null;
  qbLaidInPerBottle: number | null;
  qbCostSource: GrossProfitCostSource;
  grossCostBeforeBillback: number | null;
  vinosmithSupplierOrderId: string | null;
  vinosmithLineItemId: string | null;
  vinosmithWineId: string | null;
  vinosmithWineCode: string | null;
  vinosmithWineName: string | null;
  vinosmithPriceId: string | null;
  vinosmithPriceLabel: string | null;
  vinosmithSoldPriceCents: number | null;
  vinosmithManualPrice: boolean;
  vinosmithLineMatchMethod: "exact" | "quantity" | "missing" | "ambiguous";
  vinosmithPriceMatchMethod: "price_id" | "wine_label_price" | "wine_label_current_price" | "manual_price" | "sample" | "missing" | "ambiguous" | "not_applicable";
  vinosmithBillbackPerBottle: number | null;
  vinosmithBillbackAmount: number | null;
  effectiveCost: number | null;
  grossProfit: number | null;
  grossMarginPct: number | null;
  confidenceBucket: GrossProfitConfidenceBucket;
  confidenceScore: number;
  diagnostics: Record<string, unknown>;
};

type MatchExample = {
  transactionType: "invoice" | "credit_memo";
  refNumber: string | null;
  linkedInvoiceRefNumber: string | null;
  item: string | null;
  quantity: number | null;
  amountCents: number | null;
  bucket: GrossProfitConfidenceBucket;
  reason: string;
};

type LineMatch =
  | { status: "matched"; line: VinosmithOrderLineRow; matchType: "exact" | "quantity"; ambiguous: boolean }
  | { status: "missing" }
  | { status: "ambiguous"; line: VinosmithOrderLineRow | null };

type PriceMatch =
  | { status: "matched"; method: "price_id" | "wine_label_price" | "wine_label_current_price"; price: VinosmithPriceRow }
  | { status: "ambiguous" | "missing" };

type BuildOptions = {
  includeLines?: boolean;
  lineLimit?: number;
  includeVinosmithDeliveryRange?: boolean;
};

const PAGE_SIZE = 1000;
const CHUNK_SIZE = 400;

export async function buildGrossProfitWorkflowProof(
  supabase: GrossProfitClient,
  dateFrom: string,
  dateTo: string,
  options: BuildOptions = {}
) {
  const grossProfitCenter = await buildGrossProfitCenter(supabase, dateFrom, dateTo, options);
  const positiveInvoiceLines = grossProfitCenter.lines.filter((line) => line.transactionType === "invoice" && money(line.qbGrossSales) > 0);
  const positiveInvoiceMatchedLines = positiveInvoiceLines.filter((line) => line.vinosmithLineMatchMethod !== "missing" && line.vinosmithLineMatchMethod !== "ambiguous");
  const positiveInvoiceSales = positiveInvoiceLines.reduce((sum, line) => sum + Math.max(0, money(line.qbGrossSales)), 0);
  const positiveInvoiceMatchedSales = positiveInvoiceMatchedLines.reduce((sum, line) => sum + Math.max(0, money(line.qbGrossSales)), 0);
  const lineLimit = Math.max(0, Math.min(options.lineLimit ?? 250, 1000));

  return {
    dateFrom,
    dateTo,
    generatedAt: new Date().toISOString(),
    quickBooksInvoices: grossProfitCenter.quickBooksInvoices,
    quickBooksInvoiceLines: grossProfitCenter.quickBooksInvoiceLines,
    quickBooksCreditMemos: grossProfitCenter.quickBooksCreditMemos,
    quickBooksCreditMemoLines: grossProfitCenter.quickBooksCreditMemoLines,
    quickBooksFinancialLines: grossProfitCenter.lines.length,
    quickBooksInvoiceHeaderSales: grossProfitCenter.quickBooksInvoiceHeaderSales,
    quickBooksCreditMemoHeaderSales: grossProfitCenter.quickBooksCreditMemoHeaderSales,
    quickBooksHeaderNetSales: grossProfitCenter.quickBooksHeaderNetSales,
    quickBooksLineNetSales: grossProfitCenter.quickBooksLineNetSales,
    quickBooksRevenueDelta: grossProfitCenter.quickBooksLineNetSales - grossProfitCenter.quickBooksHeaderNetSales,
    vinosmithOrders: grossProfitCenter.vinosmithOrders,
    vinosmithOrderLines: grossProfitCenter.vinosmithOrderLines,
    invoiceNumberMatches: grossProfitCenter.invoiceNumberMatches,
    positiveRevenueInvoiceLines: positiveInvoiceLines.length,
    positiveRevenueMatchedInvoiceLines: positiveInvoiceMatchedLines.length,
    positiveRevenueLineMatchRate: rate(positiveInvoiceMatchedLines.length, positiveInvoiceLines.length),
    positiveRevenueAmountMatchRate: rate(positiveInvoiceMatchedSales, positiveInvoiceSales),
    grossSales: sumMoney(grossProfitCenter.lines, "qbGrossSales"),
    grossCostBeforeBillback: sumMoney(grossProfitCenter.lines, "grossCostBeforeBillback"),
    billbackEarned: sumMoney(grossProfitCenter.lines, "vinosmithBillbackAmount"),
    effectiveCost: sumMoney(grossProfitCenter.lines, "effectiveCost"),
    grossProfit: sumMoney(grossProfitCenter.lines, "grossProfit"),
    grossMarginPct: marginPct(sumMoney(grossProfitCenter.lines, "grossProfit"), sumMoney(grossProfitCenter.lines, "qbGrossSales")),
    confidenceBuckets: summarizeByBucket(grossProfitCenter.lines),
    priceMatchMethods: summarizeByString(grossProfitCenter.lines, (line) => line.vinosmithPriceMatchMethod),
    costSources: summarizeByString(grossProfitCenter.lines, (line) => line.qbCostSource),
    examples: buildExamples(grossProfitCenter.lines),
    lines: options.includeLines ? grossProfitCenter.lines.slice(0, lineLimit) : undefined
  };
}

export async function buildGrossProfitCenter(
  supabase: GrossProfitClient,
  dateFrom: string,
  dateTo: string,
  options: Pick<BuildOptions, "includeVinosmithDeliveryRange"> = {}
) {
  const [quickBooksInvoices, quickBooksCreditMemos] = await Promise.all([
    fetchQuickBooksInvoices(supabase, dateFrom, dateTo),
    fetchQuickBooksCreditMemos(supabase, dateFrom, dateTo)
  ]);
  const [quickBooksInvoiceLines, quickBooksCreditMemoLines] = await Promise.all([
    fetchQuickBooksLines(supabase, "quickbooks_invoice_lines", quickBooksInvoices.map((row) => row.txn_id)),
    fetchQuickBooksLines(supabase, "quickbooks_credit_memo_lines", quickBooksCreditMemos.map((row) => row.txn_id))
  ]);

  const linkedInvoiceIds = unique(quickBooksCreditMemos.flatMap((row) => linkedInvoiceTxnIds(row.linked_txns)));
  const linkedInvoices = await fetchQuickBooksInvoicesByTxnIds(supabase, linkedInvoiceIds);
  const invoiceRowsByTxnId = new Map([...quickBooksInvoices, ...linkedInvoices].map((row) => [row.txn_id, row]));
  const invoiceRefNumbers = unique([...quickBooksInvoices, ...linkedInvoices].map((row) => row.ref_number || ""));
  const [vinosmithHeadersInRange, vinosmithHeadersByInvoice, quickBooksItems] = await Promise.all([
    options.includeVinosmithDeliveryRange ? fetchVinosmithOrderHeaders(supabase, dateFrom, dateTo) : Promise.resolve([]),
    fetchVinosmithOrderHeadersByInvoiceNumbers(supabase, invoiceRefNumbers),
    fetchQuickBooksItems(supabase, [...quickBooksInvoiceLines, ...quickBooksCreditMemoLines].map((row) => row.item_list_id || ""))
  ]);
  const vinosmithHeaders = Array.from(
    new Map([...vinosmithHeadersInRange, ...vinosmithHeadersByInvoice].map((row) => [row.supplier_order_id, row])).values()
  );
  const vinosmithLines = await fetchVinosmithLines(supabase, vinosmithHeaders.map((row) => row.supplier_order_id));
  const [prices, vinosmithWines] = await Promise.all([
    fetchVinosmithPricesForLines(supabase, vinosmithLines),
    fetchVinosmithWinesForLines(supabase, vinosmithLines)
  ]);

  const headersById = new Map(vinosmithHeaders.map((row) => [row.supplier_order_id, row]));
  const priceById = new Map(prices.map((row) => [row.price_id, row]));
  const priceLookup = buildVinosmithPriceLookup(prices);
  const itemByListId = new Map(quickBooksItems.map((row) => [row.list_id, row]));
  const wineById = new Map(vinosmithWines.map((row) => [row.wine_id, row]));
  const vinoInvoiceNumbers = new Set(vinosmithHeaders.map((row) => normalizeKey(row.invoice_number)).filter(Boolean));
  const invoiceLineLookup = buildVinosmithLineLookup(vinosmithLines, headersById);

  let invoiceNumberMatches = 0;
  quickBooksInvoices.forEach((invoice) => {
    if (vinoInvoiceNumbers.has(normalizeKey(invoice.ref_number))) invoiceNumberMatches += 1;
  });

  const invoiceLines = quickBooksInvoiceLines.map((line) => {
    const invoice = invoiceRowsByTxnId.get(line.txn_id) || null;
    return buildGrossProfitCenterLine({
      transactionType: "invoice",
      transaction: invoice,
      line,
      linkedInvoice: null,
      lookup: invoiceLineLookup,
      priceById,
      priceLookup,
      wineById,
      item: line.item_list_id ? itemByListId.get(line.item_list_id) || null : null
    });
  });
  const creditMemoLines = quickBooksCreditMemoLines.map((line) => {
    const creditMemo = quickBooksCreditMemos.find((row) => row.txn_id === line.txn_id) || null;
    const linkedInvoice = linkedInvoiceForCreditMemo(creditMemo, invoiceRowsByTxnId);
    return buildGrossProfitCenterLine({
      transactionType: "credit_memo",
      transaction: creditMemo,
      line,
      linkedInvoice,
      lookup: invoiceLineLookup,
      priceById,
      priceLookup,
      wineById,
      item: line.item_list_id ? itemByListId.get(line.item_list_id) || null : null
    });
  });

  return {
    lines: [...invoiceLines, ...creditMemoLines],
    quickBooksInvoices: quickBooksInvoices.length,
    quickBooksInvoiceLines: quickBooksInvoiceLines.length,
    quickBooksCreditMemos: quickBooksCreditMemos.length,
    quickBooksCreditMemoLines: quickBooksCreditMemoLines.length,
    quickBooksInvoiceHeaderSales: quickBooksInvoices.reduce((sum, row) => sum + headerAmount(row), 0),
    quickBooksCreditMemoHeaderSales: quickBooksCreditMemos.reduce((sum, row) => sum + Math.abs(headerAmount(row)), 0),
    quickBooksHeaderNetSales:
      quickBooksInvoices.reduce((sum, row) => sum + headerAmount(row), 0) -
      quickBooksCreditMemos.reduce((sum, row) => sum + Math.abs(headerAmount(row)), 0),
    quickBooksLineNetSales: [...invoiceLines, ...creditMemoLines].reduce((sum, line) => sum + money(line.qbGrossSales), 0),
    vinosmithOrders: vinosmithHeaders.length,
    vinosmithOrderLines: vinosmithLines.length,
    invoiceNumberMatches
  };
}

function buildGrossProfitCenterLine({
  transactionType,
  transaction,
  line,
  linkedInvoice,
  lookup,
  priceById,
  priceLookup,
  wineById,
  item
}: {
  transactionType: "invoice" | "credit_memo";
  transaction: QuickBooksInvoiceRow | QuickBooksCreditMemoRow | null;
  line: QuickBooksLineRow;
  linkedInvoice: QuickBooksInvoiceRow | null;
  lookup: Map<string, VinosmithOrderLineRow[]>;
  priceById: Map<string, VinosmithPriceRow>;
  priceLookup: ReturnType<typeof buildVinosmithPriceLookup>;
  wineById: Map<string, VinosmithWineCostRow>;
  item: QuickBooksItemRow | null;
}): GrossProfitCenterLine {
  const sign = transactionType === "credit_memo" ? -1 : 1;
  const unsignedQuantity = absoluteNumberOrNull(line.quantity);
  const quantity = unsignedQuantity === null ? null : sign * unsignedQuantity;
  const qbGrossSales = signedMoney(line.amount, sign);
  const qbUnitPrice = absoluteNumberOrNull(line.rate);
  const match = findVinosmithMatch(line, transaction, linkedInvoice, transactionType, lookup);
  const matchedLine = match.status === "matched" ? match.line : match.status === "ambiguous" ? match.line : null;
  const vinosmithWine = matchedLine?.wine_id ? wineById.get(matchedLine.wine_id) || null : null;
  const cost = itemCost(item, vinosmithWine);
  const grossCostBeforeBillback = quantity !== null && cost.costPerBottle !== null ? quantity * cost.costPerBottle : null;
  const sample = isQuickBooksSampleLine(line) || (matchedLine ? isVinosmithSampleLine(matchedLine) : false);
  const manualPrice = Boolean(matchedLine?.manual_price);
  const priceMatch = matchedLine && !sample && !manualPrice ? matchVinosmithPrice(matchedLine, priceById, priceLookup) : { status: "missing" as const };
  const billbackPerBottle = billbackPerBottleDollars({ matchedLine, sample, manualPrice, priceMatch });
  const billbackAmount = quantity !== null && billbackPerBottle !== null ? quantity * billbackPerBottle : null;
  const effectiveCost = grossCostBeforeBillback === null ? null : grossCostBeforeBillback - (billbackAmount || 0);
  const grossProfit = qbGrossSales === null || effectiveCost === null ? null : qbGrossSales - effectiveCost;
  const bucket = confidenceBucket({
    transactionType,
    match,
    sample,
    manualPrice,
    priceMatch,
    linkedInvoice
  });
  const price = priceMatch.status === "matched" ? priceMatch.price : null;

  return {
    grossProfitCenterLineId: [transactionType, line.txn_id, line.txn_line_id || line.line_sequence || line.id].join(":"),
    transactionType,
    transactionId: line.txn_id,
    transactionLineId: line.txn_line_id,
    transactionLineSequence: line.line_sequence,
    transactionRefNumber: transaction?.ref_number || null,
    linkedInvoiceTxnId: linkedInvoice?.txn_id || null,
    linkedInvoiceRefNumber: linkedInvoice?.ref_number || null,
    salesDate: transaction?.txn_date || null,
    customerListId: transaction?.customer_list_id || null,
    customerFullName: transaction?.customer_full_name || null,
    salesRep: transactionType === "invoice" ? refName((transaction as QuickBooksInvoiceRow | null)?.sales_rep_ref) : creditMemoRepName((transaction as QuickBooksCreditMemoRow | null)?.raw_data),
    itemListId: line.item_list_id,
    itemFullName: line.item_full_name,
    description: line.description,
    quantity,
    qbUnitPrice,
    qbGrossSales,
    qbFobPerBottle: cost.baseCostPerBottle,
    qbLaidInPerBottle: cost.laidInPerBottle,
    qbCostSource: cost.qbCostSource,
    grossCostBeforeBillback,
    vinosmithSupplierOrderId: matchedLine?.supplier_order_id || null,
    vinosmithLineItemId: matchedLine?.line_item_id || null,
    vinosmithWineId: matchedLine?.wine_id || null,
    vinosmithWineCode: matchedLine?.wine_code || null,
    vinosmithWineName: matchedLine?.wine_name || null,
    vinosmithPriceId: matchedLine?.price_id || price?.price_id || null,
    vinosmithPriceLabel: matchedLine?.price_label || price?.label || null,
    vinosmithSoldPriceCents: integerOrNull(matchedLine?.price_cents),
    vinosmithManualPrice: manualPrice,
    vinosmithLineMatchMethod: match.status === "matched" ? match.matchType : match.status,
    vinosmithPriceMatchMethod: priceMatchMethod({ sample, manualPrice, priceMatch, matchedLine }),
    vinosmithBillbackPerBottle: billbackPerBottle,
    vinosmithBillbackAmount: billbackAmount,
    effectiveCost,
    grossProfit,
    grossMarginPct: marginPct(grossProfit, qbGrossSales),
    confidenceBucket: bucket,
    confidenceScore: confidenceScore(bucket),
    diagnostics: {
      cost_basis: cost.qbCostSource,
      vinosmith_fob_price: numberOrNull(vinosmithWine?.fob_price),
      stem_laid_in_per_bottle: cost.laidInPerBottle,
      stem_laid_in_source: vinosmithWine?.stem_laid_in_source || null,
      qb_item_sales_price: numberOrNull(item?.sales_price),
      vinosmith_line_match_ambiguous: match.status === "matched" ? match.ambiguous : match.status === "ambiguous",
      vinosmith_price_current_price_cents: integerOrNull(price?.price_cents),
      vinosmith_sold_line_total_cents: integerOrNull(matchedLine?.total_cents),
      vinosmith_sold_line_discount: numberOrNull(matchedLine?.discount),
      linked_invoice_lookup_used: transactionType === "credit_memo" && Boolean(linkedInvoice)
    }
  };
}

function buildVinosmithLineLookup(lines: VinosmithOrderLineRow[], headersById: Map<string, VinosmithOrderHeaderRow>) {
  const lookup = new Map<string, VinosmithOrderLineRow[]>();

  lines.forEach((line) => {
    const header = headersById.get(line.supplier_order_id) || null;
    const invoiceNumber = normalizeKey(header?.invoice_number);
    const wineCode = normalizeKey(line.wine_code);
    if (!invoiceNumber || !wineCode) return;

    const quantity = absoluteNumberOrNull(line.quantity_bottles);
    const totalCents = absoluteIntegerOrNull(line.total_cents);
    const priceCents = absoluteIntegerOrNull(line.price_cents);
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

function buildVinosmithPriceLookup(prices: VinosmithPriceRow[]) {
  const byExact = new Map<string, VinosmithPriceRow[]>();
  const byWineLabel = new Map<string, VinosmithPriceRow[]>();

  prices.forEach((price) => {
    const exactKey = priceIdentityKey(price.wine_id, price.label, integerOrNull(price.price_cents));
    const labelKey = wineLabelKey(price.wine_id, price.label);
    if (exactKey) {
      const existing = byExact.get(exactKey) || [];
      existing.push(price);
      byExact.set(exactKey, existing);
    }
    if (labelKey) {
      const existing = byWineLabel.get(labelKey) || [];
      existing.push(price);
      byWineLabel.set(labelKey, existing);
    }
  });

  return { byExact, byWineLabel };
}

function matchVinosmithPrice(
  line: VinosmithOrderLineRow,
  priceById: Map<string, VinosmithPriceRow>,
  priceLookup: ReturnType<typeof buildVinosmithPriceLookup>
): PriceMatch {
  if (line.price_id) {
    const price = priceById.get(line.price_id);
    if (price) return { status: "matched", method: "price_id", price };
  }

  const key = priceIdentityKey(line.wine_id, line.price_label, integerOrNull(line.price_cents));
  const candidates = key ? priceLookup.byExact.get(key) || [] : [];
  if (candidates.length === 1) return { status: "matched", method: "wine_label_price", price: candidates[0] };

  const activeCandidates = candidates.filter((price) => price.active !== false && price.disabled !== true);
  if (activeCandidates.length === 1) return { status: "matched", method: "wine_label_price", price: activeCandidates[0] };
  if (candidates.length > 1) return { status: "ambiguous" };

  const labelKey = wineLabelKey(line.wine_id, line.price_label);
  const labelCandidates = labelKey ? priceLookup.byWineLabel.get(labelKey) || [] : [];
  if (labelCandidates.length === 1) return { status: "matched", method: "wine_label_current_price", price: labelCandidates[0] };

  const activeLabelCandidates = labelCandidates.filter((price) => price.active !== false && price.disabled !== true);
  if (activeLabelCandidates.length === 1) {
    return { status: "matched", method: "wine_label_current_price", price: activeLabelCandidates[0] };
  }
  if (labelCandidates.length > 1) return { status: "ambiguous" };
  return { status: "missing" };
}

function findVinosmithMatch(
  line: QuickBooksLineRow,
  transaction: QuickBooksInvoiceRow | QuickBooksCreditMemoRow | null,
  linkedInvoice: QuickBooksInvoiceRow | null,
  transactionType: "invoice" | "credit_memo",
  lookup: Map<string, VinosmithOrderLineRow[]>
): LineMatch {
  const invoiceNumbers = unique([
    transactionType === "credit_memo" ? linkedInvoice?.ref_number || "" : "",
    transaction?.ref_number || ""
  ]);
  if (invoiceNumbers.length === 0) return { status: "missing" };

  const quantity = absoluteNumberOrNull(line.quantity);
  const amountCents = absoluteCentsOrNull(line.amount);
  const rateCents = absoluteCentsOrNull(line.rate);
  const exactMatches: VinosmithOrderLineRow[] = [];
  const quantityMatches: VinosmithOrderLineRow[] = [];

  for (const invoiceNumber of invoiceNumbers.map(normalizeKey).filter(Boolean)) {
    for (const itemKey of itemKeys(line.item_full_name || line.description)) {
      [
        keyFor(invoiceNumber, itemKey, quantity, amountCents, "total"),
        keyFor(invoiceNumber, itemKey, quantity, rateCents, "unit")
      ]
        .filter(Boolean)
        .forEach((key) => exactMatches.push(...(lookup.get(key) || [])));
      const quantityKey = keyFor(invoiceNumber, itemKey, quantity, null, "quantity");
      if (quantityKey) quantityMatches.push(...(lookup.get(quantityKey) || []));
    }
  }

  const uniqueExact = uniqueLines(exactMatches);
  if (uniqueExact.length === 1) return { status: "matched", line: uniqueExact[0], matchType: "exact", ambiguous: false };
  if (uniqueExact.length > 1) return { status: "ambiguous", line: uniqueExact[0] };

  const uniqueQuantity = uniqueLines(quantityMatches);
  if (uniqueQuantity.length === 1) return { status: "matched", line: uniqueQuantity[0], matchType: "quantity", ambiguous: false };
  if (uniqueQuantity.length > 1) return { status: "ambiguous", line: uniqueQuantity[0] };
  return { status: "missing" };
}

async function fetchQuickBooksInvoices(supabase: GrossProfitClient, dateFrom: string, dateTo: string) {
  return fetchAll<QuickBooksInvoiceRow>((from, to) =>
    supabase
      .from("quickbooks_invoices")
      .select("txn_id,ref_number,txn_date,ship_date,customer_list_id,customer_full_name,sales_rep_ref,subtotal,total_amount")
      .gte("txn_date", dateFrom)
      .lte("txn_date", dateTo)
      .order("txn_date", { ascending: true })
      .order("txn_id", { ascending: true })
      .range(from, to)
      .returns<QuickBooksInvoiceRow[]>()
  );
}

async function fetchQuickBooksInvoicesByTxnIds(supabase: GrossProfitClient, txnIds: string[]) {
  const rows: QuickBooksInvoiceRow[] = [];
  for (const chunk of chunks(unique(txnIds), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<QuickBooksInvoiceRow>((from, to) =>
        supabase
          .from("quickbooks_invoices")
          .select("txn_id,ref_number,txn_date,ship_date,customer_list_id,customer_full_name,sales_rep_ref,subtotal,total_amount")
          .in("txn_id", chunk)
          .order("txn_date", { ascending: true })
          .order("txn_id", { ascending: true })
          .range(from, to)
          .returns<QuickBooksInvoiceRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchQuickBooksCreditMemos(supabase: GrossProfitClient, dateFrom: string, dateTo: string) {
  return fetchAll<QuickBooksCreditMemoRow>((from, to) =>
    supabase
      .from("quickbooks_credit_memos")
      .select("txn_id,ref_number,txn_date,customer_list_id,customer_full_name,subtotal,total_amount,linked_txns,raw_data")
      .gte("txn_date", dateFrom)
      .lte("txn_date", dateTo)
      .order("txn_date", { ascending: true })
      .order("txn_id", { ascending: true })
      .range(from, to)
      .returns<QuickBooksCreditMemoRow[]>()
  );
}

async function fetchQuickBooksLines(supabase: GrossProfitClient, table: "quickbooks_invoice_lines" | "quickbooks_credit_memo_lines", txnIds: string[]) {
  const rows: QuickBooksLineRow[] = [];
  for (const chunk of chunks(unique(txnIds), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<QuickBooksLineRow>((from, to) =>
        supabase
          .from(table)
          .select("id,txn_id,txn_line_id,line_sequence,item_list_id,item_full_name,description,quantity,rate,amount")
          .in("txn_id", chunk)
          .order("txn_id", { ascending: true })
          .order("line_sequence", { ascending: true })
          .order("id", { ascending: true })
          .range(from, to)
          .returns<QuickBooksLineRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchQuickBooksItems(supabase: GrossProfitClient, itemListIds: string[]) {
  const rows: QuickBooksItemRow[] = [];
  for (const chunk of chunks(unique(itemListIds), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<QuickBooksItemRow>((from, to) =>
        supabase
          .from("quickbooks_items")
          .select("list_id,full_name,purchase_cost,average_cost,sales_price")
          .in("list_id", chunk)
          .order("list_id", { ascending: true })
          .range(from, to)
          .returns<QuickBooksItemRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchVinosmithOrderHeaders(supabase: GrossProfitClient, dateFrom: string, dateTo: string) {
  return fetchAll<VinosmithOrderHeaderRow>((from, to) =>
    supabase
      .from("vinosmith_order_headers")
      .select("supplier_order_id,invoice_number,account_name,delivery_at")
      .gte("delivery_at", `${dateFrom}T00:00:00`)
      .lte("delivery_at", `${dateTo}T23:59:59`)
      .order("delivery_at", { ascending: true })
      .order("supplier_order_id", { ascending: true })
      .range(from, to)
      .returns<VinosmithOrderHeaderRow[]>()
  );
}

async function fetchVinosmithOrderHeadersByInvoiceNumbers(supabase: GrossProfitClient, invoiceNumbers: string[]) {
  const rows: VinosmithOrderHeaderRow[] = [];
  for (const chunk of chunks(unique(invoiceNumbers), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<VinosmithOrderHeaderRow>((from, to) =>
        supabase
          .from("vinosmith_order_headers")
          .select("supplier_order_id,invoice_number,account_name,delivery_at")
          .in("invoice_number", chunk)
          .order("invoice_number", { ascending: true })
          .order("supplier_order_id", { ascending: true })
          .range(from, to)
          .returns<VinosmithOrderHeaderRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchVinosmithLines(supabase: GrossProfitClient, supplierOrderIds: string[]) {
  const rows: VinosmithOrderLineRow[] = [];
  for (const chunk of chunks(unique(supplierOrderIds), CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<VinosmithOrderLineRow>((from, to) =>
        supabase
          .from("vinosmith_order_lines")
          .select("line_item_id,supplier_order_id,wine_id,wine_code,wine_name,quantity_bottles,price_cents,price_id,price_label,total_cents,discount,manual_price")
          .in("supplier_order_id", chunk)
          .order("supplier_order_id", { ascending: true })
          .order("line_item_id", { ascending: true })
          .range(from, to)
          .returns<VinosmithOrderLineRow[]>()
      ))
    );
  }
  return rows;
}

async function fetchVinosmithPricesForLines(supabase: GrossProfitClient, lines: VinosmithOrderLineRow[]) {
  const priceIds = unique(lines.map((row) => row.price_id || ""));
  const wineIds = unique(lines.map((row) => row.wine_id || ""));
  const rows: VinosmithPriceRow[] = [];
  for (const chunk of chunks(priceIds, CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<VinosmithPriceRow>((from, to) =>
        supabase
          .from("vinosmith_prices")
          .select("price_id,price_cents,bill_back_price_cents,label,wine_id,active,disabled")
          .in("price_id", chunk)
          .order("price_id", { ascending: true })
          .range(from, to)
          .returns<VinosmithPriceRow[]>()
      ))
    );
  }
  for (const chunk of chunks(wineIds, CHUNK_SIZE)) {
    rows.push(
      ...(await fetchAll<VinosmithPriceRow>((from, to) =>
        supabase
          .from("vinosmith_prices")
          .select("price_id,price_cents,bill_back_price_cents,label,wine_id,active,disabled")
          .in("wine_id", chunk)
          .order("price_id", { ascending: true })
          .range(from, to)
          .returns<VinosmithPriceRow[]>()
      ))
    );
  }
  return Array.from(new Map(rows.map((row) => [row.price_id, row])).values());
}

async function fetchVinosmithWinesForLines(supabase: GrossProfitClient, lines: VinosmithOrderLineRow[]) {
  const rows: VinosmithWineCostRow[] = [];
  const wineIds = unique(lines.map((row) => row.wine_id || ""));
  let stemLaidInColumnsAvailable = true;
  for (const chunk of chunks(wineIds, CHUNK_SIZE)) {
    rows.push(...(await fetchVinosmithWineCostChunk(supabase, chunk, stemLaidInColumnsAvailable)));
    if (rows.some((row) => row.stem_laid_in_source === "schema_missing")) stemLaidInColumnsAvailable = false;
  }
  return rows.map((row) => ({
    ...row,
    stem_laid_in_source: row.stem_laid_in_source === "schema_missing" ? null : row.stem_laid_in_source
  }));
}

async function fetchVinosmithWineCostChunk(
  supabase: GrossProfitClient,
  wineIds: string[],
  includeStemLaidIn: boolean
): Promise<VinosmithWineCostRow[]> {
  const selectColumns = includeStemLaidIn ? "wine_id,fob_price,stem_laid_in_per_bottle,stem_laid_in_source" : "wine_id,fob_price";
  const { data, error } = await supabase
    .from("vinosmith_wines")
    .select(selectColumns)
    .in("wine_id", wineIds)
    .order("wine_id", { ascending: true })
    .returns<VinosmithWineCostRow[]>();

  if (!error) {
    return (data || []).map((row) => ({
      wine_id: row.wine_id,
      fob_price: row.fob_price,
      stem_laid_in_per_bottle: includeStemLaidIn ? row.stem_laid_in_per_bottle : 0,
      stem_laid_in_source: includeStemLaidIn ? row.stem_laid_in_source : null
    }));
  }

  if (includeStemLaidIn && /stem_laid_in|column/i.test(error.message)) {
    const fallback: VinosmithWineCostRow[] = await fetchVinosmithWineCostChunk(supabase, wineIds, false);
    return fallback.map((row) => ({ ...row, stem_laid_in_source: "schema_missing" }));
  }

  throw new Error(error.message);
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

function confidenceBucket({
  transactionType,
  match,
  sample,
  manualPrice,
  priceMatch,
  linkedInvoice
}: {
  transactionType: "invoice" | "credit_memo";
  match: LineMatch;
  sample: boolean;
  manualPrice: boolean;
  priceMatch: PriceMatch;
  linkedInvoice: QuickBooksInvoiceRow | null;
}): GrossProfitConfidenceBucket {
  if (sample) return "sample_zero_dollar_or_100_discount";
  if (match.status === "ambiguous") return "ambiguous_vinosmith_line";
  if (match.status === "missing") {
    return transactionType === "credit_memo" || linkedInvoice ? "credit_workflow_missing_vinosmith_line" : "missing_vinosmith_line";
  }
  if (manualPrice) return "qb_price_qb_cost_manual_no_billback";
  if (priceMatch.status === "ambiguous") return "ambiguous_vinosmith_price";
  if (priceMatch.status === "missing") return "missing_vinosmith_price";
  if (priceMatch.status !== "matched") return "missing_vinosmith_price";
  const matchedPrice = priceMatch.price;
  if (numberOrNull(matchedPrice.bill_back_price_cents) === null || numberOrNull(matchedPrice.bill_back_price_cents) === 0) {
    return "qb_price_qb_cost_vinosmith_price_no_billback";
  }
  if (priceMatch.method === "price_id") return "qb_price_qb_cost_vinosmith_price_id_billback";
  if (priceMatch.method === "wine_label_price") return "qb_price_qb_cost_vinosmith_exact_price_billback";
  return "qb_price_qb_cost_vinosmith_unique_label_current_price_billback";
}

function confidenceScore(bucket: GrossProfitConfidenceBucket) {
  if (bucket === "qb_price_qb_cost_vinosmith_price_id_billback") return 0.98;
  if (bucket === "qb_price_qb_cost_vinosmith_exact_price_billback") return 0.94;
  if (bucket === "qb_price_qb_cost_vinosmith_price_no_billback") return 0.9;
  if (bucket === "qb_price_qb_cost_vinosmith_unique_label_current_price_billback") return 0.78;
  if (bucket === "qb_price_qb_cost_manual_no_billback") return 0.74;
  if (bucket === "sample_zero_dollar_or_100_discount") return 0.7;
  if (bucket === "credit_workflow_missing_vinosmith_line") return 0.45;
  if (bucket === "missing_vinosmith_line") return 0.35;
  if (bucket === "missing_vinosmith_price") return 0.32;
  return 0.2;
}

function priceMatchMethod({
  sample,
  manualPrice,
  priceMatch,
  matchedLine
}: {
  sample: boolean;
  manualPrice: boolean;
  priceMatch: PriceMatch;
  matchedLine: VinosmithOrderLineRow | null;
}): GrossProfitCenterLine["vinosmithPriceMatchMethod"] {
  if (sample) return "sample";
  if (manualPrice) return "manual_price";
  if (!matchedLine) return "not_applicable";
  if (priceMatch.status === "matched") return priceMatch.method;
  return priceMatch.status;
}

function billbackPerBottleDollars({
  matchedLine,
  sample,
  manualPrice,
  priceMatch
}: {
  matchedLine: VinosmithOrderLineRow | null;
  sample: boolean;
  manualPrice: boolean;
  priceMatch: PriceMatch;
}) {
  if (!matchedLine) return null;
  if (sample || manualPrice) return 0;
  if (priceMatch.status !== "matched") return 0;
  return centsToDollars(numberOrNull(priceMatch.price.bill_back_price_cents) || 0);
}

function itemCost(
  item: QuickBooksItemRow | null,
  vinosmithWine: VinosmithWineCostRow | null
): Pick<GrossProfitCenterLine, "qbCostSource"> & { costPerBottle: number | null; baseCostPerBottle: number | null; laidInPerBottle: number } {
  const laidInPerBottle = Math.max(0, numberOrNull(vinosmithWine?.stem_laid_in_per_bottle) || 0);
  const purchaseCost = numberOrNull(item?.purchase_cost);
  if (purchaseCost !== null) {
    return {
      baseCostPerBottle: purchaseCost,
      laidInPerBottle,
      costPerBottle: purchaseCost + laidInPerBottle,
      qbCostSource: "quickbooks_items.purchase_cost_current_plus_stem_laid_in"
    };
  }
  const averageCost = numberOrNull(item?.average_cost);
  if (averageCost !== null) {
    return {
      baseCostPerBottle: averageCost,
      laidInPerBottle,
      costPerBottle: averageCost + laidInPerBottle,
      qbCostSource: "quickbooks_items.average_cost_current_plus_stem_laid_in"
    };
  }
  return { baseCostPerBottle: null, laidInPerBottle, costPerBottle: null, qbCostSource: "missing_current_item_cost" };
}

function headerAmount(row: QuickBooksInvoiceRow | QuickBooksCreditMemoRow) {
  return numberOrNull("subtotal" in row ? row.subtotal : null) ?? numberOrNull("total_amount" in row ? row.total_amount : null) ?? 0;
}

function linkedInvoiceForCreditMemo(creditMemo: QuickBooksCreditMemoRow | null, invoicesByTxnId: Map<string, QuickBooksInvoiceRow>) {
  const ids = linkedInvoiceTxnIds(creditMemo?.linked_txns);
  for (const id of ids) {
    const invoice = invoicesByTxnId.get(id);
    if (invoice) return invoice;
  }
  return null;
}

function linkedInvoiceTxnIds(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((row): row is Record<string, unknown> => Boolean(row) && typeof row === "object")
    .filter((row) => normalizeKey(row.TxnType || row.txn_type || row.type) === "invoice")
    .map((row) => String(row.TxnID || row.txn_id || row.id || ""))
    .filter(Boolean);
}

function summarizeByBucket(lines: GrossProfitCenterLine[]) {
  return summarizeByString(lines, (line) => line.confidenceBucket);
}

function summarizeByString(lines: GrossProfitCenterLine[], keyForLine: (line: GrossProfitCenterLine) => string) {
  const buckets = new Map<string, { bucket: string; lines: number; grossSales: number; grossCostBeforeBillback: number; billbackEarned: number; effectiveCost: number; grossProfit: number; grossMarginPct: number | null }>();
  lines.forEach((line) => {
    const bucket = keyForLine(line);
    const current =
      buckets.get(bucket) ||
      {
        bucket,
        lines: 0,
        grossSales: 0,
        grossCostBeforeBillback: 0,
        billbackEarned: 0,
        effectiveCost: 0,
        grossProfit: 0,
        grossMarginPct: null
      };
    current.lines += 1;
    current.grossSales += money(line.qbGrossSales);
    current.grossCostBeforeBillback += money(line.grossCostBeforeBillback);
    current.billbackEarned += money(line.vinosmithBillbackAmount);
    current.effectiveCost += money(line.effectiveCost);
    current.grossProfit += money(line.grossProfit);
    current.grossMarginPct = marginPct(current.grossProfit, current.grossSales);
    buckets.set(bucket, current);
  });
  return Array.from(buckets.values()).sort((a, b) => Math.abs(b.grossSales) - Math.abs(a.grossSales));
}

function buildExamples(lines: GrossProfitCenterLine[]) {
  const examples: MatchExample[] = [];
  for (const line of lines) {
    if (examples.length >= 30) break;
    if (
      ![
        "missing_vinosmith_line",
        "credit_workflow_missing_vinosmith_line",
        "ambiguous_vinosmith_line",
        "ambiguous_vinosmith_price",
        "missing_vinosmith_price",
        "qb_price_qb_cost_manual_no_billback",
        "sample_zero_dollar_or_100_discount"
      ].includes(line.confidenceBucket)
    ) {
      continue;
    }
    examples.push({
      transactionType: line.transactionType,
      refNumber: line.transactionRefNumber,
      linkedInvoiceRefNumber: line.linkedInvoiceRefNumber,
      item: line.itemFullName || line.description,
      quantity: line.quantity,
      amountCents: line.qbGrossSales === null ? null : Math.round(line.qbGrossSales * 100),
      bucket: line.confidenceBucket,
      reason: exampleReason(line)
    });
  }
  return examples;
}

function exampleReason(line: GrossProfitCenterLine) {
  if (line.confidenceBucket === "credit_workflow_missing_vinosmith_line") return "Credit/return line did not find a retained Vinosmith sold line.";
  if (line.confidenceBucket === "missing_vinosmith_line") return "QuickBooks financial line did not find a matching Vinosmith sold line.";
  if (line.confidenceBucket === "sample_zero_dollar_or_100_discount") return "Zero-dollar or 100% discount line is separated from normal GP.";
  if (line.confidenceBucket === "qb_price_qb_cost_manual_no_billback") return "Vinosmith sold line was manually priced; no billback applied.";
  if (line.confidenceBucket === "ambiguous_vinosmith_price") return "More than one Vinosmith price row matched the sold-line identity.";
  if (line.confidenceBucket === "missing_vinosmith_price") return "Sold line matched, but no Vinosmith price row was available for billback enrichment.";
  return "More than one Vinosmith sold line matched the QuickBooks line identity.";
}

function keyFor(invoiceNumber: string, itemKey: string, quantity: number | null, cents: number | null, mode: string) {
  if (!invoiceNumber || !itemKey || quantity === null) return "";
  return [invoiceNumber, itemKey, quantity.toFixed(4), mode, cents === null ? "" : String(cents)].join("|");
}

function priceIdentityKey(wineId: string | null | undefined, label: string | null | undefined, priceCents: number | null) {
  const normalizedWineId = normalizeKey(wineId);
  const normalizedLabel = normalizeKey(label);
  if (!normalizedWineId || !normalizedLabel || priceCents === null) return "";
  return [normalizedWineId, normalizedLabel, String(priceCents)].join("|");
}

function wineLabelKey(wineId: string | null | undefined, label: string | null | undefined) {
  const normalizedWineId = normalizeKey(wineId);
  const normalizedLabel = normalizeKey(label);
  if (!normalizedWineId || !normalizedLabel) return "";
  return [normalizedWineId, normalizedLabel].join("|");
}

function itemKeys(value: string | null | undefined) {
  const full = normalizeKey(value);
  if (!full) return [];
  const terminal = normalizeKey(full.split(":").at(-1));
  return unique([full, terminal]);
}

function isQuickBooksSampleLine(line: QuickBooksLineRow) {
  const amountCents = absoluteCentsOrNull(line.amount);
  return amountCents === 0;
}

function isVinosmithSampleLine(line: VinosmithOrderLineRow) {
  const totalCents = absoluteIntegerOrNull(line.total_cents);
  const discount = numberOrNull(line.discount);
  return totalCents === 0 || (discount !== null && discount >= 100);
}

function refName(value: Record<string, unknown> | null | undefined) {
  if (typeof value?.ResolvedFullName === "string") return value.ResolvedFullName;
  if (typeof value?.SalesRepEntityFullName === "string") return value.SalesRepEntityFullName;
  if (typeof value?.resolvedFullName === "string") return value.resolvedFullName;
  if (typeof value?.FullName === "string") return value.FullName;
  if (typeof value?.fullName === "string") return value.fullName;
  if (typeof value?.Name === "string") return value.Name;
  if (typeof value?.name === "string") return value.name;
  return null;
}

function creditMemoRepName(rawData: Record<string, unknown> | null | undefined) {
  const salesRepRef = rawData?.sales_rep_ref;
  return salesRepRef && typeof salesRepRef === "object" ? refName(salesRepRef as Record<string, unknown>) : null;
}

function normalizeKey(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function numberOrNull(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function absoluteNumberOrNull(value: unknown) {
  const number = numberOrNull(value);
  return number === null ? null : Math.abs(number);
}

function integerOrNull(value: unknown) {
  const number = numberOrNull(value);
  return number === null ? null : Math.round(number);
}

function absoluteIntegerOrNull(value: unknown) {
  const number = integerOrNull(value);
  return number === null ? null : Math.abs(number);
}

function absoluteCentsOrNull(value: unknown) {
  const number = absoluteNumberOrNull(value);
  return number === null ? null : Math.round(number * 100);
}

function signedMoney(value: unknown, sign: 1 | -1) {
  const number = absoluteNumberOrNull(value);
  return number === null ? null : sign * number;
}

function centsToDollars(value: number) {
  return value / 100;
}

function money(value: number | null | undefined) {
  return value || 0;
}

function sumMoney(lines: GrossProfitCenterLine[], key: "qbGrossSales" | "grossCostBeforeBillback" | "vinosmithBillbackAmount" | "effectiveCost" | "grossProfit") {
  return lines.reduce((sum, line) => sum + money(line[key]), 0);
}

function marginPct(grossProfit: number | null, grossSales: number | null) {
  if (grossProfit === null || grossSales === null || grossSales === 0) return null;
  return grossProfit / grossSales;
}

function rate(numerator: number, denominator: number) {
  return denominator === 0 ? null : numerator / denominator;
}

function unique(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function uniqueLines(lines: VinosmithOrderLineRow[]) {
  return Array.from(new Map(lines.map((row) => [row.line_item_id, row])).values());
}

function chunks<T>(values: T[], size: number) {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}
