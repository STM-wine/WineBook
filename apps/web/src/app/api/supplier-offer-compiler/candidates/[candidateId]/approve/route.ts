import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

type Supabase = Awaited<ReturnType<typeof createClient>>;

async function requireUser(supabase: Supabase) {
  const {
    data: { user }
  } = await supabase.auth.getUser();
  return user;
}

export async function POST(_request: Request, context: { params: Promise<{ candidateId: string }> }) {
  const { candidateId } = await context.params;
  const supabase = await createClient();
  const user = await requireUser(supabase);
  if (!user) return NextResponse.json({ error: "Sign in required." }, { status: 401 });

  const blockers = await supabase
    .from("supplier_offer_validation_results")
    .select("id,message")
    .eq("candidate_id", candidateId)
    .eq("severity", "blocker")
    .eq("resolved", false);
  if (blockers.error) return NextResponse.json({ error: blockers.error.message }, { status: 500 });
  if ((blockers.data || []).length > 0) {
    return NextResponse.json({ error: "Resolve blocker validations before approval.", blockers: blockers.data }, { status: 400 });
  }

  const { data: candidate, error: candidateError } = await supabase
    .from("supplier_offer_candidates")
    .select("*")
    .eq("id", candidateId)
    .maybeSingle<Record<string, unknown>>();
  if (candidateError) return NextResponse.json({ error: candidateError.message }, { status: 500 });
  if (!candidate) return NextResponse.json({ error: "Candidate not found." }, { status: 404 });

  const [documentResult, pricingResult, matchResult] = await Promise.all([
    supabase
      .from("supplier_offer_documents")
      .select("id,offer_date,valid_until")
      .eq("id", String(candidate.document_id))
      .maybeSingle<Record<string, unknown>>(),
    supabase
      .from("supplier_offer_pricing_traces")
      .select("id")
      .eq("candidate_id", candidateId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle<{ id: string }>(),
    supabase
      .from("supplier_offer_match_candidates")
      .select("source,source_id,match_status,score")
      .eq("candidate_id", candidateId)
      .order("rank", { ascending: true })
      .limit(1)
      .maybeSingle<Record<string, unknown>>()
  ]);
  if (documentResult.error) return NextResponse.json({ error: documentResult.error.message }, { status: 500 });
  if (pricingResult.error) return NextResponse.json({ error: pricingResult.error.message }, { status: 500 });
  if (matchResult.error) return NextResponse.json({ error: matchResult.error.message }, { status: 500 });

  const payload = {
    candidate_id: candidateId,
    document_id: String(candidate.document_id),
    supplier_id: candidate.supplier_id || null,
    supplier_name: String(candidate.supplier_name || ""),
    producer: String(candidate.producer || ""),
    wine_name: String(candidate.wine_name || ""),
    vintage: String(candidate.vintage || "NV"),
    appellation: candidate.appellation || null,
    region: candidate.region || null,
    country: candidate.country || null,
    grape: candidate.grape || null,
    bottle_size: candidate.bottle_size || null,
    pack_size: candidate.pack_size || null,
    fob: candidate.fob || null,
    quantity: candidate.quantity || null,
    arrival_date: candidate.arrival_date || null,
    offer_date: documentResult.data?.offer_date || null,
    valid_until: documentResult.data?.valid_until || null,
    notes: candidate.notes || null,
    approved_match_source: matchResult.data?.source || null,
    approved_match_source_id: matchResult.data?.source_id || null,
    approved_pricing_trace_id: pricingResult.data?.id || null,
    approval_status: "approved",
    published_to_sales: false,
    approved_by: user.id,
    metadata: {
      approved_from: "supplier_offer_compiler_mvp",
      top_match_status: matchResult.data?.match_status || null,
      top_match_score: matchResult.data?.score || null
    }
  };

  const approved = await supabase
    .from("approved_supplier_offers")
    .insert(payload)
    .select("id")
    .single<{ id: string }>();
  if (approved.error) return NextResponse.json({ error: approved.error.message }, { status: 500 });

  await Promise.all([
    supabase.from("supplier_offer_candidates").update({ candidate_status: "approved", review_status: "approved", updated_at: new Date().toISOString() }).eq("id", candidateId),
    supabase.from("supplier_offer_review_tasks").update({ status: "resolved", resolved_by: user.id, resolved_at: new Date().toISOString(), resolution: "Candidate manually approved." }).eq("candidate_id", candidateId),
    supabase.from("supplier_offer_compiler_events").insert({
      document_id: String(candidate.document_id),
      candidate_id: candidateId,
      actor_id: user.id,
      event_type: "supplier_offer_candidate_approved",
      details: { approved_offer_id: approved.data.id }
    })
  ]);

  return NextResponse.json({ approvedOfferId: approved.data.id });
}
