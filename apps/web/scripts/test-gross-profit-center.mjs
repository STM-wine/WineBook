import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import test from "node:test";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB_ROOT = resolve(ROOT, "apps/web");
const SOURCE_FILE = resolve(WEB_ROOT, "src/lib/supabase/gross-profit-center.ts");
const BUILD_DIR = resolve(ROOT, "tmp/gross-profit-center-test-build");

await mkdir(BUILD_DIR, { recursive: true });
const source = await readFile(SOURCE_FILE, "utf8");
const compiled = ts.transpileModule(source.replace(/^import "server-only";\n/, ""), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022
  },
  fileName: SOURCE_FILE
});
const compiledPath = resolve(BUILD_DIR, "gross-profit-center.mjs");
await writeFile(compiledPath, compiled.outputText);

const { buildGrossProfitWorkflowProof } = await import(pathToFileURL(compiledPath).href);

test("Gross Profit Center signs credits and applies confidence buckets", async () => {
  const proof = await buildGrossProfitWorkflowProof(fakeSupabase(fixtureTables()), "2026-01-01", "2026-01-31", {
    includeLines: true,
    lineLimit: 20
  });
  const invoiceLinesByItem = new Map(
    proof.lines.filter((line) => line.transactionType === "invoice").map((line) => [line.itemFullName, line])
  );

  const exactBillback = invoiceLinesByItem.get("SKU-EXACT");
  assert.equal(exactBillback.transactionType, "invoice");
  assert.equal(exactBillback.confidenceBucket, "qb_price_qb_cost_vinosmith_price_id_billback");
  assert.equal(exactBillback.vinosmithBillbackAmount, 12);
  assert.equal(exactBillback.effectiveCost, 48);
  assert.equal(exactBillback.grossProfit, 72);

  const manual = invoiceLinesByItem.get("SKU-MANUAL");
  assert.equal(manual.confidenceBucket, "qb_price_qb_cost_manual_no_billback");
  assert.equal(manual.vinosmithBillbackAmount, 0);

  const sample = invoiceLinesByItem.get("SKU-SAMPLE");
  assert.equal(sample.confidenceBucket, "sample_zero_dollar_or_100_discount");
  assert.equal(sample.qbGrossSales, 0);

  const fallback = invoiceLinesByItem.get("SKU-FALLBACK");
  assert.equal(fallback.confidenceBucket, "qb_price_qb_cost_vinosmith_unique_label_current_price_billback");
  assert.equal(fallback.vinosmithBillbackAmount, 4);

  const credit = proof.lines.find((line) => line.transactionType === "credit_memo");
  assert.equal(credit.itemFullName, "SKU-EXACT");
  assert.equal(credit.linkedInvoiceRefNumber, "INV-1");
  assert.equal(credit.qbGrossSales, -20);
  assert.equal(credit.quantity, -2);
  assert.equal(credit.vinosmithBillbackAmount, -4);
  assert.equal(credit.effectiveCost, -16);
  assert.equal(credit.grossProfit, -4);
});

