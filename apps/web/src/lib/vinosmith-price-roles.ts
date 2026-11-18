export type VinosmithPriceRole = "frontline" | "best";

// is_default identifies Vinosmith's default selling tier, which may be Best or On 1-Case.
// Only the canonical tier label identifies Frontline or Best.
export function vinosmithPriceRole(label: string | null | undefined): VinosmithPriceRole | null {
  const normalized = (label || "").trim().toLowerCase();
  if (normalized === "frontline") return "frontline";
  if (normalized === "best") return "best";
  return null;
}

export function vinosmithPriceForRole(
  levels: Array<{ label: string | null; price_cents: number | null }>,
  role: VinosmithPriceRole,
  itemCode: string
): number | null {
  const prices = Array.from(new Set(levels
    .filter((level) => vinosmithPriceRole(level.label) === role)
    .map((level) => Number(level.price_cents))
    .filter((cents) => Number.isFinite(cents) && cents > 0)));
  if (prices.length > 1) {
    throw new Error(`PO ${itemCode}: conflicting active Vinosmith ${role} prices. Resolve duplicate price levels before exporting.`);
  }
  return prices.length ? Math.round(prices[0]) / 100 : null;
}
