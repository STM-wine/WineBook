export async function attemptReadModelPrune(db, log = console.warn) {
  try {
    const { error } = await db.rpc('prune_read_models');
    if (!error) return true;
    // Only a SQLSTATE is logged; database error text may contain internal data.
    log(JSON.stringify({ event: 'read_model_prune_deferred', code: error.code || 'unknown' }));
  } catch {
    log(JSON.stringify({ event: 'read_model_prune_deferred', code: 'request_failed' }));
  }
  return false;
}
