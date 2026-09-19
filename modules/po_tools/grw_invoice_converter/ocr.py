"""OCR fallback for image-only GRW invoice PDFs."""

from __future__ import annotations

import shutil
import subprocess
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
OCR_SCRIPT = REPO_ROOT / "apps" / "web" / "scripts" / "grw_ocr_pdf.mjs"

_OCR_CACHE: dict[tuple[str, int, int], str] = {}


def _cache_key(pdf_path: Path) -> tuple[str, int, int]:
    stat = pdf_path.stat()
    return str(pdf_path.resolve()), stat.st_size, stat.st_mtime_ns


def extract_text_with_ocr(pdf_path: str | Path) -> str:
    """Render and OCR an image-only PDF using the web app's bundled OCR runtime."""
    path = Path(pdf_path)
    key = _cache_key(path)
    if key in _OCR_CACHE:
        return _OCR_CACHE[key]

    node_binary = shutil.which("node")
    if not node_binary:
        raise RuntimeError("This invoice is image-only, but the Node.js OCR runtime is unavailable.")
    if not OCR_SCRIPT.exists():
        raise RuntimeError(f"GRW OCR script not found: {OCR_SCRIPT}")

    try:
        result = subprocess.run(
            [node_binary, str(OCR_SCRIPT), str(path.resolve())],
            cwd=str(REPO_ROOT / "apps" / "web"),
            capture_output=True,
            text=True,
            check=False,
            timeout=180,
        )
    except subprocess.TimeoutExpired as exc:
        raise RuntimeError("OCR timed out while reading this invoice.") from exc
    if result.returncode != 0:
        detail = result.stderr.strip() or f"OCR exited with status {result.returncode}."
        raise RuntimeError(f"Unable to read this image-only invoice with OCR. {detail}")

    text = result.stdout.strip()
    if not text:
        raise RuntimeError("OCR completed, but no readable invoice text was found.")

    _OCR_CACHE[key] = text
    return text
