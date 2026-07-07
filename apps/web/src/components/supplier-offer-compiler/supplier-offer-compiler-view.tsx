"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";

type Supplier = { id: string; name: string; active?: boolean | null };
type DocumentRow = {
  id: string;
  supplier_name_snapshot: string;
  original_filename: string;
  document_type: string;
  document_status: string;
  received_at: string;
  metadata?: Record<string, unknown> | null;
};
type Validation = { id: string; severity: "blocker" | "warning" | "info"; message: string; rule_code: string; field_name?: string | null; resolved: boolean };
type MatchCandidate = { id: string; match_status: string; score: number; rank: number; matched_display_name?: string | null; matched_supplier?: string | null; explanation?: Record<string, unknown> | null };
type PricingTrace = { id: string; suggested_wholesale?: number | null; suggested_frontline?: number | null; calculated_margin?: number | null; trace_steps?: Array<Record<string, unknown>> | null; warnings?: string[] | null };
type CandidateField = { id: string; canonical_field: string; original_value?: string | null; normalized_value?: string | null; final_value?: string | null; confidence: number; source_header?: string | null };
type Candidate = {
  id: string;
  producer?: string | null;
  wine_name?: string | null;
  vintage?: string | null;
  bottle_size?: string | null;
  pack_size?: number | null;
  fob?: number | null;
  quantity?: number | null;
  review_status: string;
  candidate_status: string;
  overall_confidence: number;
  validations?: Validation[];
  match_candidates?: MatchCandidate[];
  pricing_traces?: PricingTrace[];
  candidate_fields?: CandidateField[];
};
type Payload = {
  suppliers: Supplier[];
  documents: DocumentRow[];
  selectedDocumentId: string | null;
  candidates: Candidate[];
  approvedCount: number;
  compilerTablesAvailable?: boolean;
  migrationMessage?: string | null;
};

const DOCUMENT_TYPES = ["price_list", "inventory", "allocation", "closeout", "prearrival", "portfolio", "portal_export", "unknown"];

function money(value: unknown) {
  const number = Number(value || 0);
  return number ? number.toLocaleString("en-US", { style: "currency", currency: "USD" }) : "-";
}

function percent(value: unknown) {
  const number = Number(value || 0);
  return number ? `${Math.round(number * 1000) / 10}%` : "-";
}

function newestPricing(candidate: Candidate) {
  return [...(candidate.pricing_traces || [])].sort((a, b) => String(b.id).localeCompare(String(a.id)))[0] || null;
}

function topMatch(candidate: Candidate) {
  return [...(candidate.match_candidates || [])].sort((a, b) => Number(a.rank) - Number(b.rank))[0] || null;
}

function unresolvedBlockers(candidate: Candidate) {
  return (candidate.validations || []).filter((validation) => validation.severity === "blocker" && !validation.resolved);
}

