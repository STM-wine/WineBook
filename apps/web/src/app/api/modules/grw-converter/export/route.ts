import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, readFile, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;
const EXPORT_FORMATS = new Set(["xlsx", "csv"]);

function repoRoot() {
  return path.resolve(process.cwd(), "../..");
}

function pythonBinary(root: string) {
  if (process.env.GRW_PYTHON_BIN) return process.env.GRW_PYTHON_BIN;
  const localVenvPython = path.join(root, "venv", "bin", "python");
  return existsSync(localVenvPython) ? localVenvPython : "python3";
}

function isPdf(file: File) {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

function contentTypeFor(format: string) {
  if (format === "csv") return "text/csv; charset=utf-8";
  return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
}

function contentDisposition(filename: string) {
  const fallback = filename.replace(/[^A-Za-z0-9_. -]/g, "_");
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(filename)}`;
}

async function exportWithPython(
  pdfPath: string,
  format: string,
  outputDir: string,
  originalFilename: string,
  itemNumbersPath: string
) {
  const root = repoRoot();
  const scriptPath = path.join(root, "apps", "web", "scripts", "grw_export_pdf.py");
  const child = spawn(pythonBinary(root), [scriptPath, pdfPath, format, outputDir, originalFilename, itemNumbersPath], {
    cwd: root,
    env: process.env
  });

  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    stdout += chunk;
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk;
  });

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.on("error", reject);
    child.on("close", resolve);
  });

  if (exitCode !== 0) {
    let errorMessage = stderr.trim() || `Export exited with status ${exitCode}.`;
    try {
      const parsed = JSON.parse(stderr);
      errorMessage = parsed.error || errorMessage;
    } catch {
      // Use the raw stderr text when the bridge did not return JSON.
    }
    throw new Error(errorMessage);
  }

  try {
    return JSON.parse(stdout) as { filename: string; path: string; format: string };
  } catch {
    throw new Error("Exporter returned invalid JSON.");
  }
}

export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user }
  } = await supabase.auth.getUser();

  if (!user) {
    return NextResponse.json({ error: "Sign in required." }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const format = (requestUrl.searchParams.get("format") || "xlsx").toLowerCase();
  if (!EXPORT_FORMATS.has(format)) {
    return NextResponse.json({ error: "Export format must be xlsx or csv." }, { status: 400 });
  }

  const formData = await request.formData().catch(() => null);
  const file = formData?.get("file");

  if (!(file instanceof File)) {
    return NextResponse.json({ error: "Upload a GRW invoice PDF." }, { status: 400 });
  }

  if (!isPdf(file)) {
    return NextResponse.json({ error: "Only PDF files are accepted." }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: "PDF must be 20 MB or smaller." }, { status: 400 });
  }

  const tempDir = path.join(tmpdir(), "stem-grw-export", randomUUID());
  const outputDir = path.join(tempDir, "outputs");
  const pdfPath = path.join(tempDir, file.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "invoice.pdf");
  const itemNumbersPath = path.join(tempDir, "item-numbers.json");

  try {
    await mkdir(outputDir, { recursive: true });
    await writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
    const itemNumbers = formData?.get("itemNumbers");
    await writeFile(itemNumbersPath, typeof itemNumbers === "string" ? itemNumbers : "[]");
    const exportResult = await exportWithPython(pdfPath, format, outputDir, file.name, itemNumbersPath);
    const exportBytes = await readFile(exportResult.path);

    return new NextResponse(new Uint8Array(exportBytes), {
      headers: {
        "Content-Disposition": contentDisposition(exportResult.filename),
        "Content-Type": contentTypeFor(format)
      }
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not export GRW invoice." },
      { status: 500 }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
