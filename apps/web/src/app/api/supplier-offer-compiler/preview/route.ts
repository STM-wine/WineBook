import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  classifySupplierOfferIdentityMatches,
  buildSupplierOfferPricingTrace,
  csvSupplierOfferParser,
  rowToCandidate,
  supplierOfferIdentityQuery,
  validateSupplierOfferCandidate,
  xlsxSupplierOfferParser,
  type SupplierOfferDocumentType,
  type SupplierOfferParser
} from "@/lib/supplier-offer-compiler";
import { searchProductIdentityCandidates } from "@/lib/product-identity-search";
import { fetchProductIdentitySearchCandidates } from "@/lib/product-identity-search-sources";
import { calculateGpMargin, calculatePricing, normalizeSpaces } from "@/lib/supplier-catalog";
import { createClient, createServiceRoleClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const PARSERS: SupplierOfferParser[] = [csvSupplierOfferParser, xlsxSupplierOfferParser];
const DOCUMENT_TYPES = new Set<SupplierOfferDocumentType>(["price_list", "inventory", "allocation", "closeout", "prearrival", "portfolio", "portal_export", "email_attachment", "unknown"]);

type Supabase = Awaited<ReturnType<typeof createClient>>;
type SupplierRecord = { id: string | null; name: string; trucking_cost_per_bottle?: number | string | null; active?: boolean | null };

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function supportedFile(file: File) {
  const name = file.name.toLowerCase();
  return file.type === "text/csv" || name.endsWith(".csv") || name.endsWith(".xlsx");
}

function selectParser(fileName: string, contentType: string | null) {
  return PARSERS.find((parser) => parser.canParse({ fileName, contentType }));
}

function documentType(value: FormDataEntryValue | null): SupplierOfferDocumentType {
  const normalized = typeof value === "string" ? value : "unknown";
  return DOCUMENT_TYPES.has(normalized as SupplierOfferDocumentType) ? normalized as SupplierOfferDocumentType : "unknown";
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function requireUser(supabase: Supabase) {
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

async function fetchSupplier(supabase: Supabase, supplierId: string, supplierName: string) {
  if (isUuid(supplierId)) {
    const { data, error } = await supabase.from("suppliers").select("id,name,trucking_cost_per_bottle,active").eq("id", supplierId).maybeSingle<SupplierRecord>();
    if (error) throw new Error(error.message);
    if (data) return data;
  }
  const normalizedName = supplierName.trim();
  if (!normalizedName) return null;
  const { data, error } = await supabase.from("suppliers").select("id,name,trucking_cost_per_bottle,active").ilike("name", normalizedName).maybeSingle<SupplierRecord>();
  if (error) throw new Error(error.message);
  return data || { id: null, name: normalizedName, trucking_cost_per_bottle: 0, active: true };
}


function normalizeSearchKey(value: unknown) {
  return normalizeSpaces(value)
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return jsonError("Sign in required.", 401);

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");
  const supplierId = String(formData?.get("supplierId") || "").trim();
  const supplierName = String(formData?.get("supplierName") || "").trim();
  const docType = documentType(formData?.get("documentType") ?? null);

  if (!(file instanceof File)) return jsonError("Upload a supplier offer CSV or XLSX file.");
  if (!supplierId && !supplierName) return jsonError("Select a supplier before previewing the offer.");
  if (!supportedFile(file)) return jsonError("Only CSV and XLSX files are accepted.");
  if (file.size > MAX_FILE_BYTES) return jsonError("Supplier offer files must be 20 MB or smaller.");

  const supplier = await fetchSupplier(supabase, supplierId, supplierName);
  if (!supplier) return jsonError("Selected supplier was not found.", 404);
  if (supplier.active === false) return jsonError("Selected supplier is inactive.", 400);

  const bytes = Buffer.from(await file.arrayBuffer());
  const contentType = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const parser = selectParser(file.name, contentType);
  if (!parser) return jsonError("No compiler parser is available for this file type.");

  let searchSupabase: ReturnType<typeof createServiceRoleClient> | Supabase = supabase;
  let matchSourceMode: "service_role" | "signed_in_user" = "signed_in_user";
  let matchSourceWarning: string | null = null;
  const skippedMatchSources: string[] = [];
  try {
    searchSupabase = createServiceRoleClient();
    matchSourceMode = "service_role";
  } catch (error) {
    matchSourceWarning = error instanceof Error ? error.message : "Product match search is using the signed-in Supabase client.";
  }

  let parseResult;
  let identityCandidates;
  try {
    [parseResult, identityCandidates] = await Promise.all([
      parser.parse({ fileName: file.name, contentType, bytes, supplierId: supplier.id, supplierName: supplier.name, documentType: docType }),
      fetchProductIdentitySearchCandidates(searchSupabase, {
        ignoreSourceErrors: matchSourceMode === "signed_in_user",
        onSourceError: (source, message) => skippedMatchSources.push(`${source}: ${message}`)
      })
    ]);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not load Add Wine identity search sources.";
    return jsonError(message, 500);
  }

  const candidates = parseResult.rows.filter((row) => !row.isSkipped && row.fields.length > 0).map((row, index) => {
    const candidate = rowToCandidate({ supplierId: supplier.id, supplierName: supplier.name, documentType: docType, row });
    const laidInPerBottle = Number(supplier.trucking_cost_per_bottle || 0);
    const pricing = calculatePricing({ packSize: candidate.packSize, fobBottle: candidate.fob, laidInPerBottle });
    const pricingTrace = buildSupplierOfferPricingTrace({ candidate, freight: laidInPerBottle, targetGp: 0.32 });
    const validations = validateSupplierOfferCandidate({ candidate, pricingTrace });
    const identityQuery = supplierOfferIdentityQuery(candidate);
    const canonicalMatches = searchProductIdentityCandidates(
      {
        query: identityQuery,
        producer: candidate.producer,
        vintage: candidate.vintage,
        packSize: candidate.packSize,
        bottleSize: candidate.bottleSize,
        supplierId: candidate.supplierId,
        supplierName: candidate.supplierName,
        limit: 8
      },
      identityCandidates
    );
    const matches = classifySupplierOfferIdentityMatches(candidate, canonicalMatches);
    const topMatches = matches.slice(0, 3);
    const topMatch = topMatches[0] || null;
    const matchDiagnostics = {
      normalizedCandidateSearchKey: normalizeSearchKey(identityQuery),
      canonicalIdentityQuery: identityQuery,
      addWineSourceMode: matchSourceMode,
      addWineSourceWarning: [matchSourceWarning, ...skippedMatchSources].filter(Boolean).join("; ") || null,
      skippedMatchSources,
      addWineSourceCandidateCount: identityCandidates.length,
      resultCount: matches.length,
      topResults: topMatches.map((match) => ({
        sourceTable: match.explanation?.source_table || match.source,
        sourceId: match.sourceId,
        name: match.matchedDisplayName,
        score: match.score,
        status: match.explanation?.classification || match.matchStatus,
        explanation: match.explanation
      })),
      finalStatus: topMatch?.explanation?.classification || "New wine",
      finalReason: topMatch ? String((topMatch.explanation?.reasons as string[] | undefined)?.[0] || "Top Add Wine search result selected for review.") : "No strong Add Wine search result matched the normalized producer/name key."
    };
    return {
      previewId: `preview-${index + 1}`,
      sourceRow: { sourceKind: row.sourceKind, sheetName: row.sheetName, rowNumber: row.rowNumber, rawRow: row.rawRow, rawText: row.rawText, rowConfidence: row.rowConfidence },
      candidate,
      displayName: candidate.metadata?.displayName || null,
      pricingPreview: {
        frontlineBottlePrice: pricing.frontlineBottlePrice,
        frontlineMargin: pricing.grossProfitMargin,
        bestPrice: pricing.bestPrice,
        bestMargin: pricing.bestPrice ? calculateGpMargin({ bottlePrice: pricing.bestPrice, landedBottleCost: pricing.landedBottleCost }) : null,
        landedBottleCost: pricing.landedBottleCost,
        helper: "calculatePricing"
      },
      pricingTrace,
      validations,
      matches,
      matchDiagnostics
    };
  });

  return NextResponse.json({
    document: { fileName: file.name, contentType, byteSize: file.size, checksum: createHash("sha256").update(bytes).digest("hex"), documentType: docType, supplierId: supplier.id, supplierName: supplier.name },
    parse: { parserType: parseResult.parserType, parserVersion: parseResult.parserVersion, diagnostics: parseResult.diagnostics, detectedHeaders: parseResult.diagnostics.headers || parseResult.diagnostics.sheets || [] },
    rows: parseResult.rows,
    candidates
  });
}
