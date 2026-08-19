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
    persistSalesRepLookup(input.response);
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

function persistSalesRepLookup(response: string) {
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
}

async function persistCustomers(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const customerBlocks = extractBlocks(response, "CustomerRet");
  for (const customerBlock of customerBlocks) {
    const listId = text(customerBlock, "ListID");
    const fullName = text(customerBlock, "FullName");
    if (!listId || !fullName) continue;

    const { error } = await supabase.from("quickbooks_customers").upsert(
      {
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
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "list_id" }
    );
    if (error) throw new Error(error.message);
  }
}

async function persistVendors(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const vendorBlocks = extractBlocks(response, "VendorRet");
  for (const vendorBlock of vendorBlocks) {
    const listId = directText(vendorBlock, "ListID");
    const name = directText(vendorBlock, "Name");
    const fullName = directText(vendorBlock, "FullName") || name;
    if (!listId || !name || !fullName) continue;

    const { error } = await supabase.from("quickbooks_vendors").upsert(
      {
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
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "list_id" }
    );
    if (error) throw new Error(error.message);
  }
}

async function persistItems(supabase: SupabaseClient, response: string, rawResponseId: string) {
  for (const itemType of itemRetTypes()) {
    const itemBlocks = extractBlocks(response, itemType);
    for (const itemBlock of itemBlocks) {
      const listId = text(itemBlock, "ListID");
      const fullName = text(itemBlock, "FullName");
      if (!listId || !fullName) continue;
      const itemCustomFields = customFields(itemBlock);

      const { error } = await supabase.from("quickbooks_items").upsert(
        {
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
          last_seen_at: new Date().toISOString()
        },
        { onConflict: "list_id" }
      );
      if (error) throw new Error(error.message);
    }
  }
}

async function persistInvoices(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const invoiceBlocks = extractBlocks(response, "InvoiceRet");
  for (const invoiceBlock of invoiceBlocks) {
    const txnId = text(invoiceBlock, "TxnID");
    if (!txnId) continue;

    const invoiceCustomFields = customFields(invoiceBlock);
    const customerRef = ref(invoiceBlock, "CustomerRef");
    const salesRepRef = ref(invoiceBlock, "SalesRepRef");
    const termsRef = ref(invoiceBlock, "TermsRef");
    const linkedTxns = extractBlocks(invoiceBlock, "LinkedTxn").map((block) => rawLinkedTxn(block));
    const lines = parseLines(invoiceBlock, "InvoiceLineRet");

    const { error } = await supabase.from("quickbooks_invoices").upsert(
      {
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
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "txn_id" }
    );
    if (error) throw new Error(error.message);

    await replaceLines(supabase, "quickbooks_invoice_lines", txnId, lines);
  }
}

async function persistCreditMemos(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const creditMemoBlocks = extractBlocks(response, "CreditMemoRet");
  for (const creditMemoBlock of creditMemoBlocks) {
    const txnId = text(creditMemoBlock, "TxnID");
    if (!txnId) continue;

    const creditMemoCustomFields = customFields(creditMemoBlock);
    const customerRef = ref(creditMemoBlock, "CustomerRef");
    const salesRepRef = ref(creditMemoBlock, "SalesRepRef");
    const linkedTxns = extractBlocks(creditMemoBlock, "LinkedTxn").map((block) => rawLinkedTxn(block));
    const lines = parseLines(creditMemoBlock, "CreditMemoLineRet");

    const { error } = await supabase.from("quickbooks_credit_memos").upsert(
      {
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
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "txn_id" }
    );
    if (error) throw new Error(error.message);

    await replaceLines(supabase, "quickbooks_credit_memo_lines", txnId, lines);
  }
}

async function persistReceivePayments(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const paymentBlocks = extractBlocks(response, "ReceivePaymentRet");
  for (const paymentBlock of paymentBlocks) {
    const txnId = text(paymentBlock, "TxnID");
    if (!txnId) continue;

    const customerRef = ref(paymentBlock, "CustomerRef");
    const { error } = await supabase.from("quickbooks_receive_payments").upsert(
      {
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
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "txn_id" }
    );
    if (error) throw new Error(error.message);
  }
}

async function persistPurchaseOrders(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const purchaseOrderBlocks = extractBlocks(response, "PurchaseOrderRet");
  for (const purchaseOrderBlock of purchaseOrderBlocks) {
    const txnId = text(purchaseOrderBlock, "TxnID");
    if (!txnId) continue;

    const purchaseOrderCustomFields = customFields(purchaseOrderBlock);
    const vendorRef = ref(purchaseOrderBlock, "VendorRef");
    const linkedTxns = extractBlocks(purchaseOrderBlock, "LinkedTxn").map((block) => rawLinkedTxn(block));
    const lines = parsePurchaseOrderLines(purchaseOrderBlock);

    const { error } = await supabase.from("quickbooks_purchase_orders").upsert(
      {
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
        last_seen_at: new Date().toISOString()
      },
      { onConflict: "txn_id" }
    );
    if (error) throw new Error(error.message);

    await replacePurchaseOrderLines(supabase, txnId, lines);
  }
}

async function replaceLines(supabase: SupabaseClient, table: string, txnId: string, lines: ParsedLine[]) {
  const { error: deleteError } = await supabase.from(table).delete().eq("txn_id", txnId);
  if (deleteError) throw new Error(deleteError.message);
  if (lines.length === 0) return;

  const { error: insertError } = await supabase.from(table).insert(
    lines.map((line) => ({
      txn_id: txnId,
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
    }))
  );
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

async function replacePurchaseOrderLines(supabase: SupabaseClient, txnId: string, lines: ParsedPurchaseOrderLine[]) {
  const { error: deleteError } = await supabase.from("quickbooks_purchase_order_lines").delete().eq("txn_id", txnId);
  if (deleteError) throw new Error(deleteError.message);
  if (lines.length === 0) return;

  const { error: insertError } = await supabase.from("quickbooks_purchase_order_lines").insert(
    lines.map((line) => ({
      txn_id: txnId,
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
    }))
  );
  if (insertError) throw new Error(insertError.message);
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