function fixtureTables() {
  return {
    quickbooks_invoices: [
      {
        txn_id: "invoice-1",
        ref_number: "INV-1",
        txn_date: "2026-01-15",
        ship_date: "2026-01-16",
        customer_list_id: "customer-1",
        customer_full_name: "Test Account",
        sales_rep_ref: { FullName: "SA" }
      }
    ],
    quickbooks_credit_memos: [
      {
        txn_id: "credit-1",
        ref_number: "CM-1",
        txn_date: "2026-01-20",
        customer_list_id: "customer-1",
        customer_full_name: "Test Account",
        linked_txns: [{ TxnID: "invoice-1", TxnType: "Invoice", RefNumber: "INV-1" }],
        raw_data: { sales_rep_ref: { FullName: "SA" } }
      }
    ],
    quickbooks_invoice_lines: [
      qbLine("invoice-1", 1, "SKU-EXACT", 6, 20, 120),
      qbLine("invoice-1", 2, "SKU-MANUAL", 1, 25, 25),
      qbLine("invoice-1", 3, "SKU-SAMPLE", 1, 0, 0),
      qbLine("invoice-1", 4, "SKU-FALLBACK", 2, 30, 60)
    ],
    quickbooks_credit_memo_lines: [qbLine("credit-1", 1, "SKU-EXACT", 2, 10, 20)],
    quickbooks_items: [
      qbItem("item-SKU-EXACT", "SKU-EXACT", 10),
      qbItem("item-SKU-MANUAL", "SKU-MANUAL", 15),
      qbItem("item-SKU-SAMPLE", "SKU-SAMPLE", 8),
      qbItem("item-SKU-FALLBACK", "SKU-FALLBACK", 18)
    ],
    vinosmith_order_headers: [
      {
        supplier_order_id: "order-1",
        invoice_number: "INV-1",
        account_name: "Test Account",
        delivery_at: "2026-01-16T12:00:00"
      }
    ],
    vinosmith_order_lines: [
      vinoLine("line-1", "SKU-EXACT", "wine-1", 6, 2000, 12000, "price-1", "Frontline", false, 0),
      vinoLine("line-1-credit", "SKU-EXACT", "wine-1", 2, 1000, 2000, "price-1", "Frontline", false, 0),
      vinoLine("line-2", "SKU-MANUAL", "wine-2", 1, 2500, 2500, null, "Frontline", true, 0),
      vinoLine("line-3", "SKU-SAMPLE", "wine-3", 1, 0, 0, null, "Sample", false, 100),
      vinoLine("line-4", "SKU-FALLBACK", "wine-4", 2, 3000, 6000, null, "Frontline", false, 0)
    ],
    vinosmith_prices: [
      price("price-1", "wine-1", "Frontline", 2000, 200),
      price("price-4", "wine-4", "Frontline", 3200, 200)
    ]
  };
}

function qbLine(txnId, sequence, item, quantity, rate, amount) {
  return {
    id: `${txnId}-line-${sequence}`,
    txn_id: txnId,
    txn_line_id: `${txnId}-line-${sequence}`,
    line_sequence: sequence,
    item_list_id: `item-${item}`,
    item_full_name: item,
    description: item,
    quantity,
    rate,
    amount
  };
}

function qbItem(listId, fullName, purchaseCost) {
  return {
    list_id: listId,
    full_name: fullName,
    purchase_cost: purchaseCost,
    average_cost: null,
    sales_price: null
  };
}

function vinoLine(lineId, code, wineId, quantity, priceCents, totalCents, priceId, label, manualPrice, discount) {
  return {
    line_item_id: lineId,
    supplier_order_id: "order-1",
    wine_id: wineId,
    wine_code: code,
    wine_name: code,
    quantity_bottles: quantity,
    price_cents: priceCents,
    price_id: priceId,
    price_label: label,
    total_cents: totalCents,
    discount,
    manual_price: manualPrice
  };
}

function price(priceId, wineId, label, priceCents, billBackPriceCents) {
  return {
    price_id: priceId,
    wine_id: wineId,
    label,
    price_cents: priceCents,
    bill_back_price_cents: billBackPriceCents,
    active: true,
    disabled: false
  };
}

function fakeSupabase(tables) {
  return {
    from(tableName) {
      return new FakeQuery(tables[tableName] || []);
    }
  };
}

class FakeQuery {
  constructor(rows) {
    this.rows = rows;
    this.filters = [];
    this.slice = null;
  }

  select() {
    return this;
  }

  gte(field, value) {
    this.filters.push((row) => String(row[field] || "") >= value);
    return this;
  }

  lte(field, value) {
    this.filters.push((row) => String(row[field] || "") <= value);
    return this;
  }

  in(field, values) {
    const lookup = new Set(values);
    this.filters.push((row) => lookup.has(row[field]));
    return this;
  }

  order() {
    return this;
  }

  range(from, to) {
    this.slice = [from, to];
    return this;
  }

  returns() {
    let data = this.rows.filter((row) => this.filters.every((filter) => filter(row)));
    if (this.slice) data = data.slice(this.slice[0], this.slice[1] + 1);
    return Promise.resolve({ data, error: null });
  }
}
