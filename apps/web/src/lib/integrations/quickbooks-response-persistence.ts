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

export async function persistQuickBooksResponse(input: PersistQuickBooksResponseInput) {
  if (!shouldPersistRequest(input.request.requestType)) return;

  let supabase: SupabaseClient;
  try {
    supabase = createServiceRoleClient();
  } catch {
    return;
  }

  const rawResponse = await recordRawResponse(supabase, input);
  if (input.request.requestType === "InvoiceQueryRq") {
    await persistInvoices(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "CreditMemoQueryRq") {
    await persistCreditMemos(supabase, input.response, rawResponse.id);
  } else if (input.request.requestType === "ReceivePaymentQueryRq") {
    await persistReceivePayments(supabase, input.response, rawResponse.id);
  }
}

function shouldPersistRequest(requestType: string) {
  return ["InvoiceQueryRq", "CreditMemoQueryRq", "ReceivePaymentQueryRq"].includes(requestType);
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

async function persistInvoices(supabase: SupabaseClient, response: string, rawResponseId: string) {
  const invoiceBlocks = extractBlocks(response, "InvoiceRet");
  for (const invoiceBlock of invoiceBlocks) {
    const txnId = text(invoiceBlock, "TxnID");
    if (!txnId) continue;

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
        sales_rep_ref: salesRepRef,
        subtotal: numberText(invoiceBlock, "Subtotal"),
        total_amount: numberText(invoiceBlock, "TotalAmount"),
        balance_remaining: numberText(invoiceBlock, "BalanceRemaining"),
        is_paid: boolText(invoiceBlock, "IsPaid"),
        is_pending: boolText(invoiceBlock, "IsPending"),
        linked_txns: linkedTxns,
        time_created: dateTimeText(invoiceBlock, "TimeCreated"),
        time_modified: dateTimeText(invoiceBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: {
          customer_ref: customerRef,
          sales_rep_ref: salesRepRef,
          line_count: lines.length
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
        custom_fields: {},
        time_created: dateTimeText(creditMemoBlock, "TimeCreated"),
        time_modified: dateTimeText(creditMemoBlock, "TimeModified"),
        raw_response_id: rawResponseId,
        raw_data: {
          customer_ref: customerRef,
          sales_rep_ref: salesRepRef,
          line_count: lines.length
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
  return extractBlocks(parentBlock, lineTag).map((lineBlock, index): ParsedLine => {
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
  });
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
  if (requestType === "InvoiceQueryRq") return extractBlocks(response, "InvoiceRet").length;
  if (requestType === "CreditMemoQueryRq") return extractBlocks(response, "CreditMemoRet").length;
  if (requestType === "ReceivePaymentQueryRq") return extractBlocks(response, "ReceivePaymentRet").length;
  return null;
}

function ref(block: string, tagName: string): QbRef {
  const refBlock = firstBlock(block, tagName);
  if (!refBlock) return {};
  return {
    ListID: text(refBlock, "ListID"),
    FullName: text(refBlock, "FullName")
  };
}

function text(block: string, tagName: string) {
  const pattern = new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i");
  const match = pattern.exec(block);
  return match ? decodeXml(match[1]).trim() || null : null;
}

function numberText(block: string, tagName: string) {
  const value = text(block, tagName);
  if (!value) return null;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function boolText(block: string, tagName: string) {
  const value = text(block, tagName);
  if (!value) return null;
  if (/^true$/i.test(value)) return true;
  if (/^false$/i.test(value)) return false;
  return null;
}

function dateText(block: string, tagName: string) {
  const value = text(block, tagName);
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function dateTimeText(block: string, tagName: string) {
  const value = text(block, tagName);
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function firstBlock(block: string, tagName: string) {
  return extractBlocks(block, tagName)[0] || null;
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
