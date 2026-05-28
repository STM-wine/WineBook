"use client";

import { ChangeEvent, DragEvent, useRef, useState } from "react";

type UploadStatus = "ready" | "selected" | "parsing" | "success" | "failure" | "invalid";
type ExportStatus = "idle" | "exporting" | "success" | "failure";
type ExportFormat = "xlsx" | "csv";

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
  frontline: number;
  extCost: number;
  stmMarkup: number;
  extPrice: number;
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
  invoiceSummary?: InvoiceSummary;
};

type PaymentRow = {
  date?: string;
  type?: string;
  amount?: number | null;
};

type InvoiceSummary = {
  order_date?: string | null;
  subtotal?: number | null;
  sales_tax?: number | null;
  total?: number | null;
  paid_amount?: number | null;
  credit_amount?: number | null;
  credit_date?: string | null;
  balance_due?: number | null;
  payment_rows?: PaymentRow[];
};

type ParseResponse = {
  items: ParsedLineItem[];
  metadata: ParseMetadata;
};

const STATUS_LABELS: Record<UploadStatus, string> = {
  ready: "Ready to upload",
  selected: "PDF selected",
  parsing: "Loading invoice",
  success: "Invoice loaded",
  failure: "Invoice could not load",
  invalid: "Invalid file type"
};

