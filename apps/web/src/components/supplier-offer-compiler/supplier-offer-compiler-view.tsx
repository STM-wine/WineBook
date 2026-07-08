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
type PreviewField = { canonicalField: string; sourceHeader?: string | null; originalValue?: string | null; normalizedValue?: string | null; confidence: number };
type PreviewCandidate = { previewId: string; sourceRow: { sheetName?: string | null; rowNumber?: number | null; rawRow?: Record<string, unknown>; rowConfidence: number }; displayName?: string | null; candidate: { producer?: string | null; wineName?: string | null; vintage?: string | null; bottleSize?: string | null; packSize?: number | null; fob?: number | null; quantity?: number | null; overallConfidence: number; fields: PreviewField[] }; pricingPreview?: { frontlineBottlePrice?: number | null; frontlineMargin?: number | null; bestPrice?: number | null; bestMargin?: number | null; landedBottleCost?: number | null; helper?: string | null }; pricingTrace?: PricingTrace; validations?: Array<{ severity: string; message: string; ruleCode?: string }>; matches?: MatchCandidate[] };
type PreviewPayload = { document: { fileName: string; supplierName: string; documentType: string; byteSize: number }; parse: { parserType: string; parserVersion: string; diagnostics: Record<string, unknown>; detectedHeaders: unknown }; rows: unknown[]; candidates: PreviewCandidate[] };
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


function reviewSummary(validations: Array<{ severity: string }> = []) {
  const counts = validations.reduce((summary, validation) => {
    const severity = validation.severity.toLowerCase();
    if (severity === "blocker") summary.blocker += 1;
    else if (severity === "warning") summary.warning += 1;
    else summary.info += 1;
    return summary;
  }, { blocker: 0, warning: 0, info: 0 });
  if (counts.blocker) return `Blocker ${counts.blocker}${counts.warning ? ` / Warning ${counts.warning}` : ""}`;
  if (counts.warning) return `Warning ${counts.warning}${counts.info ? ` / Info ${counts.info}` : ""}`;
  if (counts.info) return `Info ${counts.info}`;
  return "Clean";
}

function validationTooltip(validations: Array<{ severity: string; message: string; ruleCode?: string }> = []) {
  if (validations.length === 0) return "Clean: no validation findings.";
  return validations.map((validation) => {
    const rule = validation.ruleCode ? ` (${validation.ruleCode})` : "";
    return `${validation.severity}${rule}: ${validation.message}`;
  }).join("\n");
}

