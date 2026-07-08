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
type MatchCandidate = {
  id?: string;
  source?: string;
  sourceId?: string;
  match_status?: string;
  matchStatus?: string;
  score: number;
  rank: number;
  matched_display_name?: string | null;
  matchedDisplayName?: string | null;
  matched_supplier?: string | null;
  matchedSupplier?: string | null;
  matchedVintage?: string | null;
  matchedPackSize?: number | null;
  matchedBottleSize?: string | null;
  matchedFob?: number | null;
  explanation?: Record<string, unknown> | null;
};
type PricingTrace = { id: string; suggested_wholesale?: number | null; suggested_frontline?: number | null; calculated_margin?: number | null; trace_steps?: Array<Record<string, unknown>> | null; warnings?: string[] | null };
type CandidateField = { id: string; canonical_field: string; original_value?: string | null; normalized_value?: string | null; final_value?: string | null; confidence: number; source_header?: string | null };
type PreviewField = { canonicalField: string; sourceHeader?: string | null; originalValue?: string | null; normalizedValue?: string | null; confidence: number };
type MatchDiagnostics = {
  normalizedCandidateSearchKey?: string;
  canonicalIdentityQuery?: string;
  addWineSourceMode?: string;
  addWineSourceWarning?: string | null;
  skippedMatchSources?: string[];
  addWineSourceCandidateCount?: number;
  resultCount?: number;
  topResults?: Array<{ sourceTable?: string; sourceId?: string | null; name?: string | null; score?: number; status?: string; explanation?: Record<string, unknown> }>;
  finalStatus?: string;
  finalReason?: string;
};
type PreviewCandidate = { previewId: string; sourceRow: { sheetName?: string | null; rowNumber?: number | null; rawRow?: Record<string, unknown>; rowConfidence: number }; displayName?: string | null; candidate: { producer?: string | null; wineName?: string | null; vintage?: string | null; bottleSize?: string | null; packSize?: number | null; fob?: number | null; quantity?: number | null; overallConfidence: number; fields: PreviewField[] }; pricingPreview?: { frontlineBottlePrice?: number | null; frontlineMargin?: number | null; bestPrice?: number | null; bestMargin?: number | null; landedBottleCost?: number | null; helper?: string | null }; pricingTrace?: PricingTrace; validations?: Array<{ severity: string; message: string; ruleCode?: string }>; matches?: MatchCandidate[]; matchDiagnostics?: MatchDiagnostics };
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

function topPreviewMatch(candidate: PreviewCandidate | null | undefined) {
  return [...(candidate?.matches || [])].sort((a, b) => Number(a.rank) - Number(b.rank))[0] || null;
}

function matchClassification(match: MatchCandidate | null | undefined, diagnostics?: MatchDiagnostics) {
  return String(match?.explanation?.classification || diagnostics?.finalStatus || (match ? humanizeMatchStatus(match.matchStatus || match.match_status) : "New wine"));
}

function matchDisplayName(match: MatchCandidate | null | undefined) {
  return String(match?.matchedDisplayName || match?.matched_display_name || "-");
}

function matchSourceTable(match: MatchCandidate | null | undefined) {
  return String(match?.explanation?.source_table || match?.source || "-");
}

function matchSourceLabel(match: MatchCandidate | null | undefined) {
  return String(match?.explanation?.source_label || match?.source || "-");
}

function matchSourceId(match: MatchCandidate | null | undefined) {
  return String(match?.explanation?.source_id || match?.sourceId || "-");
}

function matchReasons(match: MatchCandidate | null | undefined) {
  const reasons = match?.explanation?.reasons;
  return Array.isArray(reasons) ? reasons.map((reason) => String(reason)) : [];
}

function matchConflicts(match: MatchCandidate | null | undefined) {
  const conflicts = match?.explanation?.conflicts;
  return Array.isArray(conflicts) ? conflicts as Array<Record<string, unknown>> : [];
}

function matchExplanationList(match: MatchCandidate | null | undefined, key: string) {
  const value = match?.explanation?.[key];
  return Array.isArray(value) ? value.map((item) => String(item)) : [];
}

function matchPenalty(match: MatchCandidate | null | undefined) {
  return Number(match?.explanation?.score_penalty_applied || 0);
}

