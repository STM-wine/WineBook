import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import ts from "typescript";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const WEB_ROOT = resolve(ROOT, "apps/web");
const SOURCE_FILE = resolve(WEB_ROOT, "src/lib/supabase/gross-profit-center.ts");
const BUILD_DIR = resolve(ROOT, "tmp/gross-profit-center-proof-build");
const OUTPUT_DIR = resolve(ROOT, "tmp/gross-profit-center-proof");

await loadDotenv(resolve(ROOT, ".env"));
await loadDotenv(resolve(ROOT, ".env.local"), true);
await loadDotenv(resolve(WEB_ROOT, ".env.local"));

const args = parseArgs(process.argv.slice(2));
const dateFrom = args.from || "2025-01-01";
const dateTo = args.to || new Date().toISOString().slice(0, 10);
const includeLines = args.includeLines === "true";
const lineLimit = Number.isInteger(Number(args.lineLimit)) ? Number(args.lineLimit) : 25;

await mkdir(BUILD_DIR, { recursive: true });
await mkdir(OUTPUT_DIR, { recursive: true });

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

const [{ createClient }, { buildGrossProfitWorkflowProof }] = await Promise.all([
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

const proof = await buildGrossProfitWorkflowProof(supabase, dateFrom, dateTo, { includeLines, lineLimit });
const outputPath = resolve(OUTPUT_DIR, `gross-profit-center-proof-${dateFrom}-to-${dateTo}.json`);
await writeFile(outputPath, `${JSON.stringify(proof, null, 2)}\n`);

console.log(JSON.stringify(summarize(proof, outputPath), null, 2));

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

function summarize(proof, outputPath) {
  return {
    outputPath,
    dateFrom: proof.dateFrom,
    dateTo: proof.dateTo,
    quickBooksFinancialLines: proof.quickBooksFinancialLines,
    quickBooksInvoices: proof.quickBooksInvoices,
    quickBooksInvoiceLines: proof.quickBooksInvoiceLines,
    quickBooksCreditMemos: proof.quickBooksCreditMemos,
    quickBooksCreditMemoLines: proof.quickBooksCreditMemoLines,
    quickBooksHeaderNetSales: proof.quickBooksHeaderNetSales,
    quickBooksLineNetSales: proof.quickBooksLineNetSales,
    quickBooksRevenueDelta: proof.quickBooksRevenueDelta,
    positiveRevenueLineMatchRate: proof.positiveRevenueLineMatchRate,
    positiveRevenueAmountMatchRate: proof.positiveRevenueAmountMatchRate,
    grossSales: proof.grossSales,
    grossCostBeforeBillback: proof.grossCostBeforeBillback,
    billbackEarned: proof.billbackEarned,
    effectiveCost: proof.effectiveCost,
    grossProfit: proof.grossProfit,
    grossMarginPct: proof.grossMarginPct,
    topConfidenceBuckets: proof.confidenceBuckets.slice(0, 8),
    costSources: proof.costSources
  };
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
