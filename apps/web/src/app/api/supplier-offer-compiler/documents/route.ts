import { NextResponse } from "next/server";
import { loadImporterDefaults, mergeSupplierDefaults } from "@/lib/supplier-defaults";
import { createClient } from "@/lib/supabase/server";
import type { SupplierLogistics } from "@/lib/types";

export const runtime = "nodejs";

const MIGRATION_MESSAGE = "Supplier Offer Compiler tables are not available yet. Apply the latest Supabase migration, then reload.";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function requireUser(supabase: Supabase) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
}

function isMissingCompilerTable(error: { message?: string; code?: string } | null | undefined) {
  const message = (error?.message || "").toLowerCase();
  return (
    error?.code === "PGRST205" ||
    message.includes("supplier_offer_documents") ||
    message.includes("supplier_offer_candidates") ||
    message.includes("approved_supplier_offers") ||
    message.includes("schema cache") ||
    message.includes("could not find the table")
  );
}

async function loadSupplierLogisticsOptions(supabase: Supabase) {
  const { data, error } = await supabase
    .from("suppliers")
    .select(`
      id,
      importer_id,
      name,
      eta_days,
      pick_up_location,
      freight_forwarder,
      order_frequency,
      tdm,
      trucking_cost_per_bottle,
      notes,
      active
    `)
    .order("name", { ascending: true })
    .returns<SupplierLogistics[]>();

  if (error) throw new Error(error.message);

  const supplierDefaults = await loadImporterDefaults();
  return mergeSupplierDefaults(data || [], supplierDefaults)
    .filter((supplier) => supplier.active !== false)
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((supplier) => ({
      id: supplier.id,
      name: supplier.name,
      importer_id: supplier.importer_id,
      trucking_cost_per_bottle: supplier.trucking_cost_per_bottle,
      active: supplier.active
    }));
}

export async function GET(request: Request) {
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  let suppliers: Awaited<ReturnType<typeof loadSupplierLogisticsOptions>> = [];
  try {
    suppliers = await loadSupplierLogisticsOptions(supabase);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not load supplier logistics." }, { status: 500 });
  }

  const url = new URL(request.url);
  const requestedDocumentId = url.searchParams.get("documentId");

  const { data: documents, error: documentsError } = await supabase
    .from("supplier_offer_documents")
    .select("id,supplier_id,supplier_name_snapshot,original_filename,document_type,document_status,received_at,metadata")
    .order("received_at", { ascending: false })
    .limit(20);

  if (documentsError) {
    if (isMissingCompilerTable(documentsError)) {
      return NextResponse.json({
        suppliers,
        documents: [],
        selectedDocumentId: null,
        candidates: [],
        approvedCount: 0,
        compilerTablesAvailable: false,
        migrationMessage: MIGRATION_MESSAGE
      });
    }
    return NextResponse.json({ error: documentsError.message }, { status: 500 });
  }

  const documentId = requestedDocumentId || documents?.[0]?.id || null;
  if (!documentId) {
    return NextResponse.json({
      suppliers,
      documents: documents || [],
      selectedDocumentId: null,
      candidates: [],
      approvedCount: 0,
      compilerTablesAvailable: true
    });
  }

  const [candidatesResult, approvedResult] = await Promise.all([
    supabase
      .from("supplier_offer_candidates")
      .select(`
        *,
        candidate_fields:supplier_offer_candidate_fields(*),
        validations:supplier_offer_validation_results(*),
        pricing_traces:supplier_offer_pricing_traces(*),
        match_candidates:supplier_offer_match_candidates(*)
      `)
      .eq("document_id", documentId)
      .order("created_at", { ascending: true }),
    supabase.from("approved_supplier_offers").select("id", { count: "exact", head: true })
  ]);

  if (candidatesResult.error) {
    if (isMissingCompilerTable(candidatesResult.error)) {
      return NextResponse.json({
        suppliers,
        documents: documents || [],
        selectedDocumentId: documentId,
        candidates: [],
        approvedCount: 0,
        compilerTablesAvailable: false,
        migrationMessage: MIGRATION_MESSAGE
      });
    }
    return NextResponse.json({ error: candidatesResult.error.message }, { status: 500 });
  }
  if (approvedResult.error) {
    if (isMissingCompilerTable(approvedResult.error)) {
      return NextResponse.json({
        suppliers,
        documents: documents || [],
        selectedDocumentId: documentId,
        candidates: candidatesResult.data || [],
        approvedCount: 0,
        compilerTablesAvailable: false,
        migrationMessage: MIGRATION_MESSAGE
      });
    }
    return NextResponse.json({ error: approvedResult.error.message }, { status: 500 });
  }

  return NextResponse.json({
    suppliers,
    documents: documents || [],
    selectedDocumentId: documentId,
    candidates: candidatesResult.data || [],
    approvedCount: approvedResult.count || 0,
    compilerTablesAvailable: true
  });
}