function humanizeMatchStatus(value: unknown) {
  return String(value || "No match")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
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
                <tr><th>Display Name</th><th>Vintage</th><th>Bottle Size</th><th>Pack</th><th>FOB</th><th>Qty</th><th>FL</th><th>FL margin</th><th>Best</th><th>Best margin</th><th>Match Status</th><th>Compiler Confidence</th><th>Review Status</th></tr>
              </thead>
              <tbody>
                {preview.candidates.map((item) => {
                  const match = topPreviewMatch(item);
                  return (
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
                    <td title={match ? `${matchDisplayName(match)} (${Math.round(Number(match.score) * 100)}%)` : undefined}>{matchClassification(match, item.matchDiagnostics)}</td>
                    <td>{Math.round(Number(item.candidate.overallConfidence || 0) * 100)}%</td>
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
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {selectedPreview ? (
            <div className="settings-grid three-column">
              <div><p className="eyebrow">Fields</p><p className="muted"><strong>Compiler Confidence</strong>: {Math.round(Number(selectedPreview.candidate.overallConfidence || 0) * 100)}%</p>{selectedPreview.candidate.fields.map((field, index) => <p key={`${field.canonicalField}-${index}`} className="muted"><strong>{field.canonicalField}</strong>: {field.originalValue || "-"} {"->"} {field.normalizedValue || "-"} ({Math.round(Number(field.confidence) * 100)}%)</p>)}</div>
              <div><p className="eyebrow">Pricing</p><p className="muted"><strong>Helper</strong>: {selectedPreview.pricingPreview?.helper || "calculatePricing"}</p><p className="muted"><strong>FL</strong>: {money(selectedPreview.pricingPreview?.frontlineBottlePrice)} ({percent(selectedPreview.pricingPreview?.frontlineMargin)})</p><p className="muted"><strong>Best</strong>: {selectedPreview.pricingPreview?.bestPrice ? money(selectedPreview.pricingPreview.bestPrice) : "-"} {selectedPreview.pricingPreview?.bestMargin ? `(${percent(selectedPreview.pricingPreview.bestMargin)})` : ""}</p><p className="eyebrow">Validation</p>{(selectedPreview.validations || []).length ? (selectedPreview.validations || []).map((validation, index) => <p key={index} className="muted"><strong>{validation.severity}</strong>{validation.ruleCode ? ` (${validation.ruleCode})` : ""}: {validation.message}</p>) : <p className="muted"><strong>Clean</strong>: no validation findings.</p>}</div>
              <div><p className="eyebrow">Identity Match</p>{topPreviewMatch(selectedPreview) ? <><p className="muted"><strong>Status</strong>: {matchClassification(topPreviewMatch(selectedPreview), selectedPreview.matchDiagnostics)}</p><p className="muted"><strong>Source</strong>: {matchSourceTable(topPreviewMatch(selectedPreview))} ({matchSourceLabel(topPreviewMatch(selectedPreview))})</p><p className="muted"><strong>Record</strong>: {matchDisplayName(topPreviewMatch(selectedPreview))}</p><p className="muted"><strong>Source ID</strong>: {matchSourceId(topPreviewMatch(selectedPreview))}</p><p className="muted"><strong>Match confidence</strong>: {Math.round(Number(topPreviewMatch(selectedPreview)?.score || 0) * 100)}%</p><p className="eyebrow">Explanation</p>{matchReasons(topPreviewMatch(selectedPreview)).map((reason, index) => <p key={`reason-${index}`} className="muted">{reason}</p>)}<p className="eyebrow">Conflicts</p>{matchConflicts(topPreviewMatch(selectedPreview)).length ? matchConflicts(topPreviewMatch(selectedPreview)).map((conflict, index) => <p key={`conflict-${index}`} className="muted"><strong>{String(conflict.field || "conflict")}</strong>: {String(conflict.candidateValue ?? "-")} vs {String(conflict.matchedValue ?? "-")} ({String(conflict.severity || "review")})</p>) : <p className="muted">No conflicts detected.</p>}<p className="eyebrow">Identity Tokens</p><p className="muted"><strong>Uploaded identity</strong>: {String(topPreviewMatch(selectedPreview)?.explanation?.uploaded_normalized_identity || "-")}</p><p className="muted"><strong>Matched identity</strong>: {String(topPreviewMatch(selectedPreview)?.explanation?.matched_normalized_identity || "-")}</p><p className="muted"><strong>Uploaded tokens</strong>: {matchExplanationList(topPreviewMatch(selectedPreview), "uploaded_tokens").join(", ") || "-"}</p><p className="muted"><strong>Matched tokens</strong>: {matchExplanationList(topPreviewMatch(selectedPreview), "matched_tokens").join(", ") || "-"}</p><p className="muted"><strong>Shared tokens</strong>: {matchExplanationList(topPreviewMatch(selectedPreview), "shared_tokens").join(", ") || "-"}</p><p className="muted"><strong>Uploaded-only terms</strong>: {matchExplanationList(topPreviewMatch(selectedPreview), "uploaded_only_identity_tokens").join(", ") || "-"}</p><p className="muted"><strong>Matched-only terms</strong>: {matchExplanationList(topPreviewMatch(selectedPreview), "matched_only_identity_tokens").join(", ") || "-"}</p><p className="muted"><strong>Pack comparison</strong>: {String(topPreviewMatch(selectedPreview)?.explanation?.pack_comparison ?? "-")}</p><p className="muted"><strong>Bottle comparison</strong>: {String(topPreviewMatch(selectedPreview)?.explanation?.bottle_comparison ?? "-")}</p><p className="muted"><strong>Vintage comparison</strong>: {String(topPreviewMatch(selectedPreview)?.explanation?.vintage_comparison ?? "-")}</p><p className="muted"><strong>Score penalty</strong>: {Math.round(matchPenalty(topPreviewMatch(selectedPreview)) * 100)} points</p>{matchExplanationList(topPreviewMatch(selectedPreview), "penalty_reasons").map((reason, index) => <p key={`penalty-${index}`} className="muted"><strong>Penalty</strong>: {reason}</p>)}<p className="eyebrow">Diagnostics</p><p className="muted"><strong>Canonical query</strong>: {selectedPreview.matchDiagnostics?.canonicalIdentityQuery || "-"}</p><p className="muted"><strong>Search key</strong>: {selectedPreview.matchDiagnostics?.normalizedCandidateSearchKey || "-"}</p><p className="muted"><strong>Add Wine source mode</strong>: {selectedPreview.matchDiagnostics?.addWineSourceMode || "-"}</p>{selectedPreview.matchDiagnostics?.addWineSourceWarning ? <p className="muted"><strong>Source warning</strong>: {selectedPreview.matchDiagnostics.addWineSourceWarning}</p> : null}{(selectedPreview.matchDiagnostics?.skippedMatchSources || []).length ? <p className="muted"><strong>Skipped sources</strong>: {(selectedPreview.matchDiagnostics?.skippedMatchSources || []).join("; ")}</p> : null}<p className="muted"><strong>Add Wine source candidates</strong>: {selectedPreview.matchDiagnostics?.addWineSourceCandidateCount ?? "-"}</p><p className="muted"><strong>Results returned</strong>: {selectedPreview.matchDiagnostics?.resultCount ?? 0}</p>{(selectedPreview.matchDiagnostics?.topResults || []).map((result, index) => <p key={`diagnostic-${index}`} className="muted"><strong>{String(result.sourceTable || "source")}</strong>: {result.name || "-"} {result.sourceId ? `[${result.sourceId}]` : ""} ({Math.round(Number(result.score || 0) * 100)}%) {result.status ? `- ${result.status}` : ""}</p>)}</> : <><p className="muted"><strong>{selectedPreview.matchDiagnostics?.finalStatus || "New wine"}</strong>: {selectedPreview.matchDiagnostics?.finalReason || "No strong Add Wine search result cleared the preview threshold."}</p><p className="muted"><strong>Canonical query</strong>: {selectedPreview.matchDiagnostics?.canonicalIdentityQuery || "-"}</p><p className="muted"><strong>Search key</strong>: {selectedPreview.matchDiagnostics?.normalizedCandidateSearchKey || "-"}</p><p className="muted"><strong>Add Wine source mode</strong>: {selectedPreview.matchDiagnostics?.addWineSourceMode || "-"}</p>{selectedPreview.matchDiagnostics?.addWineSourceWarning ? <p className="muted"><strong>Source warning</strong>: {selectedPreview.matchDiagnostics.addWineSourceWarning}</p> : null}{(selectedPreview.matchDiagnostics?.skippedMatchSources || []).length ? <p className="muted"><strong>Skipped sources</strong>: {(selectedPreview.matchDiagnostics?.skippedMatchSources || []).join("; ")}</p> : null}<p className="muted"><strong>Add Wine source candidates</strong>: {selectedPreview.matchDiagnostics?.addWineSourceCandidateCount ?? "-"}</p><p className="muted"><strong>Results returned</strong>: {selectedPreview.matchDiagnostics?.resultCount ?? 0}</p></>}</div>
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