function reviewStatusClassName(validations: Array<{ severity: string }> = []) {
  if (validations.some((validation) => validation.severity.toLowerCase() === "blocker")) return "review-status review-status-blocker";
  if (validations.some((validation) => validation.severity.toLowerCase() === "warning")) return "review-status review-status-warning";
  if (validations.some((validation) => validation.severity.toLowerCase() === "info")) return "review-status review-status-info";
  return "review-status review-status-clean";
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
  const [selectedPreviewId, setSelectedPreviewId] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isCompiling, setIsCompiling] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewPayload | null>(null);
  const [historyMessage, setHistoryMessage] = useState<string | null>(null);

  const selectedSupplier = useMemo(() => payload.suppliers.find((supplier) => supplier.id === supplierId) || null, [payload.suppliers, supplierId]);

  const selectedCandidate = useMemo(
    () => payload.candidates.find((candidate) => candidate.id === selectedCandidateId) || payload.candidates[0] || null,
    [payload.candidates, selectedCandidateId]
  );
  const selectedPreview = useMemo(() => preview?.candidates.find((candidate) => candidate.previewId === selectedPreviewId) || preview?.candidates[0] || null, [preview, selectedPreviewId]);
  const hasRequiredInputs = Boolean(supplierId && documentType && file);
  const canCompile = hasRequiredInputs && !isCompiling;
  const compileButtonLabel = isCompiling ? "Previewing..." : hasRequiredInputs ? "Preview extraction" : "Select supplier and file";
  const compileButtonClassName = isCompiling || hasRequiredInputs ? "button" : "button button-outline";

  async function load(documentId = selectedDocumentId) {
    setIsLoading(true);
    try {
      const suffix = documentId ? `?documentId=${encodeURIComponent(documentId)}` : "";
      const response = await fetch(`/api/supplier-offer-compiler/documents${suffix}`);
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
      if (!response.ok) {
        setHistoryMessage(data.error || "Could not load supplier offer compiler data.");
        return;
      }

      setPayload(data);
      setSelectedDocumentId(data.selectedDocumentId);
      setSelectedCandidateId(data.candidates?.[0]?.id || null);
      setHistoryMessage(data.compilerTablesAvailable === false ? "Save/approval history is unavailable until compiler tables are migrated. Preview extraction still works." : null);
    } catch (error) {
      setHistoryMessage(error instanceof Error ? error.message : "Could not load supplier offer compiler data.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void load(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function previewExtraction(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage(null);
    const compileFile = file;
    if (!supplierId || !documentType || !compileFile) {
      setMessage("Select a supplier and choose a CSV or XLSX file before compiling.");
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
      const response = await fetch("/api/supplier-offer-compiler/preview", { method: "POST", body: form, signal: controller.signal });
      const contentType = response.headers.get("content-type") || "";
      const data = contentType.includes("application/json") ? await response.json() : { error: await response.text() };
      if (!response.ok) {
        setMessage(data.error || "Compile failed.");
      } else {
        setPreview(data);
        setSelectedPreviewId(data.candidates?.[0]?.previewId || null);
        setMessage(`Previewed ${data.candidates?.length || 0} candidate(s) from ${data.rows?.length || 0} row(s).`);
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") {
        setMessage("Preview timed out after 60 seconds. Try a smaller CSV/XLSX file.");
      } else {
        setMessage(error instanceof Error ? error.message : "Preview failed before the server returned a response.");
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
        <form className="settings-grid" onSubmit={previewExtraction}>
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
                setPreview(null);
                setSelectedPreviewId(null);
                if (nextFile) setMessage(`Ready to preview ${nextFile.name}.`);
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
        {message ? <p className="muted">{message}</p> : null}
        {isCompiling ? <p className="muted">Uploading and previewing. This should finish or timeout within 60 seconds.</p> : null}
      </section>


      {preview ? (
        <section className="panel">
          <div className="section-heading-row">
            <div>
              <p className="eyebrow">Extraction Preview</p>
              <h2>{preview.document.fileName}</h2>
              <p className="muted">{preview.parse.parserType} parser, {preview.rows.length} extracted row(s), {preview.candidates.length} candidate(s)</p>
            </div>
            <button className="button" disabled={payload.compilerTablesAvailable === false} type="button">
              Approve preview and save
            </button>
          </div>
          {payload.compilerTablesAvailable === false && historyMessage ? <p className="muted">{historyMessage}</p> : null}
          <div className="table-shell">
            <table>
              <thead>
                <tr><th>Display Name</th><th>Vintage</th><th>Size</th><th>Pack</th><th>FOB</th><th>Qty</th><th>FL</th><th>FL margin</th><th>Best</th><th>Best margin</th><th>Review Status</th><th>Compiler Confidence</th></tr>
              </thead>
              <tbody>
                {preview.candidates.map((item) => (
                  <tr key={item.previewId} className={item.previewId === selectedPreview?.previewId ? "selected" : ""} onClick={() => setSelectedPreviewId(item.previewId)}>
                    <td>{item.displayName || "-"}</td>
                    <td>{item.candidate.vintage || "-"}</td>
                    <td>{item.candidate.bottleSize || "-"}</td>
                    <td>{item.candidate.packSize || "-"}</td>
                    <td>{money(item.candidate.fob)}</td>
                    <td>{item.candidate.quantity || "-"}</td>
                    <td>{money(item.pricingPreview?.frontlineBottlePrice)}</td>
                    <td>{percent(item.pricingPreview?.frontlineMargin)}</td>
                    <td>{item.pricingPreview?.bestPrice ? money(item.pricingPreview.bestPrice) : "-"}</td>
                    <td>{item.pricingPreview?.bestMargin ? percent(item.pricingPreview.bestMargin) : "-"}</td>
                    <td>
                      <button
                        aria-label={validationTooltip(item.validations)}
                        className={reviewStatusClassName(item.validations)}
                        onClick={(event) => {
                          event.stopPropagation();
                          setSelectedPreviewId(item.previewId);
                        }}
                        title={validationTooltip(item.validations)}
                        type="button"
                      >
                        {reviewSummary(item.validations)}
                      </button>
                    </td>
                    <td>{Math.round(Number(item.candidate.overallConfidence || 0) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {selectedPreview ? (
            <div className="settings-grid three-column">
              <div><p className="eyebrow">Fields</p><p className="muted"><strong>Compiler Confidence</strong>: {Math.round(Number(selectedPreview.candidate.overallConfidence || 0) * 100)}%</p>{selectedPreview.candidate.fields.map((field, index) => <p key={`${field.canonicalField}-${index}`} className="muted"><strong>{field.canonicalField}</strong>: {field.originalValue || "-"} {"->"} {field.normalizedValue || "-"} ({Math.round(Number(field.confidence) * 100)}%)</p>)}</div>
              <div><p className="eyebrow">Pricing</p><p className="muted"><strong>Helper</strong>: {selectedPreview.pricingPreview?.helper || "calculatePricing"}</p><p className="muted"><strong>FL</strong>: {money(selectedPreview.pricingPreview?.frontlineBottlePrice)} ({percent(selectedPreview.pricingPreview?.frontlineMargin)})</p><p className="muted"><strong>Best</strong>: {selectedPreview.pricingPreview?.bestPrice ? money(selectedPreview.pricingPreview.bestPrice) : "-"} {selectedPreview.pricingPreview?.bestMargin ? `(${percent(selectedPreview.pricingPreview.bestMargin)})` : ""}</p><p className="eyebrow">Validation</p>{(selectedPreview.validations || []).length ? (selectedPreview.validations || []).map((validation, index) => <p key={index} className="muted"><strong>{validation.severity}</strong>{validation.ruleCode ? ` (${validation.ruleCode})` : ""}: {validation.message}</p>) : <p className="muted"><strong>Clean</strong>: no validation findings.</p>}</div>
              <div><p className="eyebrow">Source Row</p><pre className="muted">{JSON.stringify(selectedPreview.sourceRow.rawRow || {}, null, 2)}</pre></div>
            </div>
          ) : null}
        </section>
      ) : null}

      <section className="panel">
        <div className="section-heading-row">
          <div>
            <p className="eyebrow">Recent Documents</p>
            <h2>Compiled supplier offers</h2>
          </div>
          <p className="muted">Approved offers: {payload.approvedCount}</p>
        </div>
        {historyMessage ? <p className="muted">{historyMessage}</p> : null}
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
                    <td>{candidate.producer || "-"}</td><td>{candidate.wine_name || "-"}</td><td>{candidate.vintage || "-"}</td><td>{candidate.bottle_size || "-"}</td><td>{candidate.pack_size || "-"}</td><td>{money(candidate.fob)}</td><td>{candidate.quantity || "-"}</td><td>{match ? `${match.match_status} (${Math.round(Number(match.score) * 100)}%)` : "new/review"}</td><td>{money(pricing?.suggested_wholesale)}</td><td>{money(pricing?.suggested_frontline)}</td><td>{blockers.some((validation) => validation.rule_code === "margin_below_target") ? "Blocker" : percent(pricing?.calculated_margin)}</td><td>{candidate.review_status}</td><td title={validationTooltip(validations.map((validation) => ({ severity: validation.severity, message: validation.message, ruleCode: validation.rule_code })))}>{validations.length}</td>
                  </tr>
                );
              })}
              {payload.candidates.length === 0 ? <tr><td colSpan={13}>Saved compiler candidates will appear here after approval/save.</td></tr> : null}
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
            <div><p className="eyebrow">Review</p>{(selectedCandidate.match_candidates || []).slice(0, 3).map((match) => <p key={match.id} className="muted"><strong>{match.match_status}</strong>: {match.matched_display_name || "Unknown"} ({Math.round(Number(match.score) * 100)}%)</p>)}{(selectedCandidate.validations || []).map((validation) => <p key={validation.id} className="muted"><strong>{validation.severity}</strong>{validation.rule_code ? ` (${validation.rule_code})` : ""}: {validation.message}</p>)}</div>
          </div>
        </section>
      ) : null}
    </div>
  );
}
