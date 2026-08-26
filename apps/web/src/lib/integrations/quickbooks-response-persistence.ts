import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceRoleClient } from "@/lib/supabase/server";
import type { QuickBooksDesktopQbxmlRequest, QuickBooksQbxmlResponseStatus } from "@/lib/integrations/quickbooks-desktop";

type QbRef = {
  ListID?: string | null;
  FullName?: string | null;
};

type PersistQuickBooksResponseInput = {
  request: QuickBooksDesktopQbxmlRequest;
  response: string;
  status: QuickBooksQbxmlResponseStatus[];
  responseChecksum: string;
  receivedAt: string;
  rawStoragePath?: string | null;
};

type SalesRepLookup = {
  initial: string | null;
  fullName: string | null;
  listId: string | null;
};

const salesRepLookupByInitial = new Map<string, SalesRepLookup>();
const salesRepLookupByListId = new Map<string, SalesRepLookup>();
let salesRepLookupHydrated = false;

type ParsedLine = {
  txn_line_id: string | null;
  line_sequence: number;
  item_list_id: string | null;
  item_full_name: string | null;
  description: string | null;
  quantity: number | null;
  unit_of_measure: string | null;
  rate: number | null;
  amount: number | null;
  class_ref: QbRef;
  raw_data: Record<string, unknown>;
};

type ParsedPurchaseOrderLine = ParsedLine & {
  received_quantity: number | null;
};

