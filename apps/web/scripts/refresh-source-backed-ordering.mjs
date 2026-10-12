import { createClient } from '@supabase/supabase-js';
import { loadEnvironment, loadServerModule } from './read-model-runtime.mjs';

await loadEnvironment();
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key || !process.env.VINOSMITH_API_TOKEN) {
  throw new Error('Supabase and Vinosmith source credentials are required.');
}
const db = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const { createSourceBackedOrderingRun } = await loadServerModule('src/lib/source-backed-ordering-runs.ts');
const result = await createSourceBackedOrderingRun(db, null);
console.log(JSON.stringify({ reportRunId: result.run.id, reportDate: result.run.report_date, rowCount: result.rowCount,
  reused: result.reused, diagnostics: result.diagnostics }));
