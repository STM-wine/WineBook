import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB_ROOT = resolve(ROOT, "apps/web");
const SOURCE_FILE = resolve(WEB_ROOT, "src/lib/supabase/gross-profit-center.ts");
const BUILD_DIR = resolve(ROOT, "tmp/gross-profit-rollup-build");

const FORMULA_VERSION = "gross-profit-center-v1-current-item-cost-billback";
const STABLE_LAG_DAYS = 124;
const UPSERT_CHUNK_SIZE = 500;

await loadDotenv(resolve(ROOT, ".env"));
await loadDotenv(resolve(ROOT, ".env.local"), true);
await loadDotenv(resolve(WEB_ROOT, ".env.local"));

const args = parseArgs(process.argv.slice(2));
const today = args.today || new Date().toISOString().slice(0, 10);
const stableCutoff = minIso(args.to || addDays(today, -STABLE_LAG_DAYS), addDays(today, -STABLE_LAG_DAYS));
const requestedRanges = rangesFromArgs(args, stableCutoff);
const force = args.force === "true";

await mkdir(BUILD_DIR, { recursive: true });
const source = await readFile(SOURCE_FILE, "utf8");
const compiled = ts.transpileModule(source.replace(/^import "server-only";\n/, ""), {
  compilerOptions: {
    esModuleInterop: true,
    module: ts.ModuleKind.ES2022,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    target: ts.ScriptTarget.ES2022
  },
  fileName: SOURCE_FILE
});
const compiledPath = resolve(BUILD_DIR, "gross-profit-center.mjs");
await writeFile(compiledPath, compiled.outputText);

const [{ createClient }, { buildGrossProfitCenter }] = await Promise.all([
  import("@supabase/supabase-js"),
  import(pathToFileURL(compiledPath).href)
]);

const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!supabaseUrl || !serviceRoleKey) {
  throw new Error("Missing SUPABASE_URL/NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.");
}

const supabase = createClient(supabaseUrl, serviceRoleKey, {
  auth: { autoRefreshToken: false, persistSession: false }
});

const summary = {
  formulaVersion: FORMULA_VERSION,
  stableLagDays: STABLE_LAG_DAYS,
  stableCutoff,
  force,
  requestedRanges,
  chunks: 0,
  days: 0,
  rows: 0
};

for (const range of requestedRanges) {
  if (range.from > range.to) continue;
  const missingDays = force ? daysBetween(range.from, range.to) : await fetchMissingDays(range.from, range.to);
  const chunks = chunkDaysByMonth(missingDays);
  for (const chunk of chunks) {
    const result = await processChunk(chunk.from, chunk.to);
    summary.chunks += 1;
    summary.days += result.days;
    summary.rows += result.rows;
  }
}

console.log(JSON.stringify(summary, null, 2));

async function processChunk(dateFrom, dateTo) {
  let runId = null;
  const startedAt = new Date().toISOString();
  try {
    const { data: run, error: runError } = await supabase
      .from("gross_profit_rollup_runs")
      .insert({
        status: "running",
        requested_from: dateFrom,
        requested_to: dateTo,
        processed_from: dateFrom,
        processed_to: dateTo,
        formula_version: FORMULA_VERSION,
        stable_lag_days: STABLE_LAG_DAYS,
        started_at: startedAt
      })
      .select("id")
      .single();
    if (runError) throw new Error(runError.message);
    runId = run.id;

    const grossProfitCenter = await buildGrossProfitCenter(supabase, dateFrom, dateTo);
    const rows = buildDailyRows(grossProfitCenter.lines, dateFrom, dateTo, runId);
    const { error: deleteError } = await supabase
      .from("gross_profit_daily_rollups")
      .delete()
      .eq("formula_version", FORMULA_VERSION)
      .gte("period_date", dateFrom)
      .lte("period_date", dateTo);
    if (deleteError) throw new Error(deleteError.message);

    for (const chunkRows of chunks(rows, UPSERT_CHUNK_SIZE)) {
      const { error } = await supabase
        .from("gross_profit_daily_rollups")
        .upsert(chunkRows, {
          onConflict: "period_date,business_line,scope_type,scope_key,parent_scope_type,parent_scope_key"
        });
      if (error) throw new Error(error.message);
    }

    const dayCount = daysBetween(dateFrom, dateTo).length;
    const { error: completeError } = await supabase
      .from("gross_profit_rollup_runs")
      .update({
        status: "completed",
        chunk_count: 1,
        day_count: dayCount,
        row_count: rows.length,
        completed_at: new Date().toISOString()
      })
      .eq("id", runId);
    if (completeError) throw new Error(completeError.message);
    return { days: dayCount, rows: rows.length };
  } catch (error) {
    if (runId) {
      await supabase
        .from("gross_profit_rollup_runs")
        .update({
          status: "failed",
          error_message: error instanceof Error ? error.message : "Unknown gross profit rollup error.",
          completed_at: new Date().toISOString()
        })
        .eq("id", runId);
    }
    throw error;
  }
}

