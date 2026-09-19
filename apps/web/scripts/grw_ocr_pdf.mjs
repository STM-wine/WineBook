#!/usr/bin/env node
/** Render an image-only PDF and emit OCR text for the Python GRW parser. */

import { spawn } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import engData from "@tesseract.js-data/eng";
import { OEM, PSM, createWorker } from "tesseract.js";

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "ignore", "pipe"] });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      reject(new Error(stderr.trim() || `${command} exited with status ${code}.`));
    });
  });
}

async function main() {
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error("Expected a PDF path argument.");

  const workDir = await mkdtemp(path.join(tmpdir(), "stem-grw-ocr-"));
  const outputPattern = path.join(workDir, "page-%03d.png");
  let worker;

  try {
    await run("gs", [
      "-q",
      "-dSAFER",
      "-dBATCH",
      "-dNOPAUSE",
      "-sDEVICE=pnggray",
      "-r250",
      `-sOutputFile=${outputPattern}`,
      pdfPath
    ]);

    const pageFiles = (await readdir(workDir))
      .filter((filename) => filename.endsWith(".png"))
      .sort();
    if (!pageFiles.length) throw new Error("Ghostscript did not render any invoice pages.");

    worker = await createWorker("eng", OEM.LSTM_ONLY, {
      cacheMethod: "none",
      gzip: engData.gzip,
      langPath: engData.langPath
    });
    await worker.setParameters({
      preserve_interword_spaces: "1",
      tessedit_pageseg_mode: PSM.SINGLE_BLOCK
    });

    const pageText = [];
    for (const filename of pageFiles) {
      const result = await worker.recognize(path.join(workDir, filename));
      pageText.push(result.data.text.trim());
    }
    process.stdout.write(pageText.join("\n\f\n"));
  } finally {
    if (worker) await worker.terminate();
    await rm(workDir, { force: true, recursive: true });
  }
}

main().catch((error) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
