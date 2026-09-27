// Deduplicate overlapping reads across expanded supplier editors. Nothing is cached after settlement.
const requests = new Map<string, Promise<any>>();
export function sharedOrderingRead<T = any>(url: string): Promise<T> {
  const existing = requests.get(url);
  if (existing) return existing;
  const request = fetch(url, { cache: "no-store" }).then(async (response) => {
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "Shared ordering refresh failed.");
    return result;
  }).finally(() => { if (requests.get(url) === request) requests.delete(url); });
  requests.set(url, request);
  return request;
}
