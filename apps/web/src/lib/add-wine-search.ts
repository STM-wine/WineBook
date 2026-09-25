export type SupplierWineMatchSearch = {
  query: string;
  supplierId?: string;
  supplierName?: string;
  producer?: string;
  vintage?: string;
  packSize?: string;
  bottleSize?: string;
  includeInactive?: boolean;
};

export function buildSupplierWineMatchPath(search: SupplierWineMatchSearch) {
  const params = new URLSearchParams({ q: search.query.trim() });
  if (search.supplierId) params.set("supplierId", search.supplierId);
  if (search.supplierName) params.set("supplierName", search.supplierName);
  if (search.producer) params.set("producer", search.producer);
  if (search.vintage) params.set("vintage", search.vintage);
  if (search.packSize) params.set("packSize", search.packSize);
  if (search.bottleSize) params.set("bottleSize", search.bottleSize);
  if (search.includeInactive) params.set("includeInactive", "true");
  return `/api/supplier-wines/matches?${params.toString()}`;
}

export function shouldIgnoreSupplierWineMatchResult({
  aborted,
  requestId,
  activeRequestId
}: {
  aborted: boolean;
  requestId: number;
  activeRequestId: number;
}) {
  return aborted || requestId !== activeRequestId;
}
