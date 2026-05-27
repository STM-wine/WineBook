"use client";

import { ChangeEvent, DragEvent, useState } from "react";

type UploadStatus = "ready" | "selected" | "not-connected" | "invalid";

type SelectedFile = {
  name: string;
  size: number;
};

const STATUS_LABELS: Record<UploadStatus, string> = {
  ready: "Ready to upload",
  selected: "PDF selected",
  "not-connected": "Conversion not connected yet",
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

export function GrwConverterUploader() {
  const [dragActive, setDragActive] = useState(false);
  const [file, setFile] = useState<SelectedFile | null>(null);
  const [status, setStatus] = useState<UploadStatus>("ready");

  function selectFile(nextFile: File | undefined) {
    setDragActive(false);

    if (!nextFile) return;

    if (!isPdf(nextFile)) {
      setFile(null);
      setStatus("invalid");
      return;
    }

    setFile({ name: nextFile.name, size: nextFile.size });
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

  function handleConvert() {
    if (!file) return;
    setStatus("not-connected");
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
          <span className={status === "invalid" ? "status-pill status-danger" : "status-pill status-muted"}>
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

        {status === "not-connected" ? (
          <p className="grw-status-message">
            Conversion is not connected yet. Parser migration is planned for the next phase.
          </p>
        ) : null}

        <div className="grw-upload-actions">
          <button className="button" disabled={!hasValidPdf} onClick={handleConvert} type="button">
            Convert Invoice
          </button>
        </div>
      </section>

      <section className="panel grw-output-card" aria-labelledby="grw-output-title">
        <div>
          <p className="eyebrow">Outputs</p>
          <h2 id="grw-output-title">Download Outputs</h2>
        </div>
        <p className="muted">Converted Stem-ready PO import files will appear here after the parser is connected.</p>
      </section>

      <p className="grw-migration-note">
        Parser migration coming next. Current production converter remains available in Streamlit.
      </p>
    </div>
  );
}
