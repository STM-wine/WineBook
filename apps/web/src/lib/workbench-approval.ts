/**
 * Read and commit an in-progress quantity edit before saving approval. AG Grid
 * otherwise lets the checkbox save the previous quantity first and only
 * commits the edited quantity when the buyer later leaves the cell.
 */
export function commitPendingQuantityForApproval(
  readPendingValue: () => unknown,
  stopEditing: () => void,
  committedValue: unknown
) {
  const pendingValue = readPendingValue();
  stopEditing();
  return Math.max(0, Math.round(Number(pendingValue ?? committedValue) || 0));
}
