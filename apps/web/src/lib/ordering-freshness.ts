export const ORDERING_TIMEZONE = "America/Phoenix";

type OrderingFreshnessDiagnostics = {
  reference_date?: unknown;
  quickbooks_as_of?: unknown;
};

export function orderingBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: ORDERING_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(value);
  const values = new Map(parts.map((part) => [part.type, part.value]));
  return `${values.get("year")}-${values.get("month")}-${values.get("day")}`;
}

export function assertCurrentOrderingDiagnostics(
  diagnostics: OrderingFreshnessDiagnostics,
  expectedReferenceDate: string
) {
  if (diagnostics.reference_date !== expectedReferenceDate) {
    throw new Error(
      `Ordering sales freshness check failed: expected a ${expectedReferenceDate} sales cutoff, but received ${String(diagnostics.reference_date || "no cutoff")}.`
    );
  }

  const quickBooksAsOf = typeof diagnostics.quickbooks_as_of === "string"
    ? diagnostics.quickbooks_as_of
    : "";
  const quickBooksDate = new Date(quickBooksAsOf);
  if (!quickBooksAsOf || Number.isNaN(quickBooksDate.getTime())) {
    throw new Error("Ordering sales freshness check failed: QuickBooks has no valid completed-sync timestamp.");
  }

  const quickBooksBusinessDate = orderingBusinessDate(quickBooksDate);
  if (quickBooksBusinessDate !== expectedReferenceDate) {
    throw new Error(
      `Ordering sales freshness check failed: sales are requested through ${expectedReferenceDate}, but the latest complete QuickBooks data is from ${quickBooksBusinessDate}.`
    );
  }
}

export function formatOrderingBusinessDate(value: string | null | undefined) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T12:00:00Z`);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC"
  }).format(date);
}