export async function persistQuickBooksResponse(input: PersistQuickBooksResponseInput) {
  if (!shouldPersistRequest(input.request.requestType)) return;

  const supabase: SupabaseClient = createServiceRoleClient();

  const rawResponse = await recordRawResponse(supabase, input);
  if (input.request.requestType === "SalesRepQueryRq") {
    await persistSalesRepLookup(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "CustomerQueryRq") {
    await persistCustomers(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "VendorQueryRq") {
    await persistVendors(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "ItemQueryRq" || input.request.requestType === "ItemInventoryQueryRq") {
    await persistItems(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "InvoiceQueryRq") {
    await persistInvoices(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "CreditMemoQueryRq") {
    await persistCreditMemos(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "ReceivePaymentQueryRq") {
    await persistReceivePayments(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "PurchaseOrderQueryRq") {
    await persistPurchaseOrders(supabase, input.response, rawResponse.id);
  }
}

function shouldPersistRequest(requestType: string) {
  return [
    "SalesRepQueryRq",
    "CustomerQueryRq",
    "VendorQueryRq",
    "ItemQueryRq",
    "ItemInventoryQueryRq",
    "InvoiceQueryRq",
    "CreditMemoQueryRq",
    "ReceivePaymentQueryRq",
    "PurchaseOrderQueryRq",
    "TxnDeletedQueryRq"
  ].includes(requestType);
}

async function recordRawResponse(supabase: SupabaseClient, input: PersistQuickBooksResponseInput) {
  const firstStatus = input.status[0] || null;
  const { data, error } = await supabase
    .from("source_api_responses")
    .insert({
      source_system: "quickbooks_desktop",
      endpoint: input.request.requestType,
      request_method: "QBXML",
      request_identifier: input.request.requestId || null,
      requested_params: {
        requestType: input.request.requestType,
        qbxmlVersion: input.request.qbxmlVersion
      },
      returned_metadata: { statuses: input.status },
      response_status: firstStatus?.statusCode ?? null,
      response_status_text: firstStatus?.statusMessage || firstStatus?.statusSeverity || null,
      content_type: "application/qbxml",
      byte_size: Buffer.byteLength(input.response, "utf8"),
      checksum: input.responseChecksum,
      raw_storage_path: input.rawStoragePath || null,
      record_count: countReturnedRecords(input.request.requestType, input.response),
      fetched_at: input.receivedAt
    })
    .select("id")
    .single<{ id: string }>();

  if (error || !data) {
    throw new Error(error?.message || "Could not record QuickBooks raw response.");
  }
  return data;
}

async function persistSalesRepLookup(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const salesRepBlock of extractBlocks(response, "SalesRepRet")) {
    const listId = text(salesRepBlock, "ListID");
    if (!listId) continue;
    const entityRef = ref(salesRepBlock, "SalesRepEntityRef");
    rows.push({
      list_id: listId,
      initial: text(salesRepBlock, "Initial"),
      full_name: entityRef.FullName || text(salesRepBlock, "Initial"),
      entity_list_id: entityRef.ListID || null,
      entity_full_name: entityRef.FullName || null,
      raw_response_id: rawResponseId,
      raw_data: { sales_rep_entity_ref: entityRef },
      last_seen_at: now,
      updated_at: now
    });
  }

  if (rows.length > 0) {
    const { error } = await supabase.from("quickbooks_sales_reps").upsert(rows, { onConflict: "list_id" });
    if (error && !isMissingSalesRepTable(error)) throw new Error(error.message);
  }

  for (const salesRepBlock of extractBlocks(response, "SalesRepRet")) {
    const initial = text(salesRepBlock, "Initial");
    const entityRef = ref(salesRepBlock, "SalesRepEntityRef");
    const lookup: SalesRepLookup = {
      initial,
      fullName: entityRef.FullName || initial,
      listId: text(salesRepBlock, "ListID")
    };
    if (lookup.initial) salesRepLookupByInitial.set(lookup.initial.toLowerCase(), lookup);
    if (lookup.listId) salesRepLookupByListId.set(lookup.listId, lookup);
  }
  salesRepLookupHydrated = true;
}

async function persistCustomers(supabase: SupabaseClient, response: string, rawResponseId: string) {
  await hydrateSalesRepLookup(supabase);
  const now = new Date().toISOString();
  const rows = extractBlocks(response, "CustomerRet")
    .map((customerBlock) => {
      const listId = text(customerBlock, "ListID");
      const fullName = text(customerBlock, "FullName");
      if (!listId || !fullName) return null;
      return {
        list_id: listId,
        edit_sequence: text(customerBlock, "EditSequence"),
        name: text(customerBlock, "Name"),
        full_name: fullName,
        is_active: boolText(customerBlock, "IsActive"),
        account_number: text(customerBlock, "AccountNumber"),
        terms_ref: ref(customerBlock, "TermsRef"),
        balance: numberText(customerBlock, "Balance"),
        time_created: dateTimeText(customerBlock, "TimeCreated"),
        time_modified: dateTimeText(customerBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: {
          parent_ref: ref(customerBlock, "ParentRef"),
          sales_rep_ref: enrichSalesRepRef(ref(customerBlock, "SalesRepRef"))
        },
        last_seen_at: now
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  await upsertRows(supabase, "quickbooks_customers", rows, "list_id");
}

async function persistVendors(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const now = new Date().toISOString();
  const rows = extractBlocks(response, "VendorRet")
    .map((vendorBlock) => {
      const listId = directText(vendorBlock, "ListID");
      const name = directText(vendorBlock, "Name");
      const fullName = directText(vendorBlock, "FullName") || name;
      if (!listId || !name || !fullName) return null;
      return {
        list_id: listId,
        edit_sequence: directText(vendorBlock, "EditSequence"),
        name,
        full_name: fullName,
        is_active: boolText(vendorBlock, "IsActive", "direct"),
        account_number: directText(vendorBlock, "AccountNumber"),
        terms_ref: ref(vendorBlock, "TermsRef"),
        balance: numberText(vendorBlock, "Balance", "direct"),
        time_created: dateTimeText(vendorBlock, "TimeCreated", "direct"),
        time_modified: dateTimeText(vendorBlock, "TimeModified", "direct"),
        raw_response_id: rawResponseId,
        raw_data: {
          vendor_type_ref: ref(vendorBlock, "VendorTypeRef"),
          vendor_address: address(vendorBlock, "VendorAddress"),
          vendor_address_block: addressBlock(vendorBlock, "VendorAddressBlock")
        },
        last_seen_at: now
      };
    })
    .filter((row): row is NonNullable<typeof row> => Boolean(row));
  await upsertRows(supabase, "quickbooks_vendors", rows, "list_id");
}

async function persistItems(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const now = new Date().toISOString();
  const rows: Record<string, unknown>[] = [];
  for (const itemType of itemRetTypes()) {
    for (const itemBlock of extractBlocks(response, itemType)) {
      const listId = text(itemBlock, "ListID");
      const fullName = text(itemBlock, "FullName");
      if (!listId || !fullName) continue;
      const itemCustomFields = customFields(itemBlock);
      rows.push({
        list_id: listId,
        edit_sequence: text(itemBlock, "EditSequence"),
        item_type: itemType.replace(/^Item/, "").replace(/Ret$/, ""),
        name: text(itemBlock, "Name"),
        full_name: fullName,
        is_active: boolText(itemBlock, "IsActive"),
        sales_desc: text(itemBlock, "SalesDesc") || text(itemBlock, "Desc"),
        purchase_desc: text(itemBlock, "PurchaseDesc"),
        sales_price: numberText(itemBlock, "SalesPrice") || numberText(itemBlock, "Price"),
        purchase_cost: numberText(itemBlock, "PurchaseCost"),
        average_cost: numberText(itemBlock, "AverageCost"),
        quantity_on_hand: numberText(itemBlock, "QuantityOnHand"),
        quantity_on_order: numberText(itemBlock, "QuantityOnOrder"),
        quantity_on_sales_order: numberText(itemBlock, "QuantityOnSalesOrder"),
        income_account_ref: ref(itemBlock, "IncomeAccountRef"),
        cogs_account_ref: ref(itemBlock, "COGSAccountRef"),
        asset_account_ref: ref(itemBlock, "AssetAccountRef"),
        custom_fields: itemCustomFields,
        time_created: dateTimeText(itemBlock, "TimeCreated"),
        time_modified: dateTimeText(itemBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: {
          parent_ref: ref(itemBlock, "ParentRef"),
          preferred_vendor_ref: ref(itemBlock, "PrefVendorRef"),
          custom_field_count: customFieldCount(itemBlock)
        },
        last_seen_at: now
      });
    }
  }
  await upsertRows(supabase, "quickbooks_items", rows, "list_id");
}

async function persistInvoices(supabase: SupabaseClient, response: string, rawResponseId: string) {
  await hydrateSalesRepLookup(supabase);
  const now = new Date().toISOString();
  const documents = extractBlocks(response, "InvoiceRet").flatMap((invoiceBlock) => {
    const txnId = text(invoiceBlock, "TxnID");
    if (!txnId) return [];

    const invoiceCustomFields = customFields(invoiceBlock);
    const customerRef = ref(invoiceBlock, "CustomerRef");
    const salesRepRef = ref(invoiceBlock, "SalesRepRef");
    const termsRef = ref(invoiceBlock, "TermsRef");
    const linkedTxns = extractBlocks(invoiceBlock, "LinkedTxn").map((block) => rawLinkedTxn(block));
    const lines = parseLines(invoiceBlock, "InvoiceLineRet");

    return [{
      txnId,
      editSequence: text(invoiceBlock, "EditSequence"),
      lines,
      header: {
        txn_id: txnId,
        edit_sequence: text(invoiceBlock, "EditSequence"),
        ref_number: text(invoiceBlock, "RefNumber"),
        txn_date: dateText(invoiceBlock, "TxnDate"),
        ship_date: dateText(invoiceBlock, "ShipDate"),
        due_date: dateText(invoiceBlock, "DueDate"),
        customer_list_id: customerRef.ListID || null,
        customer_full_name: customerRef.FullName || null,
        terms_ref: termsRef,
        sales_rep_ref: enrichSalesRepRef(salesRepRef),
        subtotal: numberText(invoiceBlock, "Subtotal"),
        total_amount: numberText(invoiceBlock, "TotalAmount"),
        balance_remaining: numberText(invoiceBlock, "BalanceRemaining"),
        is_paid: boolText(invoiceBlock, "IsPaid"),
        is_pending: boolText(invoiceBlock, "IsPending"),
        linked_txns: linkedTxns,
        custom_fields: invoiceCustomFields,
        time_created: dateTimeText(invoiceBlock, "TimeCreated"),
        time_modified: dateTimeText(invoiceBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: {
          customer_ref: customerRef,
          sales_rep_ref: enrichSalesRepRef(salesRepRef),
          line_count: lines.length,
          custom_field_count: customFieldCount(invoiceBlock)
        },
        last_seen_at: now
      }
    }];
  });
  const changed = await changedTransactions(supabase, "quickbooks_invoices", documents);
  await upsertRows(supabase, "quickbooks_invoices", changed.map((document) => document.header), "txn_id");
  await replaceLinesForTransactions(supabase, "quickbooks_invoice_lines", changed);
}

async function persistCreditMemos(supabase: SupabaseClient, response: string, rawResponseId: string) {
  await hydrateSalesRepLookup(supabase);
  const now = new Date().toISOString();
  const documents = extractBlocks(response, "CreditMemoRet").flatMap((creditMemoBlock) => {
    const txnId = text(creditMemoBlock, "TxnID");
    if (!txnId) return [];

    const creditMemoCustomFields = customFields(creditMemoBlock);
    const customerRef = ref(creditMemoBlock, "CustomerRef");
    const salesRepRef = ref(creditMemoBlock, "SalesRepRef");
    const linkedTxns = extractBlocks(creditMemoBlock, "LinkedTxn").map((block) => rawLinkedTxn(block));
    const lines = parseLines(creditMemoBlock, "CreditMemoLineRet");

    return [{
      txnId,
      editSequence: text(creditMemoBlock, "EditSequence"),
      lines,
      header: {
        txn_id: txnId,
        edit_sequence: text(creditMemoBlock, "EditSequence"),
        ref_number: text(creditMemoBlock, "RefNumber"),
        txn_date: dateText(creditMemoBlock, "TxnDate"),
        customer_list_id: customerRef.ListID || null,
        customer_full_name: customerRef.FullName || null,
        subtotal: numberText(creditMemoBlock, "Subtotal"),
        total_amount: numberText(creditMemoBlock, "TotalAmount"),
        linked_txns: linkedTxns,
        custom_fields: creditMemoCustomFields,
        time_created: dateTimeText(creditMemoBlock, "TimeCreated"),
        time_modified: dateTimeText(creditMemoBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: {
          customer_ref: customerRef,
          sales_rep_ref: enrichSalesRepRef(salesRepRef),
          line_count: lines.length,
          custom_field_count: customFieldCount(creditMemoBlock)
        },
        last_seen_at: now
      }
    }];
  });
  const changed = await changedTransactions(supabase, "quickbooks_credit_memos", documents);
  await upsertRows(supabase, "quickbooks_credit_memos", changed.map((document) => document.header), "txn_id");
  await replaceLinesForTransactions(supabase, "quickbooks_credit_memo_lines", changed);
}

async function persistReceivePayments(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const now = new Date().toISOString();
  const rows = extractBlocks(response, "ReceivePaymentRet").flatMap((paymentBlock) => {
    const txnId = text(paymentBlock, "TxnID");
    if (!txnId) return [];
    const customerRef = ref(paymentBlock, "CustomerRef");
    return [{
        txn_id: txnId,
        edit_sequence: text(paymentBlock, "EditSequence"),
        ref_number: text(paymentBlock, "RefNumber"),
        txn_date: dateText(paymentBlock, "TxnDate"),
        customer_list_id: customerRef.ListID || null,
        customer_full_name: customerRef.FullName || null,
        total_amount: numberText(paymentBlock, "TotalAmount"),
        payment_method_ref: ref(paymentBlock, "PaymentMethodRef"),
        deposit_to_account_ref: ref(paymentBlock, "DepositToAccountRef"),
        applied_txns: extractBlocks(paymentBlock, "AppliedToTxnRet").map((block) => ({
          TxnID: text(block, "TxnID"),
          RefNumber: text(block, "RefNumber"),
          Amount: numberText(block, "Amount")
        })),
        time_created: dateTimeText(paymentBlock, "TimeCreated"),
        time_modified: dateTimeText(paymentBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: { customer_ref: customerRef },
        last_seen_at: now
    }];
  });
  await upsertRows(supabase, "quickbooks_receive_payments", rows, "txn_id");
}

async function persistPurchaseOrders(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const now = new Date().toISOString();
  const documents = extractBlocks(response, "PurchaseOrderRet").flatMap((purchaseOrderBlock) => {
    const txnId = text(purchaseOrderBlock, "TxnID");
    if (!txnId) return [];

    const purchaseOrderCustomFields = customFields(purchaseOrderBlock);
    const vendorRef = ref(purchaseOrderBlock, "VendorRef");
    const linkedTxns = extractBlocks(purchaseOrderBlock, "LinkedTxn").map((block) => rawLinkedTxn(block));
    const lines = parsePurchaseOrderLines(purchaseOrderBlock);

    return [{
      txnId,
      editSequence: text(purchaseOrderBlock, "EditSequence"),
      lines,
      header: {
        txn_id: txnId,
        edit_sequence: text(purchaseOrderBlock, "EditSequence"),
        ref_number: text(purchaseOrderBlock, "RefNumber"),
        txn_date: dateText(purchaseOrderBlock, "TxnDate"),
        due_date: dateText(purchaseOrderBlock, "DueDate"),
        expected_date: dateText(purchaseOrderBlock, "ExpectedDate"),
        vendor_list_id: vendorRef.ListID || null,
        vendor_full_name: vendorRef.FullName || null,
        subtotal: numberText(purchaseOrderBlock, "Subtotal"),
        total_amount: numberText(purchaseOrderBlock, "TotalAmount"),
        is_fully_received: boolText(purchaseOrderBlock, "IsFullyReceived"),
        linked_txns: linkedTxns,
        custom_fields: purchaseOrderCustomFields,
        time_created: dateTimeText(purchaseOrderBlock, "TimeCreated"),
        time_modified: dateTimeText(purchaseOrderBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: {
          vendor_ref: vendorRef,
          line_count: lines.length,
          custom_field_count: customFieldCount(purchaseOrderBlock)
        },
        last_seen_at: now
      }
    }];
  });
  const changed = await changedTransactions(supabase, "quickbooks_purchase_orders", documents);
  await upsertRows(supabase, "quickbooks_purchase_orders", changed.map((document) => document.header), "txn_id");
  await replacePurchaseOrderLinesForTransactions(supabase, changed);
}

async function replaceLinesForTransactions(
  supabase: SupabaseClient,
  table: string,
  documents: Array<{ txnId: string; lines: ParsedLine[] }>
) {
  if (documents.length === 0) return;
  const { error: deleteError } = await supabase.from(table).delete().in("txn_id", documents.map((document) => document.txnId));
  if (deleteError) throw new Error(deleteError.message);
  const rows = documents.flatMap((document) => document.lines.map((line) => ({
    txn_id: document.txnId,
    txn_line_id: line.txn_line_id,
    line_sequence: line.line_sequence,
    item_list_id: line.item_list_id,
    item_full_name: line.item_full_name,
    description: line.description,
    quantity: line.quantity,
    unit_of_measure: line.unit_of_measure,
    rate: line.rate,
    amount: line.amount,
    class_ref: line.class_ref,
    raw_data: line.raw_data
  })));
  if (rows.length === 0) return;

  const { error: insertError } = await supabase.from(table).insert(rows);
  if (insertError) throw new Error(insertError.message);
}

function parseLines(parentBlock: string, lineTag: "InvoiceLineRet" | "CreditMemoLineRet") {
  return extractBlocks(parentBlock, lineTag).map((lineBlock, index): ParsedLine => parseLine(lineBlock, index));
}

function parsePurchaseOrderLines(parentBlock: string) {
  return extractBlocks(parentBlock, "PurchaseOrderLineRet").map((lineBlock, index): ParsedPurchaseOrderLine => ({
    ...parseLine(lineBlock, index),
    received_quantity: numberText(lineBlock, "ReceivedQuantity")
  }));
}

function parseLine(lineBlock: string, index: number): ParsedLine {
  const itemRef = ref(lineBlock, "ItemRef");
  const classRef = ref(lineBlock, "ClassRef");
  return {
    txn_line_id: text(lineBlock, "TxnLineID"),
    line_sequence: index + 1,
    item_list_id: itemRef.ListID || null,
    item_full_name: itemRef.FullName || null,
    description: text(lineBlock, "Desc"),
    quantity: numberText(lineBlock, "Quantity"),
    unit_of_measure: text(lineBlock, "UnitOfMeasure"),
    rate: numberText(lineBlock, "Rate"),
    amount: numberText(lineBlock, "Amount"),
    class_ref: classRef,
    raw_data: {
      item_ref: itemRef,
      class_ref: classRef
    }
  };
}

async function replacePurchaseOrderLinesForTransactions(
  supabase: SupabaseClient,
  documents: Array<{ txnId: string; lines: ParsedPurchaseOrderLine[] }>
) {
  if (documents.length === 0) return;
  const { error: deleteError } = await supabase
    .from("quickbooks_purchase_order_lines")
    .delete()
    .in("txn_id", documents.map((document) => document.txnId));
  if (deleteError) throw new Error(deleteError.message);
  const rows = documents.flatMap((document) => document.lines.map((line) => ({
    txn_id: document.txnId,
    txn_line_id: line.txn_line_id,
    line_sequence: line.line_sequence,
    item_list_id: line.item_list_id,
    item_full_name: line.item_full_name,
    description: line.description,
    quantity: line.quantity,
    received_quantity: line.received_quantity,
    unit_of_measure: line.unit_of_measure,
    rate: line.rate,
    amount: line.amount,
    class_ref: line.class_ref,
    raw_data: line.raw_data
  })));
  if (rows.length === 0) return;

  const { error: insertError } = await supabase.from("quickbooks_purchase_order_lines").insert(rows);
  if (insertError) throw new Error(insertError.message);
}

async function changedTransactions<T extends { txnId: string; editSequence: string | null }>(
  supabase: SupabaseClient,
  table: string,
  documents: T[]
) {
  if (documents.length === 0) return documents;
  const { data, error } = await supabase
    .from(table)
    .select("txn_id,edit_sequence")
    .in("txn_id", documents.map((document) => document.txnId))
    .returns<Array<{ txn_id: string; edit_sequence: string | null }>>();
  if (error) throw new Error(error.message);

  const existingEditSequenceByTxnId = new Map((data || []).map((row) => [row.txn_id, row.edit_sequence]));
  return documents.filter(
    (document) => !existingEditSequenceByTxnId.has(document.txnId) || existingEditSequenceByTxnId.get(document.txnId) !== document.editSequence
  );
}

async function upsertRows(supabase: SupabaseClient, table: string, rows: Record<string, unknown>[], onConflict: string) {
  if (rows.length === 0) return;
  const { error } = await supabase.from(table).upsert(rows, { onConflict });
  if (error) throw new Error(error.message);
}

async function hydrateSalesRepLookup(supabase: SupabaseClient) {
  if (salesRepLookupHydrated) return;
  const { data, error } = await supabase
    .from("quickbooks_sales_reps")
    .select("list_id,initial,full_name")
    .returns<Array<{ list_id: string; initial: string | null; full_name: string | null }>>();
  if (error) {
    if (isMissingSalesRepTable(error)) return;
    throw new Error(error.message);
  }

  for (const row of data || []) {
    const lookup: SalesRepLookup = { listId: row.list_id, initial: row.initial, fullName: row.full_name };
    if (lookup.initial) salesRepLookupByInitial.set(lookup.initial.toLowerCase(), lookup);
    salesRepLookupByListId.set(row.list_id, lookup);
  }
  salesRepLookupHydrated = true;
}

function isMissingSalesRepTable(error: { code?: string; message: string }) {
  return error.code === "42P01" || /quickbooks_sales_reps/i.test(error.message) && /does not exist|schema cache/i.test(error.message);
}

function enrichSalesRepRef(salesRepRef: QbRef) {
  const lookup = salesRepRef.ListID
    ? salesRepLookupByListId.get(salesRepRef.ListID)
    : salesRepRef.FullName
      ? salesRepLookupByInitial.get(salesRepRef.FullName.toLowerCase())
      : null;

  if (!lookup?.fullName || lookup.fullName === salesRepRef.FullName) return salesRepRef;

  return {
    ...salesRepRef,
    Initial: lookup.initial,
    ResolvedFullName: lookup.fullName,
    SalesRepEntityFullName: lookup.fullName
  };
}

function rawLinkedTxn(block: string) {
  return {
    TxnID: text(block, "TxnID"),
    TxnType: text(block, "TxnType"),
    TxnDate: dateText(block, "TxnDate"),
    RefNumber: text(block, "RefNumber"),
    LinkType: text(block, "LinkType"),
    Amount: numberText(block, "Amount")
  };
}

function countReturnedRecords(requestType: string, response: string) {
  if (requestType === "SalesRepQueryRq") return extractBlocks(response, "SalesRepRet").length;
  if (requestType === "CustomerQueryRq") return extractBlocks(response, "CustomerRet").length;
  if (requestType === "VendorQueryRq") return extractBlocks(response, "VendorRet").length;
  if (requestType === "ItemQueryRq") return itemRetTypes().reduce((sum, tagName) => sum + extractBlocks(response, tagName).length, 0);
  if (requestType === "ItemInventoryQueryRq") return extractBlocks(response, "ItemInventoryRet").length;
  if (requestType === "InvoiceQueryRq") return extractBlocks(response, "InvoiceRet").length;
  if (requestType === "CreditMemoQueryRq") return extractBlocks(response, "CreditMemoRet").length;
  if (requestType === "ReceivePaymentQueryRq") return extractBlocks(response, "ReceivePaymentRet").length;
  if (requestType === "PurchaseOrderQueryRq") return extractBlocks(response, "PurchaseOrderRet").length;
  if (requestType === "TxnDeletedQueryRq") return extractBlocks(response, "TxnDeletedRet").length;
  return null;
}

function itemRetTypes() {
  return [
    "ItemServiceRet",
    "ItemInventoryRet",
    "ItemNonInventoryRet",
    "ItemOtherChargeRet",
    "ItemSubtotalRet",
    "ItemDiscountRet",
    "ItemPaymentRet",
    "ItemSalesTaxRet",
    "ItemGroupRet",
    "ItemSalesTaxGroupRet",
    "ItemFixedAssetRet",
    "ItemInventoryAssemblyRet"
  ];
}

function address(block: string, tagName: string) {
  const address = firstBlock(block, tagName);
  if (!address) return {};
  return {
    Addr1: text(address, "Addr1"),
    Addr2: text(address, "Addr2"),
    Addr3: text(address, "Addr3"),
    Addr4: text(address, "Addr4"),
    Addr5: text(address, "Addr5"),
    City: text(address, "City"),
    State: text(address, "State"),
    PostalCode: text(address, "PostalCode"),
    Country: text(address, "Country")
  };
}

function addressBlock(block: string, tagName: string) {
  const address = firstBlock(block, tagName);
  if (!address) return {};
  return {
    Addr1: text(address, "Addr1"),
    Addr2: text(address, "Addr2"),
    Addr3: text(address, "Addr3"),
    Addr4: text(address, "Addr4"),
    Addr5: text(address, "Addr5")
  };
}

function ref(block: string, tagName: string): QbRef {
  const refBlock = firstBlock(block, tagName);
  if (!refBlock) return {};
  return {
    ListID: text(refBlock, "ListID"),
    FullName: text(refBlock, "FullName")
  };
}

function customFields(block: string) {
  const fields: Record<string, unknown> = {};
  for (const fieldBlock of extractBlocks(block, "DataExtRet")) {
    const name = text(fieldBlock, "DataExtName");
    if (!name) continue;

    const value = text(fieldBlock, "DataExtValue");
    const normalizedKey = normalizeCustomFieldKey(name);
    const field = {
      name,
      value,
      ownerId: text(fieldBlock, "OwnerID"),
      type: text(fieldBlock, "DataExtType")
    };

    fields[name] = field;
    fields[normalizedKey] = field;
  }
  return fields;
}

function customFieldCount(block: string) {
  return extractBlocks(block, "DataExtRet").filter((fieldBlock) => text(fieldBlock, "DataExtName")).length;
}

function normalizeCustomFieldKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function text(block: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = pattern.exec(block);
  return match ? decodeXml(match[1]).trim() || null : null;
}

function numberText(block: string, tagName: string, mode: "any" | "direct" = "any") {
  const value = mode === "direct" ? directText(block, tagName) : text(block, tagName);
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function boolText(block: string, tagName: string, mode: "any" | "direct" = "any") {
  const value = mode === "direct" ? directText(block, tagName) : text(block, tagName);
  if (!value) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  return null;
}

function dateText(block: string, tagName: string) {
  const value = text(block, tagName);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateTimeText(block: string, tagName: string, mode: "any" | "direct" = "any") {
  const value = mode === "direct" ? directText(block, tagName) : text(block, tagName);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstBlock(block: string, tagName: string) {
  return extractBlocks(block, tagName)[0] || null;
}

function directText(block: string, tagName: string) {
  const openTagPattern = /<\s*(\/?)([A-Za-z0-9_:.-]+)\b[^>]*(\/?)>/g;
  let depth = 0;
  let match = openTagPattern.exec(block);

  while (match) {
    const isClosing = Boolean(match[1]);
    const name = match[2];
    const isSelfClosing = Boolean(match[3]);

    if (isClosing) {
      depth = Math.max(0, depth - 1);
    } else {
      if (name === tagName && depth === 0) {
        const contentStart = openTagPattern.lastIndex;
        const closePattern = new RegExp(`<\\/${tagName}>`, "i");
        const closeMatch = closePattern.exec(block.slice(contentStart));
        if (!closeMatch) return null;
        return decodeXml(block.slice(contentStart, contentStart + closeMatch.index)).trim() || null;
      }
      if (!isSelfClosing) depth += 1;
    }

    match = openTagPattern.exec(block);
  }

  return null;
}

function extractBlocks(xml: string, tagName: string) {
  const blocks: string[] = [];
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "gi");
  let match = pattern.exec(xml);
  while (match) {
    blocks.push(match[1]);
    match = pattern.exec(xml);
  }
  return blocks;
}

function decodeXml(value: string) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&gt;/g, ">")
    .replace(/&lt;/g, "<")
    .replace(/&amp;/g, "&");
}
