import { createHash } from "crypto";
import { NextResponse } from "next/server";
import {
  buildSupplierOfferMatchCandidates,
  buildSupplierOfferPricingTrace,
  csvSupplierOfferParser,
  reviewTasksFromMatchCandidates,
  reviewTasksFromValidationResults,
  rowToCandidate,
  validateSupplierOfferCandidate,
  xlsxSupplierOfferParser,
  type SupplierOfferCandidateDraft,
  type SupplierOfferDocumentType,
  type SupplierOfferExtractedFieldDraft,
  type SupplierOfferExtractedRowDraft,
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
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const DOCUMENT_TYPES = new Set<SupplierOfferDocumentType>([
  "price_list",
  "inventory",
  "allocation",
  "closeout",
  "prearrival",
  "portfolio",
  "portal_export",
  "email_attachment",
  "unknown"
]);
const PARSERS: SupplierOfferParser[] = [csvSupplierOfferParser, xlsxSupplierOfferParser];
const MIGRATION_MESSAGE = "Supplier Offer Compiler tables are not available yet. Apply the latest Supabase migration, then reload.";

type Supabase = Awaited<ReturnType<typeof createClient>>;

type InsertedRow = { id: string; fields: SupplierOfferExtractedFieldDraft[]; draft: SupplierOfferExtractedRowDraft };

type SupplierRecord = {
  id: string | null;
  name: string;
  trucking_cost_per_bottle?: number | string | null;
  active?: boolean | null;
};

function jsonError(message: string, status = 400) {
  return NextResponse.json({ error: message }, { status });
}

function isMissingCompilerTable(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message || "").toLowerCase();
  return (
    error?.code === "PGRST205" ||
    message.includes("supplier_offer_documents") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

async function compilerTablesAvailable(supabase: Supabase) {
  const { error } = await supabase.from("supplier_offer_documents").select("id", { head: true, count: "exact" }).limit(1);
  if (!error) return true;
  if (isMissingCompilerTable(error)) return false;
  throw new Error(error.message);
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

function dateOrNull(value: string | null | undefined) {
  if (!value) return null;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.toISOString().slice(0, 10);
}

function numeric(value: unknown) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

async function requireUser(supabase: Supabase) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function fetchSupplier(supabase: Supabase, supplierId: string, supplierName: string) {
  if (isUuid(supplierId)) {
    const { data, error } = await supabase
      .from("suppliers")
      .select("id,name,trucking_cost_per_bottle,active")
      .eq("id", supplierId)
      .maybeSingle<SupplierRecord>();
    if (error) throw new Error(error.message);
    if (data) return data;
  }

  const normalizedName = supplierName.trim();
  if (!normalizedName) return null;
  const { data, error } = await supabase
    .from("suppliers")
    .select("id,name,trucking_cost_per_bottle,active")
    .ilike("name", normalizedName)
    .maybeSingle<SupplierRecord>();
  if (error) throw new Error(error.message);
  return data || { id: null, name: normalizedName, trucking_cost_per_bottle: 0, active: true };
}

async function fetchIdentityCandidates(supabase: Supabase): Promise<ProductIdentityCandidate[]> {
  const { data: suppliers } = await supabase.from("suppliers").select("id,name,trucking_cost_per_bottle").returns<SupplierRecord[]>();
  const supplierById = new Map(
    (suppliers || [])
      .filter((supplier): supplier is SupplierRecord & { id: string } => Boolean(supplier.id))
      .map((supplier) => [supplier.id, {
        name: supplier.name,
        truckingCostPerBottle: Number(supplier.trucking_cost_per_bottle || 0)
      }])
  );

  const candidates: ProductIdentityCandidate[] = [];
  const [catalog, products, recommendations, quickbooks, vinosmith] = await Promise.all([
    supabase.from("supplier_catalog_wines").select("*").limit(1000),
    supabase.from("products").select("*").limit(1000),
    supabase.from("reorder_recommendations").select("*, products(name,planning_sku,product_code,pack_size,vintage,is_core,is_btg), suppliers(name,trucking_cost_per_bottle)").order("created_at", { ascending: false }).limit(500),
    supabase.from("quickbooks_items").select("list_id,name,full_name,is_active,sales_price,purchase_cost,custom_fields,last_seen_at,time_modified").limit(1000),
    supabase.from("vinosmith_wines").select("wine_id,code,name,vintage,supplier_id,importer_name,producer_name,unit_set,bottle_size,bottle_size_label,fob_price,active,orderable,core,last_seen_at,source_updated_at").limit(1000)
  ]);

  for (const row of catalog.data || []) candidates.push(supplierCatalogRowToCandidate(row));
  for (const row of products.data || []) candidates.push(productRowToCandidate(row, supplierById));
  for (const row of recommendations.data || []) {
    const record = row as Record<string, unknown>;
    const product = record.products && typeof record.products === "object" ? record.products as Record<string, unknown> : {};
    const supplier = record.suppliers && typeof record.suppliers === "object" ? record.suppliers as Record<string, unknown> : {};
    candidates.push(recommendationRowToCandidate({
      ...record,
      product_name: product.name,
      planning_sku: product.planning_sku,
      product_code: product.product_code,
      pack_size: product.pack_size,
      vintage: product.vintage,
      is_core: product.is_core,
      is_btg: product.is_btg,
      supplier_name: supplier.name,
      trucking_cost_per_bottle: supplier.trucking_cost_per_bottle
    }));
  }
  if (!quickbooks.error) {
    for (const row of quickbooks.data || []) candidates.push(quickbooksItemRowToCandidate(row));
  }
  if (!vinosmith.error) {
    for (const row of vinosmith.data || []) candidates.push(vinosmithWineRowToCandidate(row));
  }

  return candidates;
}

function candidateInsertPayload(input: {
  documentId: string;
  parseRunId: string;
  extractedRowId: string;
  candidate: SupplierOfferCandidateDraft;
  hasBlockers: boolean;
}) {
  const { candidate } = input;
  return {
    document_id: input.documentId,
    parse_run_id: input.parseRunId,
    extracted_row_id: input.extractedRowId,
    supplier_id: candidate.supplierId,
    supplier_name: candidate.supplierName,
    document_type: candidate.documentType,
    producer: candidate.producer,
    wine_name: candidate.wineName,
    vintage: candidate.vintage,
    appellation: candidate.appellation,
    region: candidate.region,
    country: candidate.country,
    grape: candidate.grape,
    bottle_size: candidate.bottleSize,
    pack_size: candidate.packSize,
    fob: candidate.fob,
    wholesale_price: candidate.wholesalePrice,
    srp: candidate.srp,
    quantity: candidate.quantity,
    arrival_date: dateOrNull(candidate.arrivalDate),
    allocation_limit: candidate.allocationLimit,
    minimum_order: candidate.minimumOrder,
    discount: candidate.discount,
    deal_terms: candidate.dealTerms,
    notes: candidate.notes,
    candidate_status: input.hasBlockers ? "needs_review" : "reviewed",
    overall_confidence: candidate.overallConfidence,
    review_status: input.hasBlockers ? "needs_review" : "in_review",
    metadata: candidate.metadata || {}
  };
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
  if (!supplierId && !supplierName) return jsonError("Select a supplier before compiling the offer.");
  if (!supportedFile(file)) return jsonError("Only CSV and XLSX files are accepted.");
  if (file.size > MAX_FILE_BYTES) return jsonError("Supplier offer files must be 20 MB or smaller.");

  const supplier = await fetchSupplier(supabase, supplierId, supplierName);
  if (!supplier) return jsonError("Selected supplier was not found.", 404);
  if (supplier.active === false) return jsonError("Selected supplier is inactive.", 400);

  const bytes = Buffer.from(await file.arrayBuffer());
  const checksum = createHash("sha256").update(bytes).digest("hex");
  const contentType = file.type || (file.name.toLowerCase().endsWith(".csv") ? "text/csv" : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
  const parser = selectParser(file.name, contentType);
  if (!parser) return jsonError("No compiler parser is available for this file type.");

  try {
    const tablesReady = await compilerTablesAvailable(supabase);
    if (!tablesReady) return jsonError(MIGRATION_MESSAGE, 503);
  } catch (error) {
    return jsonError(error instanceof Error ? error.message : "Could not check Supplier Offer Compiler tables.", 500);
  }

  const sourceFileInsert = await supabase
    .from("source_files")
    .insert({
      source_type: "manual_upload",
      file_name: file.name,
      content_type: contentType,
      byte_size: file.size,
      checksum,
      uploaded_by: user.id,
      metadata: { compiler: "supplier_offer_compiler" }
    })
    .select("id")
    .single<{ id: string }>();

  if (sourceFileInsert.error) return jsonError(sourceFileInsert.error.message, 500);

  const documentInsert = await supabase
    .from("supplier_offer_documents")
    .insert({
      source_file_id: sourceFileInsert.data.id,
      supplier_id: supplier.id,
      supplier_name_snapshot: supplier.name,
      original_filename: file.name,
      content_type: contentType,
      byte_size: file.size,
      checksum,
      document_type: docType,
      document_type_confidence: docType === "unknown" ? 0 : 1,
      document_status: "parsing",
      uploaded_by: user.id,
      metadata: { local_upload: true }
    })
    .select("id")
    .single<{ id: string }>();

  if (documentInsert.error) return jsonError(documentInsert.error.message, 500);
  const documentId = documentInsert.data.id;

  const parseRunInsert = await supabase
    .from("supplier_offer_parse_runs")
    .insert({
      document_id: documentId,
      parser_type: file.name.toLowerCase().endsWith(".csv") ? "csv" : "xlsx",
      parser_version: "pending",
      status: "running"
    })
    .select("id")
    .single<{ id: string }>();

  if (parseRunInsert.error) return jsonError(parseRunInsert.error.message, 500);
  const parseRunId = parseRunInsert.data.id;

  try {
    const parseResult = await parser.parse({
      fileName: file.name,
      contentType,
      bytes,
      supplierId: supplier.id,
      supplierName: supplier.name,
      documentType: docType
    });

    await supabase
      .from("supplier_offer_parse_runs")
      .update({
        parser_type: parseResult.parserType,
        parser_version: parseResult.parserVersion,
        status: "completed",
        completed_at: new Date().toISOString(),
        diagnostics: parseResult.diagnostics
      })
      .eq("id", parseRunId);

    const rowPayloads = parseResult.rows.map((row) => ({
      document_id: documentId,
      parse_run_id: parseRunId,
      source_kind: row.sourceKind,
      sheet_name: row.sheetName || null,
      row_number: row.rowNumber || null,
      page_number: row.pageNumber || null,
      region_ref: row.regionRef || {},
      raw_row: row.rawRow || {},
      raw_text: row.rawText || null,
      row_confidence: row.rowConfidence,
      is_skipped: row.isSkipped || false,
      skip_reason: row.skipReason || null
    }));

    const insertedRows = rowPayloads.length
      ? await supabase.from("supplier_offer_extracted_rows").insert(rowPayloads).select("id")
      : { data: [], error: null };
    if (insertedRows.error) throw new Error(insertedRows.error.message);

    const rows: InsertedRow[] = (insertedRows.data || []).map((row, index) => ({
      id: row.id,
      fields: parseResult.rows[index]?.fields || [],
      draft: parseResult.rows[index]
    }));

    const fieldPayloads = rows.flatMap((row) => row.fields.map((field) => ({
      document_id: documentId,
      parse_run_id: parseRunId,
      extracted_row_id: row.id,
      canonical_field: field.canonicalField,
      source_header: field.sourceHeader || null,
      source_column: field.sourceColumn || null,
      source_cell_ref: field.sourceCellRef || null,
      source_page: field.evidence.pageNumber || null,
      source_region: field.evidence.region || {},
      original_value: field.originalValue || null,
      normalized_value: field.normalizedValue || null,
      data_type: field.dataType || "text",
      extraction_method: field.extractionMethod || "header_mapping",
      confidence: field.confidence,
      evidence: { ...field.evidence, documentId, parseRunId, extractedRowId: row.id }
    })));

    const insertedFields = fieldPayloads.length
      ? await supabase.from("supplier_offer_extracted_fields").insert(fieldPayloads).select("id,extracted_row_id,canonical_field,confidence")
      : { data: [], error: null };
    if (insertedFields.error) throw new Error(insertedFields.error.message);

    const fieldIdByRowAndField = new Map<string, string>();
    for (const field of insertedFields.data || []) {
      const key = `${field.extracted_row_id}:${field.canonical_field}:${Number(field.confidence).toFixed(4)}`;
      if (!fieldIdByRowAndField.has(key)) fieldIdByRowAndField.set(key, field.id);
    }

    const identityCandidates = await fetchIdentityCandidates(supabase);
    let compiledCandidates = 0;
    let blockerCount = 0;

    for (const row of rows) {
      if (row.draft.isSkipped || row.fields.length === 0) continue;
      const candidate = rowToCandidate({ supplierId: supplier.id, supplierName: supplier.name, documentType: docType, row: row.draft });
      const pricingTrace = buildSupplierOfferPricingTrace({
        candidate,
        freight: Number(supplier.trucking_cost_per_bottle || 0),
        targetGp: 0.32
      });
      const validations = validateSupplierOfferCandidate({ candidate, pricingTrace });
      const hasBlockers = validations.some((validation) => validation.severity === "blocker");
      if (hasBlockers) blockerCount += 1;

      const candidateInsert = await supabase
        .from("supplier_offer_candidates")
        .insert(candidateInsertPayload({ documentId, parseRunId, extractedRowId: row.id, candidate, hasBlockers }))
        .select("id")
        .single<{ id: string }>();
      if (candidateInsert.error) throw new Error(candidateInsert.error.message);
      const candidateId = candidateInsert.data.id;
      compiledCandidates += 1;

      const candidateFieldPayloads = candidate.fields.map((field) => {
        const fieldKey = `${row.id}:${field.canonicalField}:${Number(field.confidence).toFixed(4)}`;
        return {
          candidate_id: candidateId,
          canonical_field: field.canonicalField,
          selected_extracted_field_id: fieldIdByRowAndField.get(fieldKey) || null,
          original_value: field.originalValue || null,
          normalized_value: field.normalizedValue || null,
          final_value: field.normalizedValue || field.originalValue || null,
          confidence: field.confidence
        };
      });
      if (candidateFieldPayloads.length) {
        const { error } = await supabase.from("supplier_offer_candidate_fields").insert(candidateFieldPayloads);
        if (error) throw new Error(error.message);
      }

      const pricingInsert = await supabase.from("supplier_offer_pricing_traces").insert({
        candidate_id: candidateId,
        pricing_version: pricingTrace.pricingVersion,
        currency: pricingTrace.currency,
        fob: pricingTrace.fob,
        freight: pricingTrace.freight,
        tax: pricingTrace.tax,
        landed_cost: pricingTrace.landedCost,
        target_gp: pricingTrace.targetGp,
        raw_wholesale: pricingTrace.rawWholesale,
        rounding_rule: pricingTrace.roundingRule,
        suggested_wholesale: pricingTrace.suggestedWholesale,
        suggested_frontline: pricingTrace.suggestedFrontline,
        deal_price: pricingTrace.dealPrice,
        calculated_margin: pricingTrace.calculatedMargin,
        trace_steps: pricingTrace.traceSteps,
        warnings: pricingTrace.warnings
      }).select("id").single<{ id: string }>();
      if (pricingInsert.error) throw new Error(pricingInsert.error.message);

      if (validations.length) {
        const { error } = await supabase.from("supplier_offer_validation_results").insert(validations.map((validation) => ({
          candidate_id: candidateId,
          field_name: validation.fieldName || null,
          rule_code: validation.ruleCode,
          severity: validation.severity,
          message: validation.message,
          details: validation.details || {}
        })));
        if (error) throw new Error(error.message);
      }

      const matches = buildSupplierOfferMatchCandidates(candidate, identityCandidates);
      if (matches.length) {
        const { error } = await supabase.from("supplier_offer_match_candidates").insert(matches.map((match) => ({
          candidate_id: candidateId,
          source: match.source,
          source_id: match.sourceId,
          match_status: match.matchStatus,
          score: match.score,
          rank: match.rank,
          matched_display_name: match.matchedDisplayName,
          matched_supplier: match.matchedSupplier,
          matched_vintage: match.matchedVintage,
          matched_pack_size: match.matchedPackSize,
          matched_bottle_size: match.matchedBottleSize,
          matched_fob: match.matchedFob,
          explanation: match.explanation
        })));
        if (error) throw new Error(error.message);
      }

      const reviewTasks = [
        ...reviewTasksFromValidationResults(validations),
        ...reviewTasksFromMatchCandidates(matches),
        ...pricingTrace.warnings.map((warning) => ({
          taskType: "pricing_review" as const,
          severity: "warning" as const,
          title: warning,
          createdByRule: "pricing_trace_warning"
        }))
      ];
      if (reviewTasks.length) {
        const { error } = await supabase.from("supplier_offer_review_tasks").insert(reviewTasks.map((task) => ({
          document_id: documentId,
          candidate_id: candidateId,
          task_type: task.taskType,
          severity: task.severity,
          title: task.title,
          description: "description" in task ? task.description || null : null,
          created_by_rule: task.createdByRule || null,
          metadata: "metadata" in task ? task.metadata || {} : {}
        })));
        if (error) throw new Error(error.message);
      }
    }

    await supabase.from("supplier_offer_documents").update({
      document_status: blockerCount ? "needs_document_review" : "ready_for_review",
      updated_at: new Date().toISOString(),
      metadata: { local_upload: true, compiled_candidates: compiledCandidates, blocker_count: blockerCount }
    }).eq("id", documentId);

    await supabase.from("supplier_offer_compiler_events").insert({
      document_id: documentId,
      actor_id: user.id,
      event_type: "supplier_offer_compiled",
      details: { row_count: parseResult.rows.length, candidate_count: compiledCandidates, blocker_count: blockerCount }
    });

    return NextResponse.json({ documentId, parseRunId, rowCount: parseResult.rows.length, candidateCount: compiledCandidates, blockerCount });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Supplier offer compilation failed.";
    await supabase.from("supplier_offer_parse_runs").update({
      status: "failed",
      completed_at: new Date().toISOString(),
      error_message: message
    }).eq("id", parseRunId);
    await supabase.from("supplier_offer_documents").update({
      document_status: "failed",
      updated_at: new Date().toISOString(),
      metadata: { local_upload: true, error: message }
    }).eq("id", documentId);
    return jsonError(message, 500);
  }
}
