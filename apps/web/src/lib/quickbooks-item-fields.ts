export type QuickBooksItemIdentityRow = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  sales_desc?: string | null;
  purchase_desc?: string | null;
  custom_fields?: Record<string, unknown> | null;
  raw_data?: Record<string, unknown> | null;
};

export function quickBooksItemCode(item: QuickBooksItemIdentityRow) {
  return customFieldText(item.custom_fields, ["item_number", "itemNumber", "ItemNumber", "sku", "SKU", "product_code", "productCode", "ProductCode"])
    || item.name?.trim()
    || item.full_name?.trim()
    || item.list_id;
}

export function quickBooksItemDisplayName(item: QuickBooksItemIdentityRow) {
  return (item.sales_desc?.trim() || item.purchase_desc?.trim() || item.full_name?.trim() || item.name?.trim() || item.list_id)
    .replace(/\s*\.{2,}\s*$/, "")
    .trim();
}

export function quickBooksPreferredVendorListId(item: QuickBooksItemIdentityRow) {
  const rawData = item.raw_data;
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return null;
  const reference = rawData.preferred_vendor_ref ?? rawData.pref_vendor_ref ?? rawData.PrefVendorRef;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return null;
  const record = reference as Record<string, unknown>;
  return textValue(record.ListID ?? record.list_id ?? record.value);
}

export function quickBooksProducer(item: QuickBooksItemIdentityRow) {
  return customFieldText(item.custom_fields, ["producer", "Producer"]);
}

export function quickBooksImporter(item: QuickBooksItemIdentityRow) {
  const customImporter = customFieldText(item.custom_fields, ["importer", "Importer", "supplier", "Supplier", "preferred_vendor", "Preferred Vendor"]);
  if (customImporter) return customImporter;
  const rawData = item.raw_data;
  if (!rawData || typeof rawData !== "object" || Array.isArray(rawData)) return "";
  const reference = rawData.preferred_vendor_ref ?? rawData.pref_vendor_ref ?? rawData.PrefVendorRef;
  if (!reference || typeof reference !== "object" || Array.isArray(reference)) return "";
  const record = reference as Record<string, unknown>;
  return textValue(record.FullName ?? record.full_name ?? record.name) || "";
}

export function quickBooksVintage(item: QuickBooksItemIdentityRow) {
  return customFieldText(item.custom_fields, ["vintage", "Vintage"])
    || quickBooksItemDisplayName(item).match(/\b(?:19|20)\d{2}\b/)?.[0]
    || "NV";
}

export function quickBooksPackFormat(item: QuickBooksItemIdentityRow) {
  const value = customFieldText(item.custom_fields, ["pack_size", "Pack Size", "packSize"])
    || quickBooksItemDisplayName(item);
  const match = value.match(/(?:^|\D)(\d{1,3})\s*\/\s*(\d+(?:\.\d+)?)\s*(ml|l)?\b/i);
  if (!match) return { packSize: 1, bottleSize: "750ml", label: "1/750ml" };

  const packSize = Math.max(1, Math.min(120, Number(match[1]) || 1));
  const amount = match[2];
  const unit = match[3]?.toLowerCase() || (Number(amount) <= 6 ? "l" : "ml");
  const bottleSize = `${amount}${unit}`;
  return { packSize, bottleSize, label: `${packSize}/${bottleSize}` };
}

export function isLikelyQuickBooksWineItem(item: QuickBooksItemIdentityRow) {
  return /^[A-Z]{2,}\d{5,6}$/i.test(quickBooksItemCode(item));
}

function customFieldText(fields: Record<string, unknown> | null | undefined, keys: string[]) {
  if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "";
  const normalized = new Map(Object.entries(fields).map(([key, value]) => [normalizeKey(key), value]));
  for (const key of keys) {
    const value = fields[key] ?? normalized.get(normalizeKey(key));
    const text = customFieldValue(value);
    if (text) return text;
  }
  return "";
}

function customFieldValue(value: unknown) {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const record = value as Record<string, unknown>;
  return textValue(record.value ?? record.Value ?? record.text ?? record.Text ?? record.DataExtValue) || "";
}

function textValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeKey(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}
