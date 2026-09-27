// Bound JSON parsing/insert work per request. A supplier stays intact; unusually
// large suppliers are isolated in their own request rather than joined to others.
export function orderingUploadBatches(suppliers, maxBytes = 384 * 1024) {
  const batches = []; let batch = [], bytes = 2;
  const seen = new Set();
  for (const supplier of suppliers) {
    if (!supplier.supplier || seen.has(supplier.supplier)) throw new Error('Duplicate or missing ordering supplier');
    seen.add(supplier.supplier);
    const size = Buffer.byteLength(JSON.stringify(supplier), 'utf8') + 1;
    if (batch.length && (bytes + size > maxBytes || batch.length >= 20)) {
      batches.push(batch); batch = []; bytes = 2;
    }
    batch.push(supplier); bytes += size;
  }
  if (batch.length || !batches.length) batches.push(batch);
  return batches;
}
export async function publishOrderingSnapshot(db, job, snapshot) {
  const batches = orderingUploadBatches(snapshot.suppliers);
  for (let i = 0; i < batches.length; i++) {
    const { data, error } = await db.rpc('stage_ordering_read_model', {
      p_id: job.id, p_token: job.lease_token, p_suppliers: batches[i], p_reset: i === 0
    });
    if (error) throw new Error(`Staging ordering suppliers: ${error.message}`);
    if (!data) throw new Error('Ordering upload lease expired or superseded');
  }
  const { data, error } = await db.rpc('finish_ordering_read_model', {
    p_id: job.id, p_token: job.lease_token, p_result: snapshot.result
  });
  if (error) throw new Error(`Finishing ordering snapshot: ${error.message}`);
  return data;
}
