// Read-only configured-DB diagnostic. Never production browser timings.
import { createClient } from '@supabase/supabase-js';
import { writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { loadEnvironment, loadServerModule, ROOT } from './read-model-runtime.mjs';
await loadEnvironment();
let requests = 0, bytes = 0;
const db = createClient(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
  global: { fetch: async (...args) => {
    requests++;
    const response = await fetch(...args);
    bytes += (await response.clone().arrayBuffer()).byteLength;
    return response;
  } }
});
const margins = process.argv.includes('--margins');
const module = await loadServerModule(margins ? 'src/lib/company-dashboard-data.ts' : 'src/lib/product-workspace-builder.ts');
const start = performance.now();
const data = margins ? await module.buildMarginSnapshot(db, module.warmMarginRanges()[1]) : await module.buildProductWorkspace(db, true);
const record = { stage: margins ? 'background current-month margins, all scopes' : 'background product reconciliation',
  elapsedMs: performance.now() - start, requests, decodedDatabaseBytes: bytes,
  rows: data.rows?.length, serializedBytes: Buffer.byteLength(JSON.stringify(data)), productionBrowser: false };
await mkdir(resolve(ROOT, 'tmp/performance'), { recursive: true });
await writeFile(resolve(ROOT, `tmp/performance/${margins ? 'margins' : 'products'}.json`), JSON.stringify(margins ? data : data.rows));
await writeFile(resolve(ROOT, `tmp/performance/${margins ? 'margin' : 'product'}-probe.json`), JSON.stringify(record, null, 2));
console.log(JSON.stringify(record));
