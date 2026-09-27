// Retry only reads. A failed publication/mutation must retain its existing
// transaction and lease recovery behavior, never be blindly replayed here.
const readRpcs = new Set(['/rest/v1/rpc/quickbooks_item_sales_windows_payload']);
export function retryDatabaseReads(fetcher, { delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms)), log = console.warn } = {}) {
  return async (input, init) => {
    const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
    const path = new URL(input instanceof Request ? input.url : String(input)).pathname;
    const canRetry = method === 'GET' || (method === 'POST' && readRpcs.has(path));
    for (let attempt = 1; ; attempt++) {
      const response = await fetcher(input, init);
      if (response.ok) return response;
      const body = await response.clone().json().catch(() => null);
      // Paths and SQLSTATE only: never log query parameters, credentials or rows.
      log(JSON.stringify({ event: 'database_request_failed', method, path, status: response.status, code: body?.code, attempt }));
      if (!canRetry || body?.code !== '57014' || attempt >= 3) return response;
      await response.body?.cancel();
      await delay(attempt * 1000);
    }
  };
}
