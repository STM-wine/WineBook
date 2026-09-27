// Live editor registry, never business-data caching. Each editor unregisters on unmount.
const editors = new Map<symbol, () => Promise<void>>();
export function registerApprovalEditor(flush: () => Promise<void>) {
  const key = Symbol();
  editors.set(key, flush);
  return () => { editors.delete(key); };
}
export async function flushAllApprovals() {
  // Wait for every supplier editor before navigation or the all-supplier PO action.
  await Promise.all(Array.from(editors.values(), (flush) => flush()));
}
