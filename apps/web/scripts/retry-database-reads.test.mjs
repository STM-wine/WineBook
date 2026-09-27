import { describe, expect, it, vi } from 'vitest';
import { retryDatabaseReads } from './retry-database-reads.mjs';
const timeout = () => Response.json({ code: '57014', message: 'statement timeout' }, { status: 500 });
const url = 'https://example.com/rest/v1/quickbooks_items';
describe('database read recovery', () => {
  it('retries a timed-out read and returns the complete successful response', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(timeout()).mockResolvedValueOnce(Response.json([{ id: 'complete' }]));
    const delay = vi.fn(); const log = vi.fn();
    const result = await retryDatabaseReads(fetcher, { delay, log })(url);
    expect(await result.json()).toEqual([{ id: 'complete' }]);
    expect(fetcher).toHaveBeenCalledTimes(2); expect(delay).toHaveBeenCalledWith(1000);
  });
  it('bounds retries and preserves the final error for job recovery', async () => {
    const fetcher = vi.fn().mockImplementation(async () => timeout());
    const result = await retryDatabaseReads(fetcher, { delay: vi.fn(), log: vi.fn() })(url);
    expect(fetcher).toHaveBeenCalledTimes(3); expect((await result.json()).code).toBe('57014');
  });
  it('never retries writes or publication RPCs', async () => {
    for (const [path, method] of [[url, 'PATCH'], ['https://example.com/rest/v1/rpc/publish_ordering_read_model', 'POST']]) {
      const fetcher = vi.fn().mockResolvedValue(timeout());
      await retryDatabaseReads(fetcher, { log: vi.fn() })(path, { method });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it('retries the explicitly read-only sales RPC but not other SQL errors', async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(timeout()).mockResolvedValueOnce(Response.json([]));
    await retryDatabaseReads(fetcher, { delay: vi.fn(), log: vi.fn() })('https://example.com/rest/v1/rpc/quickbooks_item_sales_windows_payload', { method: 'POST' });
    expect(fetcher).toHaveBeenCalledTimes(2);
    const denied = vi.fn().mockResolvedValue(Response.json({ code: '42501' }, { status: 403 }));
    await retryDatabaseReads(denied, { log: vi.fn() })(url);
    expect(denied).toHaveBeenCalledTimes(1);
  });
});
