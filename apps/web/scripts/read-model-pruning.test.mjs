import { describe, expect, it, vi } from 'vitest';
import { attemptReadModelPrune } from './read-model-pruning.mjs';

describe('optional read-model retention', () => {
  it('continues after the database times out without logging SQL text', async () => {
    const log = vi.fn();
    const rpc = vi.fn().mockResolvedValue({ error: { code: '57014', message: 'cancelling statement with private details' } });
    expect(await attemptReadModelPrune({ rpc }, log)).toBe(false);
    expect(rpc).toHaveBeenCalledWith('prune_read_models');
    expect(log).toHaveBeenCalledWith('{"event":"read_model_prune_deferred","code":"57014"}');
  });

  it('continues after a network failure and succeeds on a later attempt', async () => {
    const log = vi.fn();
    const rpc = vi.fn().mockRejectedValueOnce(new Error('fetch failed')).mockResolvedValueOnce({ error: null });
    expect(await attemptReadModelPrune({ rpc }, log)).toBe(false);
    expect(await attemptReadModelPrune({ rpc }, log)).toBe(true);
    expect(log).toHaveBeenCalledTimes(1);
  });
});
