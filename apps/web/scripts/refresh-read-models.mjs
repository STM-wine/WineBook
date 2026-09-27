import { createClient } from '@supabase/supabase-js';
import { loadEnvironment, loadServerModule } from './read-model-runtime.mjs';
import { limitConcurrentFetch } from './limited-fetch.mjs';
await loadEnvironment();
const supabase = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: limitConcurrentFetch(fetch, 2) } });
const { buildProductWorkspace } = await loadServerModule('src/lib/product-workspace-builder.ts');
const { buildMarginSnapshot, MARGIN_SNAPSHOT_FORMULA, warmMarginRanges } = await loadServerModule('src/lib/company-dashboard-data.ts');
const { PRODUCT_FORMULA_VERSION } = await loadServerModule('src/lib/product-workspace-reader.ts');
const { buildOrderingSnapshot, ORDERING_READ_FORMULA, orderingReadKey } = await loadServerModule('src/lib/ordering-snapshot.ts');
let lastPrunedAt = 0;
const loop = process.argv.includes('--watch');
async function request(kind, key, formula, request) {
  const { error } = await supabase.rpc('request_read_model', { p_kind: kind, p_key: key, p_formula: formula, p_request: request }).select("id");
  if (error) throw new Error(error.message);
}
async function warm() {
  const ranges = warmMarginRanges();
  await request('products', 'catalog', PRODUCT_FORMULA_VERSION, {});
  await request('ordering', orderingReadKey(), ORDERING_READ_FORMULA, {});
  for (const range of ranges) {
    await request('margins', `${range.from}:${range.to}`, MARGIN_SNAPSHOT_FORMULA, range);

  }
}
async function drain() {
  for (;;) {
    const { data: claimed, error } = await supabase.rpc('claim_read_model', { p_formulas: {
      products: PRODUCT_FORMULA_VERSION, margins: MARGIN_SNAPSHOT_FORMULA, ordering: ORDERING_READ_FORMULA
    } });
    const job = Array.isArray(claimed) ? claimed[0] : claimed;
    if (error) throw new Error(error.message);
    if (!job?.id) return;
    const start = performance.now();
    try {
      // Avoid known obsolete work before touching the expensive sources.
      const { data: version, error: versionError } = await supabase.from('read_model_versions').select('version').eq('kind', job.kind).single();
      if (versionError) throw new Error(versionError.message);
      if (version.version !== job.source_version) {
        await supabase.from('read_model_jobs').update({ status: 'obsolete' }).eq('id', job.id).eq('lease_token', job.lease_token);
        continue;
      }
      if (job.kind === 'ordering') {
        const snapshot = await buildOrderingSnapshot(supabase);
        const { data: published, error } = await supabase.rpc('publish_ordering_read_model', {
          p_id: job.id, p_token: job.lease_token, p_result: snapshot.result, p_suppliers: snapshot.suppliers
        });
        if (error) throw new Error(error.message);
        console.log(JSON.stringify({ kind: job.kind, published, durationMs: Math.round(performance.now() - start) }));
        continue;
      }
      const product = job.kind === 'products' ? await buildProductWorkspace(supabase) : null;
      if (product) {
        // Bound PostgREST parsing/memory overhead; incomplete uploads stay private.
        const ids = new Set(product.rows.map((row) => row.id));
        if (ids.size !== product.rows.length) throw new Error('Duplicate product snapshot IDs');
        for (let offset = 0; offset < Math.max(1, product.rows.length); offset += 200) {
          const { data: staged, error } = await supabase.rpc('stage_product_read_model', {
            p_id: job.id, p_token: job.lease_token, p_rows: product.rows.slice(offset, offset + 200), p_reset: offset === 0
          });
          if (error) throw new Error(error.message);
          if (!staged) throw new Error('Product upload lease expired or superseded');
        }
        const { data: published, error } = await supabase.rpc('finish_product_read_model', {
          p_id: job.id, p_token: job.lease_token, p_count: product.rows.length
        });
        if (error) throw new Error(error.message);
        console.log(JSON.stringify({ kind: job.kind, key: job.cache_key, published, rows: product.rows.length,
          durationMs: Math.round(performance.now() - start) }));
        continue;
      }
      const result = await buildMarginSnapshot(supabase, job.request);
      const { data: published, error: publishError } = await supabase.rpc('publish_read_model', {
        p_id: job.id, p_token: job.lease_token, p_result: result, p_rows: null
      });
      if (publishError) throw new Error(publishError.message);
      console.log(JSON.stringify({ kind: job.kind, key: job.cache_key, published, durationMs: Math.round(performance.now() - start) }));
    } catch (error) {
      await supabase.from('read_model_jobs').update({ status: 'failed', error: error.message, lease_until: new Date(Date.now() + 60000).toISOString() })
        .eq('id', job.id).eq('lease_token', job.lease_token).eq('status', 'running');
      console.error(JSON.stringify({ kind: job.kind, key: job.cache_key, error: error.message }));
    }
  }
}
do {
  if (Date.now() - lastPrunedAt > 3_600_000) {
    const { error } = await supabase.rpc('prune_read_models');
    if (error) throw new Error(error.message);
    lastPrunedAt = Date.now();
  }
  await warm();
  await drain();
  if (loop) await new Promise((resolve) => setTimeout(resolve, 5000));
} while (loop);
