type ProductIdentityInput = {
  name: unknown;
  vintage?: unknown;
  packSize?: unknown;
  bottleSize?: unknown;
};

const PACK_TOKEN_RE = /\b(\d{1,3})\s*[\/x]\s*([0-9]+(?:\.[0-9]+)?)\s*(ml|cl|l)?\b/gi;
const VINTAGE_RE = /\b((?:19|20)\d{2}|NV|N\/V)\b/gi;

export function canonicalCatalogProductIdentity(input: ProductIdentityInput): string | null {
  const name = String(input.name || "").trim();
  if (!name) return null;

  const embeddedPacks = Array.from(name.matchAll(PACK_TOKEN_RE));
  const embeddedPack = embeddedPacks.at(-1);
  const packSize = positiveInteger(embeddedPack?.[1]) || positiveInteger(input.packSize);
  const bottleMilliliters = embeddedPack
    ? volumeInMilliliters(embeddedPack[2], embeddedPack[3])
    : bottleSizeInMilliliters(input.bottleSize);
  const vintage = normalizedVintage(input.vintage) || inferredVintage(name);
  if (!packSize || !bottleMilliliters || !vintage) return null;

  const family = normalizeIdentityText(
    name
      .replace(PACK_TOKEN_RE, " ")
      .replace(VINTAGE_RE, (match) => normalizedVintage(match) === vintage ? " " : match)
  );
  if (!family) return null;

  return `${family}|${vintage}|${packSize}|${bottleMilliliters}`;
}

function normalizeIdentityText(value: unknown) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizedVintage(value: unknown) {
  const text = String(value || "").trim().toUpperCase();
  if (/^(?:19|20)\d{2}$/.test(text)) return text;
  if (text === "NV" || text === "N/V") return "NV";
  return "";
}

function inferredVintage(name: string) {
  const matches = Array.from(name.matchAll(VINTAGE_RE));
  return normalizedVintage(matches.at(-1)?.[1]);
}

function positiveInteger(value: unknown) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 0;
}

function bottleSizeInMilliliters(value: unknown) {
  const match = String(value || "").trim().match(/^([0-9]+(?:\.[0-9]+)?)\s*(ml|cl|l)$/i);
  return match ? volumeInMilliliters(match[1], match[2]) : 0;
}

function volumeInMilliliters(value: unknown, unit: unknown) {
  const amount = Number(value);
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  const normalizedUnit = String(unit || "").toLowerCase();
  const multiplier = normalizedUnit === "l" ? 1000 : normalizedUnit === "cl" ? 10 : 1;
  return Math.round(amount * multiplier);
}
