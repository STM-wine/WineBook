export function aggregateVinosmithAvailable(
  rows: Array<{ wineCode?: string | null; available?: number | string | null }>
) {
  const byProductCode = new Map<string, number>();
  for (const row of rows) {
    const productCode = row.wineCode?.trim().toUpperCase();
    if (!productCode) continue;
    const available = Number(row.available);
    byProductCode.set(
      productCode,
      (byProductCode.get(productCode) || 0) + (Number.isFinite(available) ? available : 0)
    );
  }
  return byProductCode;
}
