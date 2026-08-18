import { createClient } from "@supabase/supabase-js";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const DEFAULT_FILE = path.resolve(process.cwd(), "../../vinosmith exports/vinosmith-btg-core-export-2026-08-18.csv");
const inputFile = path.resolve(process.cwd(), process.argv[2] || DEFAULT_FILE);

loadEnv(path.resolve(process.cwd(), "../../.env.local"));
loadEnv(path.resolve(process.cwd(), ".env.local"));

const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !serviceRoleKey) {
  throw new Error("Missing Supabase service-role configuration.");
}
if (!existsSync(inputFile)) {
  throw new Error(`Marker export not found: ${inputFile}`);
}

const supabase = createClient(url, serviceRoleKey, {
  auth: {
    autoRefreshToken: false,
    persistSession: false
  }
});

const rows = parseCsv(readFileSync(inputFile, "utf8"));
const header = rows[0]?.map(normalizeHeader) || [];
const records = rows.slice(1).map((row) => Object.fromEntries(header.map((key, index) => [key, row[index] || ""])));

const codeKey = pickHeader(header, ["code", "item_code", "item"]);
const nameKey = pickHeader(header, ["name", "product_name", "wine_name"]);
const coreKey = pickHeader(header, ["core", "core?"]);
const btgKey = pickHeader(header, ["btg", "btg?"]);

if (!codeKey || !coreKey || !btgKey) {
  throw new Error(`Expected columns Code, Core?, and BTG?. Found: ${rows[0]?.join(", ") || "none"}`);
}

const markerInputs = records
  .map((record) => ({
    item_code: normalizeCode(record[codeKey]),
    product_name: nameKey ? record[nameKey]?.trim() || null : null,
    is_core: yesValue(record[coreKey]),
    is_btg: yesValue(record[btgKey])
  }))
  .filter((record) => record.item_code && (record.is_core || record.is_btg));

const duplicateCodes = findDuplicates(markerInputs.map((record) => record.item_code));
const uniqueMarkers = new Map();
for (const marker of markerInputs) {
  const existing = uniqueMarkers.get(marker.item_code);
  uniqueMarkers.set(marker.item_code, existing ? {
    ...marker,
    is_core: existing.is_core || marker.is_core,
    is_btg: existing.is_btg || marker.is_btg,
    product_name: existing.product_name || marker.product_name
  } : marker);
}

const quickBooksItems = await fetchAll("quickbooks_items", "list_id,name,full_name,custom_fields", "list_id");
const quickBooksByCode = new Map();
for (const item of quickBooksItems) {
  const codes = uniqueTextValues([
    itemCodeFromQuickBooks(item),
    item.name,
    item.full_name
  ]);
  for (const code of codes) {
    if (!quickBooksByCode.has(code)) quickBooksByCode.set(code, item);
  }
}

const now = new Date().toISOString();
const upsertRows = Array.from(uniqueMarkers.values()).map((marker) => {
  const quickBooksItem = quickBooksByCode.get(marker.item_code) || null;
  return {
    item_code: marker.item_code,
    quickbooks_item_list_id: quickBooksItem?.list_id || null,
    is_btg: marker.is_btg,
    is_core: marker.is_core,
    marker_note: `Initial Vinosmith marker import${marker.product_name ? `: ${marker.product_name}` : ""}`,
    note_source: "initial_upload",
    updated_at: now
  };
});

for (let index = 0; index < upsertRows.length; index += 500) {
  const chunk = upsertRows.slice(index, index + 500);
  const { error } = await supabase.from("ordering_item_markers").upsert(chunk, { onConflict: "item_code" });
  if (error) throw new Error(error.message);
}

const matchedQuickBooksRows = upsertRows.filter((row) => row.quickbooks_item_list_id).length;
const missingQuickBooksRows = upsertRows.filter((row) => !row.quickbooks_item_list_id);

console.log(JSON.stringify({
  file: inputFile,
  csvRows: records.length,
  markerRows: upsertRows.length,
  duplicateCodes: duplicateCodes.length,
  matchedQuickBooksRows,
  missingQuickBooksRows: missingQuickBooksRows.length,
  missingQuickBooksExamples: missingQuickBooksRows.slice(0, 12).map((row) => row.item_code)
}, null, 2));

function loadEnv(filePath) {
  if (!existsSync(filePath)) return;
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=/);
    if (!match || process.env[match[1]]) continue;
    process.env[match[1]] = line.slice(match[1].length + 1).replace(/^['"]|['"]$/g, "");
  }
}

async function fetchAll(table, columns, orderBy) {
  const result = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase
      .from(table)
      .select(columns)
      .order(orderBy, { ascending: true })
      .range(from, from + 999);
    if (error) throw new Error(error.message);
    result.push(...(data || []));
    if (!data || data.length < 1000) break;
  }
  return result;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;
  const cleanText = text.replace(/^\uFEFF/, "");

  for (let index = 0; index < cleanText.length; index += 1) {
    const char = cleanText[index];
    const next = cleanText[index + 1];

    if (char === '"' && inQuotes && next === '"') {
      field += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      inQuotes = !inQuotes;
      continue;
    }
    if (char === "," && !inQuotes) {
      row.push(field);
      field = "";
      continue;
    }
    if ((char === "\n" || char === "\r") && !inQuotes) {
      if (char === "\r" && next === "\n") index += 1;
      row.push(field);
      if (row.some((value) => value.trim())) rows.push(row);
      row = [];
      field = "";
      continue;
    }
    field += char;
  }

  row.push(field);
  if (row.some((value) => value.trim())) rows.push(row);
  return rows;
}

function normalizeHeader(value) {
  return String(value || "").trim().toLowerCase().replace(/\?$/, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function pickHeader(headers, candidates) {
  const normalizedCandidates = candidates.map(normalizeHeader);
  return headers.find((header) => normalizedCandidates.includes(header)) || "";
}

function yesValue(value) {
  return ["yes", "y", "true", "1", "x"].includes(String(value || "").trim().toLowerCase());
}

function normalizeCode(value) {
  return String(value || "").trim().toUpperCase();
}

function uniqueTextValues(values) {
  return Array.from(new Set(values.map(normalizeCode).filter(Boolean)));
}

function itemCodeFromQuickBooks(item) {
  return textFromCustomFields(item.custom_fields, [
    "item_number",
    "itemNumber",
    "ItemNumber",
    "sku",
    "SKU",
    "product_code",
    "productCode",
    "ProductCode"
  ]) || item.name || item.full_name || item.list_id;
}

function textFromCustomFields(value, keys) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const fields = value;
  const normalized = new Map(Object.entries(fields).map(([key, fieldValue]) => [normalizeHeader(key), fieldValue]));

  for (const key of keys) {
    const direct = fields[key] ?? normalized.get(normalizeHeader(key));
    const text = textFromCustomFieldValue(direct);
    if (text) return text;
  }

  return "";
}

function textFromCustomFieldValue(value) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const text = value.value ?? value.Value ?? value.text ?? value.Text ?? value.DataExtValue;
    if (typeof text === "string" && text.trim()) return text.trim();
    if (typeof text === "number" && Number.isFinite(text)) return String(text);
  }
  return "";
}

function findDuplicates(values) {
  const seen = new Set();
  const duplicates = new Set();
  for (const value of values) {
    if (seen.has(value)) duplicates.add(value);
    seen.add(value);
  }
  return Array.from(duplicates);
}
