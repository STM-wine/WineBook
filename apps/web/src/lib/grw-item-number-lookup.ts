export type GrwInvoiceLineForLookup = {
  itemNumber?: string | null;
  description?: string | null;
  wineName?: string | null;
  vintage?: string | null;
  pack?: number | null;
  bottleSize?: string | null;
  [key: string]: unknown;
};

export type GrwQuickBooksItemForLookup = {
  name?: string | null;
  sales_desc?: string | null;
  purchase_desc?: string | null;
  is_active?: boolean | null;
  time_modified?: string | null;
};

type ParsedDescription = {
  name: string;
  vintage: string | null;
  packSize: number | null;
  bottleMl: number | null;
};

type ScoredMatch = {
  itemNumber: string;
  score: number;
  exactName: boolean;
  active: boolean;
  modifiedAt: string;
};

const GRW_ITEM_NUMBER = /^GRW\d+$/i;
const VINTAGE = /\b((?:19|20)\d{2}|N\/?V)\b/i;
const PACK = /\b(\d+)\s*[x/]\s*(\d+(?:\.\d+)?)\s*(ml|l)\b/i;
const MINIMUM_NAME_SCORE = 0.9;

export function applyGrwItemNumberMatches<T extends GrwInvoiceLineForLookup>(
  invoiceItems: T[],
  quickBooksItems: GrwQuickBooksItemForLookup[]
): T[] {
  return invoiceItems.map((item) => ({
    ...item,
    itemNumber: findGrwItemNumber(item, quickBooksItems) || "NEW"
  }));
}

export function findGrwItemNumber(
  invoiceItem: GrwInvoiceLineForLookup,
  quickBooksItems: GrwQuickBooksItemForLookup[]
): string | null {
  const invoiceIdentity = invoiceDescriptionIdentity(invoiceItem);
  if (!invoiceIdentity.name) return null;

  const matches = quickBooksItems
    .flatMap((candidate) => scoreCandidate(invoiceIdentity, candidate))
    .sort((left, right) =>
      right.score - left.score ||
      Number(right.exactName) - Number(left.exactName) ||
      Number(right.active) - Number(left.active) ||
      right.modifiedAt.localeCompare(left.modifiedAt) ||
      left.itemNumber.localeCompare(right.itemNumber)
    );

  const best = matches[0];
  return best && best.score >= MINIMUM_NAME_SCORE ? best.itemNumber : null;
}

function scoreCandidate(
  invoice: ParsedDescription,
  candidate: GrwQuickBooksItemForLookup
): ScoredMatch[] {
  const itemNumber = String(candidate.name || "").trim().toUpperCase();
  if (!GRW_ITEM_NUMBER.test(itemNumber)) return [];

  const descriptions = Array.from(new Set([candidate.sales_desc, candidate.purchase_desc]
    .map((value) => String(value || "").trim())
    .filter(Boolean)));

  return descriptions.flatMap((description) => {
    const identity = parseDescription(description);
    if (!identity.name || identityMismatch(invoice, identity)) return [];

    return [{
      itemNumber,
      score: nameSimilarity(invoice.name, identity.name),
      exactName: invoice.name === identity.name,
      active: candidate.is_active !== false,
      modifiedAt: String(candidate.time_modified || "")
    }];
  });
}

function invoiceDescriptionIdentity(item: GrwInvoiceLineForLookup): ParsedDescription {
  const identity = parseDescription(String(item.description || item.wineName || ""));
  const explicitVintage = normalizeVintage(item.vintage);
  const explicitPack = positiveInteger(item.pack);
  const explicitBottle = normalizeBottleSize(item.bottleSize);

  return {
    ...identity,
    vintage: explicitVintage || identity.vintage,
    packSize: explicitPack || identity.packSize,
    bottleMl: explicitBottle || identity.bottleMl
  };
}

function parseDescription(value: string): ParsedDescription {
  const vintageMatch = value.match(VINTAGE);
  const packMatch = value.match(PACK);
  const vintage = normalizeVintage(vintageMatch?.[1]);
  const packSize = positiveInteger(packMatch?.[1]);
  const bottleMl = packMatch ? bottleSizeToMl(packMatch[2], packMatch[3]) : null;
  const name = normalizeName(value.replace(VINTAGE, " ").replace(PACK, " "));

  return { name, vintage, packSize, bottleMl };
}

function identityMismatch(invoice: ParsedDescription, candidate: ParsedDescription) {
  if (invoice.vintage && candidate.vintage !== invoice.vintage) return true;
  if (invoice.packSize && candidate.packSize && invoice.packSize !== candidate.packSize) return true;
  if (invoice.bottleMl && candidate.bottleMl && invoice.bottleMl !== candidate.bottleMl) return true;
  return false;
}

function nameSimilarity(left: string, right: string) {
  if (left === right) return 1;
  if (left.includes(right) || right.includes(left)) return 0.97;

  const editSimilarity = 1 - levenshteinDistance(left, right) / Math.max(left.length, right.length, 1);
  const tokenSimilarity = fuzzyTokenSimilarity(left.split(" "), right.split(" "));
  return Math.max(editSimilarity, tokenSimilarity * 0.97);
}

function fuzzyTokenSimilarity(left: string[], right: string[]) {
  if (left.length === 0 || right.length === 0) return 0;

  const unused = new Set(right.map((_, index) => index));
  let matched = 0;
  for (const leftToken of left) {
    let bestIndex = -1;
    let bestScore = 0;
    for (const rightIndex of unused) {
      const score = tokenMatchScore(leftToken, right[rightIndex]);
      if (score > bestScore) {
        bestScore = score;
        bestIndex = rightIndex;
      }
    }
    if (bestIndex >= 0 && bestScore >= 0.85) {
      matched += bestScore;
      unused.delete(bestIndex);
    }
  }

  const precision = matched / right.length;
  const recall = matched / left.length;
  return precision + recall === 0 ? 0 : (2 * precision * recall) / (precision + recall);
}

function tokenMatchScore(left: string, right: string) {
  if (left === right) return 1;
  if (Math.min(left.length, right.length) < 5) return 0;
  const distance = levenshteinDistance(left, right);
  return distance <= 1 ? 0.9 : 0;
}

function levenshteinDistance(left: string, right: string) {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index);
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex];
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      const substitutionCost = left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1;
      current[rightIndex] = Math.min(
        current[rightIndex - 1] + 1,
        previous[rightIndex] + 1,
        previous[rightIndex - 1] + substitutionCost
      );
    }
    previous.splice(0, previous.length, ...current);
  }
  return previous[right.length];
}

function normalizeName(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function normalizeVintage(value: unknown) {
  const normalized = String(value || "").trim().toUpperCase().replace("/", "");
  if (/^(?:19|20)\d{2}$/.test(normalized)) return normalized;
  return normalized === "NV" ? "NV" : null;
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeBottleSize(value: unknown) {
  const normalized = String(value || "").trim().toLowerCase();
  const match = normalized.match(/^(\d+(?:\.\d+)?)\s*(ml|l)?$/);
  if (!match) return null;
  return bottleSizeToMl(match[1], match[2] || "ml");
}

function bottleSizeToMl(value: string, unit: string) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return null;
  return Math.round(unit.toLowerCase() === "l" ? amount * 1000 : amount);
}
