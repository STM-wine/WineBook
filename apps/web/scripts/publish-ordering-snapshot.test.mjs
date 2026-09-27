import { describe, expect, it, vi } from 'vitest';
import { orderingUploadBatches, publishOrderingSnapshot } from './publish-ordering-snapshot.mjs';
describe('ordering publication batches', () => {
  it('retains every supplier and isolates oversized records', () => {
    const suppliers = Array.from({length: 45}, (_,i) => ({supplier: String(i), data: {text: 'é'.repeat(i === 8 ? 2000 : 25)}}));
    const batches = orderingUploadBatches(suppliers, 500);
    expect(batches.flat()).toEqual(suppliers);
    for (const batch of batches) {
      expect(batch.length).toBeLessThanOrEqual(20);
      expect(batch.length === 1 || Buffer.byteLength(JSON.stringify(batch)) <= 500).toBe(true);
    }
  });
  it('resets only the first batch and publishes once after all stages succeed', async () => {
    const db = {rpc: vi.fn().mockResolvedValue({data: true})};
    const suppliers = Array.from({length: 25}, (_,i) => ({supplier: String(i),data:{}}));
    await expect(publishOrderingSnapshot(db,{id:'job',lease_token:'token'},{suppliers,result:{groups: suppliers}})).resolves.toBe(true);
    expect(db.rpc.mock.calls.map(([name,args])=>[name,args.p_reset])).toEqual([
      ['stage_ordering_read_model',true], ['stage_ordering_read_model',false], ['finish_ordering_read_model',undefined]
    ]);
  });
  it('does not finish an incomplete or superseded upload', async () => {
    for (const response of [{error:{message:'timeout'}},{data:false}]) {
      const db = {rpc: vi.fn().mockResolvedValue(response)};
      await expect(publishOrderingSnapshot(db,{id:'job',lease_token:'token'},{suppliers:[{supplier:'A',data:{}}],result:{}})).rejects.toThrow();
      expect(db.rpc).toHaveBeenCalledTimes(1);
    }
  });
  it('rejects duplicate suppliers before writing', () => {
    expect(()=>orderingUploadBatches([{supplier:'A'},{supplier:'A'}])).toThrow('Duplicate');
  });
});