async function fetchMissingDays(dateFrom, dateTo) {
  const expectedDays = daysBetween(dateFrom, dateTo);
  const { data, error } = await supabase
    .from("gross_profit_daily_rollups")
    .select("period_date")
    .eq("business_line", "all")
    .eq("scope_type", "company")
    .eq("scope_key", "all")
    .eq("formula_version", FORMULA_VERSION)
    .gte("period_date", dateFrom)
    .lte("period_date", dateTo);
  if (error) throw new Error(error.message);
  const existing = new Set((data || []).map((row) => row.period_date));
  return expectedDays.filter((day) => !existing.has(day));
}

function buildDailyRows(lines, dateFrom, dateTo, runId) {
  const linesByDate = new Map();
  for (const line of lines) {
    if (!line.salesDate) continue;
    const day = line.salesDate.slice(0, 10);
    const existing = linesByDate.get(day) || [];
    existing.push(line);
    linesByDate.set(day, existing);
  }

  const rows = [];
  for (const day of daysBetween(dateFrom, dateTo)) {
    const dayLines = linesByDate.get(day) || [];
    for (const businessLine of ["all", "stem", "grw"]) {
      const scopedLines = businessLine === "all" ? dayLines : dayLines.filter((line) => classifyBusinessLine(line) === businessLine);
      rows.push(rowForRollup(day, businessLine, "company", "all", "All", rollupLines(scopedLines), scopedLines, runId));
      rows.push(...rowsForScope(day, businessLine, "rep", scopedLines, (line) => cleanLabel(line.salesRep, "Unassigned Rep"), runId));
      rows.push(...rowsForScope(day, businessLine, "account", scopedLines, (line) => cleanLabel(line.customerFullName, "Unknown Account"), runId));
      rows.push(...rowsForRepAccounts(day, businessLine, scopedLines, runId));
    }
  }
  return rows;
}

function rowsForScope(day, businessLine, scopeType, lines, labelForLine, runId) {
  const groups = new Map();
  for (const line of lines) {
    const label = labelForLine(line);
    const key = rowKey(label);
    const existing = groups.get(key) || { label, lines: [] };
    existing.lines.push(line);
    groups.set(key, existing);
  }
  return Array.from(groups.entries()).map(([key, group]) =>
    rowForRollup(day, businessLine, scopeType, key, group.label, rollupLines(group.lines), group.lines, runId)
  );
}

function rowsForRepAccounts(day, businessLine, lines, runId) {
  const groups = new Map();
  for (const line of lines) {
    const repLabel = cleanLabel(line.salesRep, "Unassigned Rep");
    const accountLabel = cleanLabel(line.customerFullName, "Unknown Account");
    const repKey = rowKey(repLabel);
    const accountKey = rowKey(accountLabel);
    const key = `${repKey}|${accountKey}`;
    const existing = groups.get(key) || { repKey, repLabel, accountKey, accountLabel, lines: [] };
    existing.lines.push(line);
    groups.set(key, existing);
  }
  return Array.from(groups.values()).map((group) =>
    rowForRollup(day, businessLine, "rep_account", group.accountKey, group.accountLabel, rollupLines(group.lines), group.lines, runId, {
      parentScopeType: "rep",
      parentScopeKey: group.repKey,
      parentScopeLabel: group.repLabel
    })
  );
}

function rowForRollup(day, businessLine, scopeType, scopeKey, scopeLabel, rollup, lines, runId, parent = {}) {
  return {
    period_date: day,
    business_line: businessLine,
    scope_type: scopeType,
    scope_key: scopeKey,
    scope_label: scopeLabel,
    parent_scope_type: parent.parentScopeType || "",
    parent_scope_key: parent.parentScopeKey || "",
    parent_scope_label: parent.parentScopeLabel || "",
    invoice_sales: roundMoney(rollup.invoiceSales),
    credit_memos: roundMoney(rollup.creditMemos),
    net_sales: roundMoney(rollup.netSales),
    invoice_count: rollup.invoiceTxnIds.size,
    credit_memo_count: rollup.creditMemoTxnIds.size,
    sample_cost: roundMoney(rollup.sampleCost),
    gross_profit: roundMoney(rollup.grossProfit),
    gross_profit_percent: marginPct(rollup.grossProfit, rollup.netSales),
    confidence_buckets: summarizeBy(lines, (line) => line.confidenceBucket),
    cost_sources: summarizeBy(lines, (line) => line.qbCostSource),
    price_match_methods: summarizeBy(lines, (line) => line.vinosmithPriceMatchMethod),
    formula_version: FORMULA_VERSION,
    source_line_count: lines.length,
    run_id: runId,
    calculated_at: new Date().toISOString()
  };
}

