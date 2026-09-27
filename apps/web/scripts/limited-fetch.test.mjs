import { describe, expect, it } from 'vitest';
import { limitConcurrentFetch } from './limited-fetch.mjs';
describe('background database request concurrency', () => {
  it('bounds simultaneous reads and drains the queue without losing results', async () => {
    let active = 0, peak = 0;
    const fetcher = limitConcurrentFetch(async (value) => {
      peak = Math.max(peak, ++active);
      await new Promise((resolve) => setTimeout(resolve, 1));
      active--;
      return value;
    }, 2);
    expect(await Promise.all(Array.from({ length: 12 }, (_, i) => fetcher(i)))).toEqual(Array.from({ length: 12 }, (_, i) => i));
    expect(peak).toBe(2);
  });
  it('releases permits after failures so later reads cannot deadlock', async () => {
    const fetcher = limitConcurrentFetch(async (value) => {
      if (value === 0) throw new Error('network failure');
      return value;
    }, 1);
    const results = await Promise.allSettled([fetcher(0), fetcher(1), fetcher(2)]);
    expect(results.map((r) => r.status)).toEqual(['rejected', 'fulfilled', 'fulfilled']);
    expect(results[2].value).toBe(2);
  });
});
