export type WorkbenchGrouping = "none" | "pickup";

export function pickupLocationLabel(value: string | null | undefined): string {
  const location = value?.trim();
  if (!location) return "Unassigned";
  const key = location.toLowerCase().replace(/[^a-z]/g, "");
  if (["ca", "california"].includes(key)) return "California";
  if (["or", "oregon"].includes(key)) return "Oregon";
  if (["wa", "washington"].includes(key)) return "Washington";
  if (["ny", "nj", "nynj", "njny", "newyork", "newjersey", "newyorknewjersey"].includes(key)) return "NY/NJ";
  return location;
}

// Stable grouping keeps the workbench's existing order within each location.
export function groupByPickup<T>(items: T[], location: (item: T) => string | null | undefined): T[] {
  const order = ["California", "Oregon", "Washington", "NY/NJ"];
  return [...items].sort((a, b) => {
    const left = pickupLocationLabel(location(a));
    const right = pickupLocationLabel(location(b));
    const rank = (label: string) => label === "Unassigned" ? 100 : order.includes(label) ? order.indexOf(label) : 50;
    return rank(left) - rank(right) || (rank(left) === 50 ? left.localeCompare(right) : 0);
  });
}