export function SupplierOfferCompilerView() {
  const [payload, setPayload] = useState<Payload>({ suppliers: [], documents: [], selectedDocumentId: null, candidates: [], approvedCount: 0 });
  const [supplierId, setSupplierId] = useState("");
  const [documentType, setDocumentType] = useState("price_list");
  const [selectedDocumentId, setSelectedDocumentId] = useState<string | null>(null);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompiling, setIsCompiling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [initializationMessage, setInitializationMessage] = useState<string | null>(null);

  const selectedSupplier = useMemo(() => payload.suppliers.find((supplier) => supplier.id === supplierId) || null, [payload.suppliers, supplierId]);

  const selectedCandidate = useMemo(
    () => payload.candidates.find((candidate) => candidate.id === selectedCandidateId) || payload.candidates[0] || null,
    [payload.candidates, selectedCandidateId]
  );
  const hasRequiredInputs = Boolean(supplierId && documentType && file);
  const canCompile = hasRequiredInputs && !isCompiling;
  const compileButtonLabel = isCompiling ? "Compiling..." : hasRequiredInputs ? "Compile" : "Select supplier and file";
  const compileButtonClassName = isCompiling || hasRequiredInputs ? "button" : "button button-outline";

  async function load(documentId = selectedDocumentId) {
    setIsLoading(true);
    try {
      const suffix = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
      const response = await fetch(`/api/supplier-offer-compiler/documents${suffix}`);
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
      if (!response.ok) {
        setInitializationMessage(data.error || "Could not load supplier offer compiler data.");
        return;
      }

      setPayload(data);
      setSelectedDocumentId(data.selectedDocumentId);
      setSelectedCandidateId(data.candidates?.[0]?.id || null);
      setInitializationMessage(data.compilerTablesAvailable === false && data.migrationMessage ? data.migrationMessage : null);
    } catch (error) {
      setInitializationMessage(error instanceof Error ? error.message : "Could not load supplier offer compiler data.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function compile(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const compileFile = file;
    if (!supplierId || !documentType || !compileFile) {
      setMessage("Select a supplier and choose a CSV or XLSX file before compiling.");
      return;
    }
    if (payload.compilerTablesAvailable === false) {
      setMessage(payload.migrationMessage || "Supplier Offer Compiler tables are not available yet. Apply the latest Supabase migration, then reload.");
      return;
    }

    setIsCompiling(true);
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort(), 60000);
    try {
      const form = new FormData();
      form.append("file", compileFile);
      form.append("supplierId", supplierId);
      form.append("supplierName", selectedSupplier?.name || "");
      form.append("documentType", documentType);
      const response = await fetch("/api/supplier-offer-compiler/compile", { method: "POST", body: form, signal: controller.signal });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
      if (!response.ok) {
        setMessage(data.error || "Compile failed.");
      } else {
        setMessage(`Compiled ${data.candidateCount} candidate(s) from ${data.rowCount} row(s).`);
        await load(data.documentId);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Compile timed out after 60 seconds. Try a smaller CSV/XLSX file, or apply/check the Supabase migration and reload.");
      } else {
        setMessage(error instanceof Error ? error.message : "Compile failed before the server returned a response.");
      }
    } finally {
      window.clearTimeout(timeoutId);
      setIsCompiling(false);
    }
  }

  async function approve(candidateId: string) {
    setMessage(null);
    const response = await fetch(`/api/supplier-offer-compiler/candidates/${candidateId}/approve`, { method: "POST" });
    const data = await response.json();
    if (!response.ok) {
      setMessage(data.error || "Approval failed.");
      return;
    }
    setMessage("Candidate approved into approved supplier offers.");
    await load(selectedDocumentId);
  }

  return (
    <div className="module-stack">
      <section className="panel">
        <form className="settings-grid" onSubmit={compile}>
          <label>
            <span>Supplier</span>
            <select value={supplierId} onChange={(event) => setSupplierId(event.target.value)} required>
              <option value="">Select supplier</option>
              {payload.suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </select>
          </label>
          <label>
            <span>Document Type</span>
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              {DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label>
            <span>Supplier File</span>
            <input
              accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
              disabled={isCompiling}
              onChange={(event) => {
                const nextFile = event.target.files?.[0] || null;
                setFile(nextFile);
                if (nextFile) setMessage(`Ready to compile ${nextFile.name}.`);
              }}
              type="file"
            />
          </label>
          <div className="form-actions">
            <button className={compileButtonClassName} disabled={!canCompile} type="submit">{compileButtonLabel}</button>
            <a className="button button-outline" href="/api/supplier-offer-compiler/export?format=csv">Export CSV</a>
            <a className="button button-outline" href="/api/supplier-offer-compiler/export?format=xlsx">Export XLSX</a>
          </div>
        </form>
        {initializationMessage ? <p className="muted">{initializationMessage}</p> : null}
        {message ? <p className="muted">{message}</p> : null}
        {isCompiling ? <p className="muted">Uploading and compiling. This should finish or timeout within 60 seconds.</p> : null}
      </section>

      <section className="panel">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Recent Documents</p>
            <h2>Compiled supplier offers</h2>
          </div>
          <p className="muted">Approved offers: {payload.approvedCount}</p>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr><th>File</th><th>Supplier</th><th>Type</th><th>Status</th><th>Received</th></tr>
            </thead>
            <tbody>
              {payload.documents.map((document) => (
                <tr key={document.id} className={document.id === selectedDocumentId ? "selected" : ""} onClick={() => void load(document.id)}>
                  <td>{document.original_filename}</td>
                  <td>{document.supplier_name_snapshot}</td>
                  <td>{document.document_type}</td>
                  <td>{document.document_status}</td>
                  <td>{new Date(document.received_at).toLocaleString()}</td>
                </tr>
              ))}
              {payload.documents.length === 0 ? <tr><td colSpan={5}>No supplier offer documents compiled yet.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Candidates</p>
            <h2>Compiled rows</h2>
          </div>
          <p className="muted">{isLoading ? "Loading..." : `${payload.candidates.length} candidate(s)`}</p>
        </div>
        <div className="table-shell">
          <table>
            <thead>
              <tr>
                <th>Producer</th><th>Wine</th><th>Vintage</th><th>Size</th><th>Pack</th><th>FOB</th><th>Qty</th><th>Match</th><th>Wholesale</th><th>Frontline</th><th>Margin</th><th>Review</th><th>Validations</th>
              </tr>
            </thead>
            <tbody>
              {payload.candidates.map((candidate) => {
                const pricing = newestPricing(candidate);
                const match = topMatch(candidate);
                const validations = candidate.validations || [];
                const blockers = unresolvedBlockers(candidate);
                return (
                  <tr key={candidate.id} className={candidate.id === selectedCandidate?.id ? "selected" : ""} onClick={() => setSelectedCandidateId(candidate.id)}>
                    <td>{candidate.producer || "-"}</td><td>{candidate.wine_name || "-"}</td><td>{candidate.vintage || "-"}</td><td>{candidate.bottle_size || "-"}</td><td>{candidate.pack_size || "-"}</td><td>{money(candidate.fob)}</td><td>{candidate.quantity || "-"}</td><td>{match ? `${match.match_status} (${Math.round(Number(match.score) * 100)}%)` : "new/review"}</td><td>{money(pricing?.suggested_wholesale)}</td><td>{money(pricing?.suggested_frontline)}</td><td>{blockers.some((validation) => validation.rule_code === "margin_below_target") ? "Blocker" : percent(pricing?.calculated_margin)}</td><td>{candidate.review_status}</td><td>{validations.length}</td>
                  </tr>
                );
              })}
              {payload.candidates.length === 0 ? <tr><td colSpan={13}>Compile a supplier file to see candidates.</td></tr> : null}
            </tbody>
          </table>
        </div>
      </section>

      {selectedCandidate ? (
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Evidence</p>
              <h2>{selectedCandidate.producer || "Unknown producer"} {selectedCandidate.wine_name || "Unnamed wine"}</h2>
            </div>
            <button className="button" disabled={unresolvedBlockers(selectedCandidate).length > 0 || selectedCandidate.review_status === "approved"} onClick={() => void approve(selectedCandidate.id)} type="button">Approve</button>
          </div>
          <div className="settings-grid three-column">
            <div><p className="eyebrow">Extraction</p>{(selectedCandidate.candidate_fields || []).map((field) => <p key={field.id} className="muted"><strong>{field.canonical_field}</strong>: {field.original_value || "-"} {"->"} {field.normalized_value || "-"} ({Math.round(Number(field.confidence) * 100)}%)</p>)}</div>
            <div><p className="eyebrow">Pricing Trace</p>{(newestPricing(selectedCandidate)?.trace_steps || []).map((step, index) => <p key={index} className="muted"><strong>{String(step.label || "Step")}</strong>: {String(step.value ?? step.formula ?? "-")}</p>)}</div>
            <div><p className="eyebrow">Review</p>{(selectedCandidate.match_candidates || []).slice(0, 3).map((match) => <p key={match.id} className="muted"><strong>{match.match_status}</strong>: {match.matched_display_name || "Unknown"} ({Math.round(Number(match.score) * 100)}%)</p>)}{(selectedCandidate.validations || []).map((validation) => <p key={validation.id} className="muted"><strong>{validation.severity}</strong>: {validation.message}</p>)}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
