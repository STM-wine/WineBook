import {
  buildDisplayName,
  money,
  normalizePackFormat,
  normalizeSpaces,
  normalizeVintage
} from "@/lib/supplier-catalog";
import type {
  SupplierOfferCanonicalField,
  SupplierOfferCandidateDraft,
  SupplierOfferExtractedFieldDraft,
  SupplierOfferExtractedRowDraft
} from "./types";
import { clampConfidence } from "./evidence";


const TRAILING_VINTAGE_RE = /(?:^|\s)((?:19|20)\d{2}|NV|N\/V)\s*$/i;

function splitTrailingVintage(value: unknown) {
  const text = normalizeSpaces(value);
  const match = text.match(TRAILING_VINTAGE_RE);
  if (!match) return { wineName: text, vintage: null };
  const vintage = normalizeVintage(match[1]);
  return { wineName: normalizeSpaces(text.slice(0, match.index).trim()), vintage };
}

const HEADER_ALIASES: Record<SupplierOfferCanonicalField, string[]> = {
  producer: ["producer", "winery", "estate", "domaine", "chateau", "brand"],
  wine_name: ["wine", "wine name", "item", "description", "cuvee", "fantasy name"],
  vintage: ["vintage", "vint", "year"],
  appellation: ["appellation", "ava", "aoc", "doc", "dop"],
  region: ["region"],
  country: ["country"],
  grape: ["grape", "varietal", "variety"],
  bottle_size: ["bottle size", "size", "format"],
  pack_size: ["pack", "pack size", "case pack", "unit set", "units per case"],
  fob: ["fob", "cost", "bottle cost", "price", "net price"],
  wholesale_price: ["wholesale", "wholesale price", "ws"],
  srp: ["srp", "retail", "suggested retail"],
  quantity: ["quantity", "qty", "available", "availability", "cases"],
  arrival_date: ["arrival", "eta", "arrival date", "available date"],
  allocation_limit: ["allocation", "limit", "allocated"],
  minimum_order: ["minimum", "min order", "moq"],
  discount: ["discount", "deal", "allowance"],
  deal_terms: ["terms", "deal terms", "program"],
  notes: ["notes", "supplier notes", "comments"],
  organic_biodynamic_notes: ["organic", "biodynamic", "sustainable"]
};

export function normalizeHeader(value: unknown) {
  return normalizeSpaces(value)
    .toLowerCase()
    .replace(/[_-]+/g, " ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function canonicalFieldForHeader(header: unknown): { field: SupplierOfferCanonicalField | null; confidence: number } {
  const normalized = normalizeHeader(header);
  if (!normalized) return { field: null, confidence: 0 };

  let best: { field: SupplierOfferCanonicalField | null; confidence: number } = { field: null, confidence: 0 };
  for (const [field, aliases] of Object.entries(HEADER_ALIASES) as Array<[SupplierOfferCanonicalField, string[]]>) {
    for (const alias of aliases) {
      const normalizedAlias = normalizeHeader(alias);
      const confidence =
        normalized === normalizedAlias
          ? 0.98
          : normalized.includes(normalizedAlias) || normalizedAlias.includes(normalized)
            ? 0.78
            : 0;
      if (confidence > best.confidence) {
        best = { field, confidence };
      }
    }
  }

  return best;
}

export function normalizeFieldValue(field: SupplierOfferCanonicalField, value: unknown) {
  const text = normalizeSpaces(value);
  if (!text) return "";

  if (field === "vintage") return normalizeVintage(text);
  if (field === "pack_size") return String(Math.max(1, Math.trunc(Number(text) || 0)) || "");
  if (field === "bottle_size") return normalizePackFormat(1, text).replace(/^1\//, "");
  if (field === "fob" || field === "wholesale_price" || field === "srp") return String(money(text.replace(/[$,]/g, "")));
  if (field === "quantity") return String(Number(text.replace(/[,]/g, "")) || "");

  return text;
}

export function rowToCandidate(input: {
  supplierId?: string | null;
  supplierName: string;
  documentType: SupplierOfferCandidateDraft["documentType"];
  row: SupplierOfferExtractedRowDraft;
}): SupplierOfferCandidateDraft {
  const valueByField = new Map<SupplierOfferCanonicalField, SupplierOfferExtractedFieldDraft>();
  for (const field of input.row.fields) {
    const existing = valueByField.get(field.canonicalField);
    if (!existing || field.confidence > existing.confidence) {
      valueByField.set(field.canonicalField, field);
    }
  }

  function text(field: SupplierOfferCanonicalField) {
    return valueByField.get(field)?.normalizedValue || valueByField.get(field)?.originalValue || null;
  }

  function number(field: SupplierOfferCanonicalField) {
    const parsed = Number(text(field));
    return Number.isFinite(parsed) ? parsed : null;
  }

  const wineNameValue = text("wine_name");
  const vintageValue = text("vintage");
  const splitWine = splitTrailingVintage(wineNameValue);
  const normalizedWineName = splitWine.wineName || wineNameValue;
  const normalizedVintage = vintageValue || splitWine.vintage || "NV";

  const tierOneConfidence: Array<[SupplierOfferCanonicalField, number]> = [
    ["wine_name", 0.24],
    ["vintage", 0.16],
    ["pack_size", 0.14],
    ["bottle_size", 0.14],
    ["fob", 0.18],
    ["quantity", 0.14]
  ];
  const confidenceScore = tierOneConfidence.reduce((sum, [field, weight]) => {
    const extracted = valueByField.get(field)?.confidence;
    if (field === "vintage" && !extracted && splitWine.vintage) return sum + weight * 0.92;
    if (field === "pack_size" && !extracted && number("pack_size")) return sum + weight * 0.72;
    if (field === "bottle_size" && !extracted && text("bottle_size")) return sum + weight * 0.72;
    return sum + weight * (extracted ?? 0);
  }, 0);
  const overallConfidence = clampConfidence(confidenceScore);

  return {
    supplierId: input.supplierId || null,
    supplierName: normalizeSpaces(input.supplierName),
    documentType: input.documentType,
    producer: text("producer"),
    wineName: normalizedWineName,
    vintage: normalizedVintage,
    appellation: text("appellation"),
    region: text("region"),
    country: text("country"),
    grape: text("grape"),
    bottleSize: text("bottle_size") || "750ml",
    packSize: number("pack_size") || 12,
    fob: number("fob"),
    wholesalePrice: number("wholesale_price"),
    srp: number("srp"),
    quantity: number("quantity"),
    arrivalDate: text("arrival_date"),
    allocationLimit: text("allocation_limit"),
    minimumOrder: text("minimum_order"),
    discount: text("discount"),
    dealTerms: text("deal_terms"),
    notes: text("notes"),
    overallConfidence,
    fields: input.row.fields,
    metadata: {
      displayName: buildDisplayName({
        producer: text("producer") || "",
        wineName: normalizedWineName || "",
        vintage: normalizedVintage,
        packSize: number("pack_size") || 12,
        bottleSize: text("bottle_size") || "750ml"
      }),
      originalWineName: wineNameValue,
      vintageExtractedFromWineName: !vintageValue && Boolean(splitWine.vintage)
    }
  };
}

