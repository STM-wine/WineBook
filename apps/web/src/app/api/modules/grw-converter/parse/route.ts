import { randomUUID } from "crypto";
import { spawn } from "child_process";
import { existsSync } from "fs";
import { mkdir, rm, writeFile } from "fs/promises";
import { tmpdir } from "os";
import path from "path";
import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

const MAX_FILE_BYTES = 20 * 1024 * 1024;

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

async function parseWithPython(pdfPath: string) {
  const root = repoRoot();
  const scriptPath = path.join(root, "apps", "web", "scripts", "grw_parse_pdf.py");
  const child = spawn(pythonBinary(root), [scriptPath, pdfPath], {
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
    throw new Error(stderr.trim() || `Parser exited with status ${exitCode}.`);
  }

  try {
    return JSON.parse(stdout);
  } catch {
    throw new Error("Parser returned invalid JSON.");
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

  const tempDir = path.join(tmpdir(), "stem-grw-parser", randomUUID());
  const pdfPath = path.join(tempDir, file.name.replace(/[^A-Za-z0-9_.-]/g, "_") || "invoice.pdf");

  try {
    await mkdir(tempDir, { recursive: true });
    await writeFile(pdfPath, Buffer.from(await file.arrayBuffer()));
    const payload = await parseWithPython(pdfPath);
    return NextResponse.json(payload);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not parse GRW invoice." },
      { status: 500 }
    );
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}
