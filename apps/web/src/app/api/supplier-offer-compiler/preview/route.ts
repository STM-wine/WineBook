import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  buildSupplierOfferMatchCandidates,
  buildSupplierOfferPricingTrace,
  csvSupplierOfferParser,
  rowToCandidate,
  validateSupplierOfferCandidate,
  xlsxSupplierOfferParser,
  type SupplierOfferDocumentType,
  type SupplierOfferParser
} from "@/lib/supplier-offer-compiler";
import {
  productRowToCandidate,
  quickbooksItemRowToCandidate,
  recommendationRowToCandidate,
  supplierCatalogRowToCandidate,
  vinosmithWineRowToCandidate,
  type ProductIdentityCandidate
} from "@/lib/product-identity-search";
import { calculateGpMargin, calculatePricing } from "@/lib/supplier-catalog";
import { createClient } from "@/lib/supabase/server";

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

async function fetchIdentityCandidates(supabase: Supabase): Promise<ProductIdentityCandidate[]> {
  const { data: suppliers } = await supabase.from("suppliers").select("id,name,trucking_cost_per_bottle").returns<SupplierRecord[]>();
  const supplierById = new Map((suppliers || []).filter((supplier): supplier is SupplierRecord & { id: string } => Boolean(supplier.id)).map((supplier) => [supplier.id, { name: supplier.name, truckingCostPerBottle: Number(supplier.trucking_cost_per_bottle || 0) }]));
  const candidates: ProductIdentityCandidate[] = [];
  const [catalog, products, recommendations, quickbooks, vinosmith] = await Promise.all([
    supabase.from("supplier_catalog_wines").select("*").limit(500),
    supabase.from("products").select("*").limit(500),
    supabase.from("reorder_recommendations").select("*, products(name,planning_sku,product_code,pack_size,vintage,is_core,is_btg), suppliers(name,trucking_cost_per_bottle)").order("created_at", { ascending: false }).limit(250),
    supabase.from("quickbooks_items").select("list_id,name,full_name,is_active,sales_price,purchase_cost,custom_fields,last_seen_at,time_modified").limit(500),
    supabase.from("vinosmith_wines").select("wine_id,code,name,vintage,supplier_id,importer_name,producer_name,unit_set,bottle_size,bottle_size_label,fob_price,active,orderable,core,last_seen_at,source_updated_at").limit(500)
  ]);
  if (!catalog.error) for (const row of catalog.data || []) candidates.push(supplierCatalogRowToCandidate(row));
  if (!products.error) for (const row of products.data || []) candidates.push(productRowToCandidate(row, supplierById));
  if (!recommendations.error) for (const row of recommendations.data || []) {
    const record = row as Record<string, unknown>;
    const product = record.products && typeof record.products === "object" ? record.products as Record<string, unknown> : {};
    const supplier = record.suppliers && typeof record.suppliers === "object" ? record.suppliers as Record<string, unknown> : {};
    candidates.push(recommendationRowToCandidate({ ...record, product_name: product.name, planning_sku: product.planning_sku, product_code: product.product_code, pack_size: product.pack_size, vintage: product.vintage, is_core: product.is_core, is_btg: product.is_btg, supplier_name: supplier.name, trucking_cost_per_bottle: supplier.trucking_cost_per_bottle }));
  }
  if (!quickbooks.error) for (const row of quickbooks.data || []) candidates.push(quickbooksItemRowToCandidate(row));
  if (!vinosmith.error) for (const row of vinosmith.data || []) candidates.push(vinosmithWineRowToCandidate(row));
  return candidates;
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

  const [parseResult, identityCandidates] = await Promise.all([
    parser.parse({ fileName: file.name, contentType, bytes, supplierId: supplier.id, supplierName: supplier.name, documentType: docType }),
    fetchIdentityCandidates(supabase)
  ]);

  const candidates = parseResult.rows.filter((row) => !row.isSkipped && row.fields.length > 0).map((row, index) => {
    const candidate = rowToCandidate({ supplierId: supplier.id, supplierName: supplier.name, documentType: docType, row });
    const laidInPerBottle = Number(supplier.trucking_cost_per_bottle || 0);
    const pricing = calculatePricing({ packSize: candidate.packSize, fobBottle: candidate.fob, laidInPerBottle });
    const pricingTrace = buildSupplierOfferPricingTrace({ candidate, freight: laidInPerBottle, targetGp: 0.32 });
    const validations = validateSupplierOfferCandidate({ candidate, pricingTrace });
    const matches = buildSupplierOfferMatchCandidates(candidate, identityCandidates, 3);
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
      matches
    };
  });

  return NextResponse.json({
    document: { fileName: file.name, contentType, byteSize: file.size, checksum: createHash("sha256").update(bytes).digest("hex"), documentType: docType, supplierId: supplier.id, supplierName: supplier.name },
    parse: { parserType: parseResult.parserType, parserVersion: parseResult.parserVersion, diagnostics: parseResult.diagnostics, detectedHeaders: parseResult.diagnostics.headers || parseResult.diagnostics.sheets || [] },
    rows: parseResult.rows,
    candidates
  });
}