const EXPORT_LABELS: Record<ExportStatus, string> = {
  idle: "Upload invoice first",
  exporting: "Preparing download",
  success: "Download ready",
  failure: "Export failed"
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

function formatPercent(value: number | null | undefined) {
  return `${Number(value || 0).toLocaleString("en-US", {
    maximumFractionDigits: 0,
    style: "percent"
  })}`;
}

export function GrwConverterUploader() {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [status, setStatus] = useState<UploadStatus>("ready");
  const [errorMessage, setErrorMessage] = useState("");
  const [exportStatus, setExportStatus] = useState<ExportStatus>("idle");
  const [exportErrorMessage, setExportErrorMessage] = useState("");
  const [parsedItems, setParsedItems] = useState<ParsedLineItem[]>([]);
  const [metadata, setMetadata] = useState<ParseMetadata | null>(null);
  const parseRunRef = useRef(0);

  function resetResults() {
    setErrorMessage("");
    setExportErrorMessage("");
    setExportStatus("idle");
    setParsedItems([]);
    setMetadata(null);
  }

  function selectFile(nextFile: File | undefined) {
    setDragActive(false);
    resetResults();

    if (!nextFile) return;

    if (!isPdf(nextFile)) {
      setFile(null);
      setStatus("invalid");
      return;
    }

    const selectedFile = { file: nextFile, name: nextFile.name, size: nextFile.size };
    setFile(selectedFile);
    void parseFile(selectedFile);
  }

  function handleInputChange(event: ChangeEvent<HTMLInputElement>) {
    selectFile(event.target.files?.[0]);
    event.target.value = "";
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

  async function parseFile(selectedFile: SelectedFile) {
    const parseRun = parseRunRef.current + 1;
    parseRunRef.current = parseRun;
    setStatus("parsing");
    resetResults();

    const formData = new FormData();
    formData.append("file", selectedFile.file);

    try {
      const response = await fetch("/api/modules/grw-converter/parse", {
        method: "POST",
        body: formData
      });
      const result = (await response.json()) as ParseResponse | { error?: string };

      if (!response.ok || "error" in result) {
        throw new Error("error" in result && result.error ? result.error : "Could not load GRW invoice.");
      }

      const parseResult = result as ParseResponse;
      if (parseRun !== parseRunRef.current) return;
      setParsedItems((parseResult.items || []).map((item) => ({ ...item, itemNumber: item.itemNumber || "NEW" })));
      setMetadata(parseResult.metadata || null);
      setStatus("success");
    } catch (error) {
      if (parseRun !== parseRunRef.current) return;
      setErrorMessage(error instanceof Error ? error.message : "Could not load GRW invoice.");
      setStatus("failure");
    }
  }

  async function handleDownload(format: ExportFormat) {
    if (!file || status !== "success") return;

    setExportStatus("exporting");
    setExportErrorMessage("");

    const formData = new FormData();
    formData.append("file", file.file);
    formData.append(
      "itemNumbers",
      JSON.stringify(
        parsedItems.map((item, index) => ({
          index,
          itemNumber: item.itemNumber || "NEW",
          lineNumber: item.lineNumber
        }))
      )
    );

    try {
      const response = await fetch(`/api/modules/grw-converter/export?format=${format}`, {
        method: "POST",
        body: formData
      });

      if (!response.ok) {
        const result = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(result?.error || "Could not export GRW invoice.");
      }

      const blob = await response.blob();
      const disposition = response.headers.get("Content-Disposition") || "";
      const filename =
        disposition.match(/filename\*=UTF-8''([^;]+)/)?.[1] ||
        disposition.match(/filename="([^"]+)"/)?.[1] ||
        `grw-export.${format}`;
      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = decodeURIComponent(filename);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(downloadUrl);
      setExportStatus("success");
    } catch (error) {
      setExportErrorMessage(error instanceof Error ? error.message : "Could not export GRW invoice.");
      setExportStatus("failure");
    }
  }

  function handleItemNumberChange(rowIndex: number, nextValue: string) {
    setParsedItems((currentItems) =>
      currentItems.map((item, index) => (index === rowIndex ? { ...item, itemNumber: nextValue } : item))
    );
    setExportStatus("idle");
    setExportErrorMessage("");
  }

  const hasValidPdf = Boolean(file);
  const canDownload = Boolean(file && status === "success" && parsedItems.length > 0);
  const invoiceSummary = metadata?.invoiceSummary;
  const paymentRows = invoiceSummary?.payment_rows || [];
  const hasCreditOrPayment = Boolean(
    paymentRows.length > 0 || invoiceSummary?.paid_amount || invoiceSummary?.credit_amount
  );

  return (
    <div className="grw-converter-grid">
      <section className={status === "success" ? "panel grw-upload-card is-compact" : "panel grw-upload-card"} aria-labelledby="grw-upload-title">
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

        {status === "parsing" ? (
          <p className="grw-status-message">Reading PDF, applying pricing, and preparing the preview.</p>
        ) : null}

        {status === "invalid" ? (
          <p className="grw-status-message">Choose a PDF invoice file. Other file types are not accepted.</p>
        ) : null}

        {status === "failure" ? (
          <p className="grw-status-message grw-status-error">{errorMessage || "Could not load GRW invoice."}</p>
        ) : null}

        {status === "success" && metadata ? (
          <div className="grw-parse-summary" aria-label="GRW invoice summary">
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
          </div>
        ) : null}

        {hasValidPdf && status === "selected" ? <p className="grw-status-message">Starting conversion...</p> : null}
      </section>

      {status === "success" && metadata ? (
        <section className="panel grw-summary-card" aria-labelledby="grw-summary-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Invoice Summary</p>
              <h2 id="grw-summary-title">Credits & Balance</h2>
            </div>
            <span className={hasCreditOrPayment ? "status-pill status-good" : "status-pill status-muted"}>
              {hasCreditOrPayment ? "Credit found" : "No credit/payment found"}
            </span>
          </div>

          <div className="grw-summary-grid">
            <div>
              <span>Order</span>
              <strong>{metadata.orderNumber || "Unknown"}</strong>
            </div>
            <div>
              <span>Order Date</span>
              <strong>{invoiceSummary?.order_date || "Not found"}</strong>
            </div>
            <div>
              <span>Subtotal</span>
              <strong>{formatMoney(invoiceSummary?.subtotal)}</strong>
            </div>
            <div>
              <span>Sales Tax</span>
              <strong>{formatMoney(invoiceSummary?.sales_tax)}</strong>
            </div>
            <div>
              <span>Total</span>
              <strong>{formatMoney(invoiceSummary?.total)}</strong>
            </div>
            <div>
              <span>Credit / Paid</span>
              <strong>{formatMoney(invoiceSummary?.paid_amount ?? invoiceSummary?.credit_amount)}</strong>
            </div>
            <div>
              <span>Balance Due</span>
              <strong>{formatMoney(invoiceSummary?.balance_due)}</strong>
            </div>
          </div>

          <div className="grw-payment-list" aria-label="Payment and credit rows">
            {paymentRows.length ? (
              paymentRows.map((payment, index) => (
                <div key={`${payment.date || "payment"}-${payment.type || "row"}-${index}`}>
                  <span>{payment.date || "Date not found"}</span>
                  <strong>{payment.type || "Payment"}</strong>
                  <span>{formatMoney(payment.amount)}</span>
                </div>
              ))
            ) : (
              <p className="muted">No credit/payment found.</p>
            )}
          </div>
        </section>
      ) : null}

      <section className="panel grw-output-card" aria-labelledby="grw-output-title">
        <div className="section-heading">
          <div>
            <p className="eyebrow">Outputs</p>
            <h2 id="grw-output-title">Download Outputs</h2>
          </div>
          <span className={exportStatus === "failure" ? "status-pill status-danger" : "status-pill status-muted"}>
            {EXPORT_LABELS[exportStatus]}
          </span>
        </div>
        <p className="muted">
          Export this GRW invoice as the Stem-ready workbook, or as the SaasAnt / QuickBooks CSV.
        </p>
        <div className="grw-download-actions">
          <button
            className="button"
            disabled={!canDownload || exportStatus === "exporting"}
            onClick={() => void handleDownload("xlsx")}
            type="button"
          >
            {exportStatus === "exporting" ? "Preparing..." : "Download Excel"}
          </button>
          <button
            className="ghost-button"
            disabled={!canDownload || exportStatus === "exporting"}
            onClick={() => void handleDownload("csv")}
            type="button"
          >
            Download CSV
          </button>
        </div>
        {exportStatus === "failure" ? (
          <p className="grw-status-message grw-status-error">{exportErrorMessage || "Could not export GRW invoice."}</p>
        ) : null}
      </section>

      {parsedItems.length > 0 ? (
        <section className="panel grw-results-card" aria-labelledby="grw-results-title">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Line Items</p>
              <h2 id="grw-results-title">Line items</h2>
            </div>
            {metadata?.missingItemNumbers?.length ? (
              <span className="status-pill status-danger">Missing lines {metadata.missingItemNumbers.join(", ")}</span>
            ) : (
              <span className="status-pill status-good">Lines ready</span>
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
                  <th>Frontline</th>
                  <th>Ext Cost</th>
                  <th>STM Markup</th>
                  <th>Ext Price</th>
                </tr>
              </thead>
              <tbody>
                {parsedItems.map((item, index) => (
                  <tr key={`${item.lineNumber}-${item.description}`}>
                    <td>
                      <input
                        aria-label={`Item number for ${item.description}`}
                        className="grw-item-number-input"
                        onChange={(event) => handleItemNumberChange(index, event.target.value)}
                        value={item.itemNumber}
                      />
                    </td>
                    <td>
                      <strong>{item.description}</strong>
                      <span>{item.wineName}</span>
                    </td>
                    <td>{item.vintage || "Unknown"}</td>
                    <td>{item.pack}</td>
                    <td>{item.quantity}</td>
                    <td>{formatMoney(item.fobBottle)}</td>
                    <td>{formatMoney(item.fobCase)}</td>
                    <td>{formatMoney(item.frontline)}</td>
                    <td>{formatMoney(item.extCost)}</td>
                    <td>{formatPercent(item.stmMarkup)}</td>
                    <td>{formatMoney(item.extPrice)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <p className="grw-migration-note">
        Export generation uses the existing GRW production converter logic server-side.
      </p>
    </div>
  );
}
