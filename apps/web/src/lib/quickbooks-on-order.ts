import { asNumber } from "./order-data";
import type { Recommendation } from "./types";

export type QuickBooksOnOrderItem = {
  list_id: string;
  name: string | null;
  full_name: string | null;
  is_active: boolean | null;
  item_type?: string | null;
  quantity_on_order: number | string | null;
  custom_fields: Record<string, unknown> | null;
};

export function applyQuickBooksOnOrderToRecommendations(
  recommendations: Recommendation[],
  quickBooksItems: QuickBooksOnOrderItem[]
): Recommendation[] {
  const quickBooksItemsByCode = new Map<string, QuickBooksOnOrderItem>();

  for (const item of quickBooksItems) {
    const itemCode = normalizeCode(itemCodeFromQuickBooks(item));
    if (!isLikelyProductItemCode(itemCode) || item.is_active === false) continue;
    if (!quickBooksItemsByCode.has(itemCode)) {
      quickBooksItemsByCode.set(itemCode, item);
    }
  }

  if (quickBooksItemsByCode.size === 0) return recommendations;

  return recommendations.map((row) => {
    const itemCode = normalizeCode(row.product_code);
    const quickBooksItem = itemCode ? quickBooksItemsByCode.get(itemCode) : null;
    if (!quickBooksItem) return row;

    const onOrder = Math.max(0, asNumber(quickBooksItem.quantity_on_order));
    const weeklyVelocity = asNumber(row.weekly_velocity);
    const weeksOnHandWithOnOrder =
      weeklyVelocity > 0 ? roundNumber((asNumber(row.true_available) + onOrder) / weeklyVelocity, 2) : null;

    return {
      ...row,
      on_order: onOrder,
      weeks_on_hand_with_on_order: weeksOnHandWithOnOrder
    };
  });
}

function itemCodeFromQuickBooks(item: QuickBooksOnOrderItem) {
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

function textFromCustomFields(value: unknown, keys: string[]) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  const fields = value as Record<string, unknown>;
  const normalized = new Map<string, unknown>();
  for (const [key, fieldValue] of Object.entries(fields)) {
    normalized.set(normalizeCustomFieldKey(key), fieldValue);
  }

  for (const key of keys) {
    const direct = fields[key] ?? normalized.get(normalizeCustomFieldKey(key));
    const text = textFromCustomFieldValue(direct);
    if (text) return text;
  }

  return "";
}

function textFromCustomFieldValue(value: unknown) {
  if (typeof value === "string" && value.trim()) return value.trim();
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const nested = value as Record<string, unknown>;
    const text = nested.value ?? nested.Value ?? nested.text ?? nested.Text ?? nested.DataExtValue;
    if (typeof text === "string" && text.trim()) return text.trim();
    if (typeof text === "number" && Number.isFinite(text)) return String(text);
  }
  return "";
}

function normalizeCode(value: unknown) {
  return String(value || "").trim().toUpperCase();
}

function normalizeCustomFieldKey(value: string) {
  return value.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
}

function isLikelyProductItemCode(value: string) {
  return /^[A-Z]{2,}\d{5,6}$/i.test(value.trim());
}

function roundNumber(value: number, digits: number) {
  const multiplier = 10 ** digits;
  return Math.round(value * multiplier) / multiplier;
}
