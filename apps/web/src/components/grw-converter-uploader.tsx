"use client";

import { ChangeEvent, DragEvent, useState } from "react";

type UploadStatus = "ready" | "selected" | "parsing" | "success" | "failure" | "invalid";

type SelectedFile = {
  file: File;
  name: string;
  size: number;
};

type ParsedLineItem = {
  itemNumber: string;
  lineNumber: number | null;
  skuPrefix: string;
  wineName: string;
  description: string;
  rawDescription: string;
  vintage: string;
  bottleSize: string;
  pack: number;
  orderedQty: number;
  quantity: number;
  fobBottle: number;
  fobCase: number;
  extCost: number;
};

type ParseMetadata = {
  orderNumber?: string;
  pagesParsed?: number;
  pdfPageCount?: number;
  totalItems?: number;
  itemsPerPage?: Record<string, number>;
  itemNumbers?: number[];
  missingItemNumbers?: number[];
  unparsedBlocksCount?: number;
  invoiceSummary?: Record<string, string | number | null>;
};

type ParseResponse = {
  items: ParsedLineItem[];
  metadata: ParseMetadata;
};

const STATUS_LABELS: Record<UploadStatus, string> = {
  ready: "Ready to upload",
  selected: "PDF selected",
  parsing: "Parsing invoice",
  success: "Parse complete",
  failure: "Parse failed",
  invalid: "Invalid file type"
};

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) {
    return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  }

  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function formatMoney(value: number | null | undefined) {
  return `$${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2
  })}`;
}

export function GrwConverterUploader() {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [status, setStatus] = useState<UploadStatus>("ready");
  const [errorMessage, setErrorMessage] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedLineItem[]>([]);
  const [metadata, setMetadata] = useState<ParseMetadata | null>(null);

  function selectFile(nextFile: File | undefined) {
    setDragActive(false);
    setErrorMessage("");
    setParsedItems([]);
    setMetadata(null);

    if (!nextFile) return;

    if (!isPdf(nextFile)) {
      setFile(null);
      setStatus("invalid");
      return;
    }

    setFile({ file: nextFile, name: nextFile.name, size: nextFile.size });
    setStatus("selected");
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
  }

  function handleDragOver(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(true);
  }

  function handleDragLeave(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    setDragActive(false);
  }

  function handleDrop(event: DragEvent<HTMLLabelElement>) {
    event.preventDefault();
    selectFile(event.dataTransfer.files?.[0]);
  }

  async function handleConvert() {
    if (!file) return;
    setStatus("parsing");
    setErrorMessage("");
    setParsedItems([]);
    setMetadata(null);

    const formData = new FormData();
    formData.append("file", file.file);

    try {
      const response = await fetch("/api/modules/grw-converter/parse", {
        method: "POST",
        body: formData
      });
      const result = (await response.json()) as ParseResponse | { error?: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result && result.error ? result.error : "Could not parse GRW invoice.");
      }

      const parseResult = result as ParseResponse;
      setParsedItems(parseResult.items || []);
      setMetadata(parseResult.metadata || null);
      setStatus("success");
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : "Could not parse GRW invoice.");
      setStatus("failure");
    }
  }

  const hasValidPdf = Boolean(file);

  return (
    <div className="grw-converter-grid">
      <section className="panel grw-upload-card" aria-labelledby="grw-upload-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Invoice PDF</p>
            <h2 id="grw-upload-title">Upload GRW invoice</h2>
          </div>
          <span className={status === "invalid" || status === "failure" ? "status-pill status-danger" : "status-pill status-muted"}>
            {STATUS_LABELS[status]}
          </span>
        </div>

        <label
          className={dragActive ? "grw-dropzone is-dragging" : "grw-dropzone"}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            accept="application/pdf,.pdf"
            aria-label="Upload GRW invoice PDF"
            onChange={handleInputChange}
            type="file"
          />
          <span className="grw-dropzone-icon" aria-hidden="true">
            PDF
          </span>
          <strong>{file ? file.name : "Drop a GRW invoice PDF here"}</strong>
          <span>{file ? formatFileSize(file.size) : "Drag and drop, or click to choose a file."}</span>
        </label>

        {status === "invalid" ? (
          <p className="grw-status-message">Choose a PDF invoice file. Other file types are not accepted.</p>
        ) : null}

        {status === "failure" ? (
          <p className="grw-status-message grw-status-error">{errorMessage || "Could not parse GRW invoice."}</p>
        ) : null}

        {status === "success" && metadata ? (
          <div className="grw-parse-summary" aria-label="GRW parse summary">
            <div>
              <span>Order</span>
              <strong>{metadata.orderNumber || "Unknown"}</strong>
            </div>
            <div>
              <span>Pages</span>
              <strong>{metadata.pagesParsed || 0}</strong>
            </div>
            <div>
              <span>Line Items</span>
              <strong>{metadata.totalItems ?? parsedItems.length}</strong>
            </div>
            <div>
              <span>Unparsed Blocks</span>
              <strong>{metadata.unparsedBlocksCount || 0}</strong>
            </div>
          </div>
        ) : null}

        <div className="grw-upload-actions">
          <button className="button" disabled={!hasValidPdf || status === "parsing"} onClick={handleConvert} type="button">
            {status === "parsing" ? "Parsing..." : "Convert Invoice"}
          </button>
        </div>
      </section>

      <section className="panel grw-output-card" aria-labelledby="grw-output-title">
        <div>
          <p className="eyebrow">Outputs</p>
          <h2 id="grw-output-title">Download Outputs</h2>
        </div>
        <p className="muted">Excel and download generation will be added in a later phase.</p>
      </section>

      {parsedItems.length > 0 ? (
        <section className="panel grw-results-card" aria-labelledby="grw-results-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Parsed Lines</p>
              <h2 id="grw-results-title">Extracted line items</h2>
            </div>
            {metadata?.missingItemNumbers?.length ? (
              <span className="status-pill status-danger">Missing lines {metadata.missingItemNumbers.join(", ")}</span>
            ) : (
              <span className="status-pill status-good">Validated sequence</span>
            )}
          </div>

          <div className="table-shell grw-results-table-shell">
            <table>
              <thead>
                <tr>
                  <th>Item #</th>
                  <th>Wine Name</th>
                  <th>Vintage</th>
                  <th>Pack</th>
                  <th>Quantity</th>
                  <th>FOB Bottle</th>
                  <th>FOB Case</th>
                  <th>Metadata</th>
                </tr>
              </thead>
              <tbody>
                {parsedItems.map((item) => (
                  <tr key={`${item.lineNumber}-${item.description}`}>
                    <td>{item.itemNumber || "NEW"}</td>
                    <td>
                      <strong>{item.description}</strong>
                      <span>{item.wineName}</span>
                    </td>
                    <td>{item.vintage || "Unknown"}</td>
                    <td>{item.pack}</td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.fobBottle)}</td>
                    <td>{formatMoney(item.fobCase)}</td>
                    <td>
                      Line {item.lineNumber || "-"} · {item.skuPrefix || "SKU"} · {item.orderedQty} ordered · {item.bottleSize}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="grw-migration-note">
        Parser migration coming next. Current production converter remains available in Streamlit.
      </p>
    </div>
  );
}