function rollupLines(lines) {
  const rollup = {
    invoiceSales: 0,
    creditMemos: 0,
    netSales: 0,
    invoiceTxnIds: new Set(),
    creditMemoTxnIds: new Set(),
    sampleCost: 0,
    grossProfit: 0
  };
  for (const line of lines) addLineToRollup(rollup, line);
  return rollup;
}

function addLineToRollup(rollup, line) {
  if (line.confidenceBucket === "sample_zero_dollar_or_100_discount") {
    rollup.sampleCost += Math.abs(money(line.effectiveCost ?? line.grossCostBeforeBillback));
    return;
  }

  const amount = money(line.qbGrossSales);
  if (line.transactionType === "invoice") {
    rollup.invoiceSales += amount;
    if (line.transactionId) rollup.invoiceTxnIds.add(line.transactionId);
  } else {
    rollup.creditMemos += Math.abs(amount);
    if (line.transactionId) rollup.creditMemoTxnIds.add(line.transactionId);
  }
  rollup.netSales += amount;
  rollup.grossProfit += money(line.grossProfit);
}

function summarizeBy(lines, keyForLine) {
  const buckets = {};
  for (const line of lines) {
    const key = keyForLine(line) || "unknown";
    const current = buckets[key] || { lines: 0, grossSales: 0, grossProfit: 0 };
    current.lines += 1;
    current.grossSales = roundMoney(current.grossSales + money(line.qbGrossSales));
    current.grossProfit = roundMoney(current.grossProfit + money(line.grossProfit));
    buckets[key] = current;
  }
  return buckets;
}

function classifyBusinessLine(line) {
  if (isGrwCode(line.vinosmithWineCode)) return "grw";
  if (isGrwCode(line.itemFullName)) return "grw";
  if (isGrwCode(line.description)) return "grw";
  if (normalizeBusinessLineCue(line.vinosmithImporterName) === "grw") return "grw";
  return "stem";
}

function isGrwCode(value) {
  const cue = normalizeBusinessLineCue(value);
  if (!cue) return false;
  return cue
    .split(/[:/\\|\-_\s]+/)
    .map((part) => part.trim())
    .filter(Boolean)
    .some((part) => part.startsWith("grw"));
}

function normalizeBusinessLineCue(value) {
  return (value || "").trim().toLowerCase();
}

function rangesFromArgs(parsedArgs, stableCutoff) {
  if (parsedArgs.from) {
    return [{ from: parsedArgs.from, to: minIso(parsedArgs.to || stableCutoff, stableCutoff) }];
  }
  const years = String(parsedArgs.years || "2025,2026")
    .split(",")
    .map((value) => Number(value.trim()))
    .filter((value) => Number.isInteger(value))
    .sort((a, b) => a - b);
  return years.map((year) => ({
    from: `${year}-01-01`,
    to: minIso(`${year}-12-31`, stableCutoff)
  }));
}

function chunkDaysByMonth(days) {
  const chunksByKey = new Map();
  for (const day of days) {
    const key = day.slice(0, 7);
    const current = chunksByKey.get(key) || { from: day, to: day };
    if (day < current.from) current.from = day;
    if (day > current.to) current.to = day;
    chunksByKey.set(key, current);
  }
  return Array.from(chunksByKey.values()).sort((a, b) => a.from.localeCompare(b.from));
}

function daysBetween(from, to) {
  const days = [];
  for (let day = from; day <= to; day = addDays(day, 1)) {
    days.push(day);
  }
  return days;
}

function addDays(value, days) {
  const date = dateFromIso(value);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function dateFromIso(value) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day));
}

function minIso(left, right) {
  return left < right ? left : right;
}

function rowKey(label) {
  return label.trim().toLowerCase();
}

function cleanLabel(value, fallback) {
  const text = value?.trim();
  return text || fallback;
}

function money(value) {
  return value || 0;
}

function marginPct(grossProfit, grossSales) {
  if (grossProfit === null || grossSales === null || grossSales === 0) return null;
  return grossProfit / grossSales;
}

function roundMoney(value) {
  return Math.round(money(value) * 100) / 100;
}

function chunks(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

function parseArgs(values) {
  const parsed = {};
  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--")) continue;
    const [key, inlineValue] = value.slice(2).split("=", 2);
    parsed[key] = inlineValue ?? values[index + 1] ?? "true";
    if (inlineValue === undefined && values[index + 1] && !values[index + 1].startsWith("--")) index += 1;
  }
  return parsed;
}

async function loadDotenv(path, override = false) {
  let text = "";
  try {
    text = await readFile(path, "utf8");
  } catch {
    return;
  }
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || !line.includes("=")) continue;
    const [key, ...rest] = line.split("=");
    if (!override && process.env[key]) continue;
    process.env[key] = rest.join("=").trim().replace(/^['"]|['"]$/g, "");
  }
}
