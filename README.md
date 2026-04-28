# Stem Order MVP

Developer README for Stem Wine Company internal tools.  
**Last updated:** April 2026 | **Stack:** Python 3.11 · Streamlit · pandas · openpyxl · pdfplumber

---

## Overview

Two independent Streamlit apps that handle different parts of the wine ordering workflow:

| App | Entry Point | Purpose |
|-----|-------------|---------|
| **Ordering Assistant** | `app.py` | Upload RB6/RADs reports → calculate reorder recommendations |
| **GRW Invoice Converter** | `grw_converter_app.py` | Upload GRW PDF invoice → produce completed Stem Excel template |

**These are intentionally separate apps.** Do not combine them into a single `app.py` unless Mark and Ryan have explicitly approved the merge. The future plan is a tabbed single front-end, but that work has not started.

---

## Repo Structure

```
stem-order-mvp/
├── app.py                          # Ordering Assistant (Streamlit)
├── grw_converter_app.py            # GRW Invoice Converter (Streamlit)
├── wine_calculator.py              # Core ordering logic (velocity, reorder qty, etc.)
├── importers.csv                   # Importer logistics reference data
├── requirements.txt                # Python dependencies
│
├── modules/
│   └── po_tools/
│       └── grw_invoice_converter/
│           ├── parser.py           # PDF text extraction and line item parsing
│           ├── pricing.py          # FOB, frontline, and markup calculations
│           ├── validator.py        # Data validation and error handling
│           ├── grw_converter.py    # Orchestration: parse → price → validate → write
│           ├── excel_exporter.py   # Alternate/legacy Excel export functions
│           ├── run_test.py         # Local test runner (no Streamlit)
│           ├── templates/
│           │   ├── GRW_Template.xlsx          # Legacy template (not used by app)
│           │   └── GRW_Template_Updated.xlsx  # ← Active template used by the app
│           ├── test_data/
│           │   └── S58672.pdf      # Sample invoice for local testing
│           └── output/             # Local test outputs (not production)
│
├── docs/
│   └── next_steps.md               # Earlier project notes (may be stale)
├── logo/
│   └── StemWineCoLogo.png
└── venv/                           # Local virtual environment (not committed)
```

---

## Setup

### Requirements

- Python 3.11
- All dependencies listed in `requirements.txt`

> **Note:** `requirements.txt` currently only lists `streamlit` and `pandas`. The full working dependency set also includes `openpyxl` and `pdfplumber`. Install everything with:

```bash
pip install streamlit==1.28.1 pandas==2.1.1 openpyxl pdfplumber
```

Or update `requirements.txt` to pin all four and run:

```bash
pip install -r requirements.txt
```

### First-time setup

```bash
cd /Users/markyaeger/Documents/stem-order-mvp
python3 -m venv venv
source venv/bin/activate
pip install streamlit==1.28.1 pandas==2.1.1 openpyxl pdfplumber
```

---

## Running the Apps

### Ordering Assistant

```bash
source venv/bin/activate
streamlit run app.py
```

### GRW Invoice Converter

```bash
source venv/bin/activate
streamlit run grw_converter_app.py
```

Both run on `http://localhost:8501` by default. If you need both running at once, start the second on a different port:

```bash
streamlit run grw_converter_app.py --server.port 8502
```

---

## App 1: Ordering Assistant (`app.py` + `wine_calculator.py`)

### What it does

1. Accepts uploaded files: RB6 inventory export, RADs sales history, and optionally an importer logistics CSV
2. Normalizes and matches SKUs across sources using `normalize_planning_sku()`
3. Calculates velocity, weeks on hand, and reorder quantities
4. Displays a sorted recommendation table (highest 30-day sales first)

### Required input files

| File | Source | Key columns needed |
|------|--------|--------------------|
| **RB6 inventory export** | RB6 system | `Name`/`name`, `available_inventory`, `on_order`, `fob`, `pack_size` |
| **RADs sales history** | RADs system | `Wine Name`/`wine_name`, `Quantity`/`quantity`, `Date` |
| **Importers CSV** *(optional)* | `importers.csv` in repo | `importer`, `eta_days`, `pickup_location`, etc. |

> Column names are normalized on ingest — both snake_case and title-case variants are handled. If a column is missing, the app falls back gracefully rather than crashing.

### Key business logic (do not change without Mark/Ryan approval)

- **Weekly velocity** = `last_30_day_sales / 4.345`
- **Weeks on hand** = `true_available / weekly_velocity` (blank if no recent sales)
- **Target days** by product type:
  - BTG (By The Glass): 60 days
  - Core: 45 days
  - Standard: 30 days
- **Recommended qty** = `max(0, target_qty − (true_available + on_order))`, rounded **up** to nearest full case
- **Order cost** = `recommended_qty_rounded × fob`
- Reorder status labels: `URGENT` (<4 weeks on hand), `LOW` (<target weeks), `OK`, `NO SALES`

### Output

The recommendation table is displayed in-app. A CSV export button is available.  
`raw_df` preserves numeric types for calculations; `display_df` applies string formatting for UI only — **do not use `display_df` for any downstream calculations**.

### Vintage display fix

Vintage is stored as a numeric type from the source data. Before rendering, it is converted to a plain string in `display_df` to prevent Streamlit from displaying `2,024` instead of `2024`. This conversion lives in `app.py` in the `display_df` formatting block — **do not remove it**.

---

## App 2: GRW Invoice Converter (`grw_converter_app.py`)

### What it does

1. Accepts a GRW Wine Collection Sales Order PDF
2. Parses customer name and order number from the **filename** (preferred) or PDF text (fallback)
3. Extracts all line items from the PDF
4. Applies Stem's pricing markup rules
5. Writes a completed Excel file to `~/Documents/Stem/PO's/GRW/`
6. Provides an in-browser download button for the output file

### Expected filename format for PDF uploads

```
Account Name #OrderNumber.pdf
```

Example: `Cafe Monarch #59802.pdf` → customer `Cafe Monarch`, order `S59802`

If the filename doesn't contain `#`, the app falls back to extracting from PDF content.

### Required input

- A GRW Wine Collection Sales Order PDF (single or multi-page)
- The template file must exist at:
  ```
  modules/po_tools/grw_invoice_converter/templates/GRW_Template_Updated.xlsx
  ```
  **Do not delete or rename this file.** It is the active production template.

### Output files

- Saved to: `~/Documents/Stem/PO's/GRW/`
- Filename format: `[Customer Name] GRW [Order Number].xlsx`
- Example: `Cafe Monarch GRW S59802.xlsx`
- **Files are never overwritten.** If the filename already exists, a counter suffix is appended: `(1)`, `(2)`, etc.

### Pricing rules

These are stable and validated — **do not modify without confirming with Mark.**

| SKU Prefix | Category | Frontline Formula |
|------------|----------|-------------------|
| `BDX` | Bordeaux | `ceil(FOB Bottle × 1.15)` |
| All others | Burgundy, Italy, US, etc. | `ceil(FOB Bottle × 1.15 / 1.05)` |

- `FOB Bottle` = `unit_price` (if pack = 1) or `unit_price / pack_size` (if pack > 1)
- `FOB Case` = `FOB Bottle × pack_size`
- `Ext Cost` = `FOB Bottle × quantity`
- `Ext Price` = `Frontline × quantity`
- `STM Markup %` = `15%` for BDX, `10%` for all others

### Module responsibilities

| File | Responsibility |
|------|----------------|
| `parser.py` | PDF text extraction, line item parsing, vintage/size/SKU extraction |
| `pricing.py` | All pricing calculations — single source of truth for markup logic |
| `validator.py` | Field validation, pack math checks, markup correctness checks |
| `grw_converter.py` | Orchestration + Excel write using `GRW_Template_Updated.xlsx` |
| `excel_exporter.py` | Alternate export functions (legacy/extended layouts) — not the primary path |

### Running tests locally (no Streamlit)

```bash
source venv/bin/activate
python modules/po_tools/grw_invoice_converter/run_test.py
```

This runs against `test_data/S58672.pdf` and writes output to `modules/po_tools/grw_invoice_converter/output/`.

---

## Known Implementation Details & Things Not to Break

1. **`GRW_Template_Updated.xlsx` is the active template.** `GRW_Template.xlsx` is the legacy version. The app hardcodes the `_Updated` path.

2. **PDF parsing is fragile.** `parser.py` uses regex patterns tuned to GRW's specific PDF layout. New GRW PDF formats may need pattern updates. Test with `run_test.py` before deploying changes.

3. **SKU normalization in the Ordering Assistant** strips punctuation, lowercases, and collapses whitespace. If RB6 or RADs change their naming convention, match rates will drop. Watch the debug output in the sidebar.

4. **`display_df` is UI-only.** All string formatting (vintage, currency, decimals) in `app.py` is applied to `display_df` only. `raw_df` stays numeric for any future agent/export use.

5. **Vintage is stored as `int`.** The parser returns vintage as `int` from both extraction paths. Do not store it as a raw regex string — it will display as `2,024` in Excel and Streamlit.

6. **Output files use versioned filenames.** The `(1)`, `(2)` counter logic exists in both `grw_converter_app.py` and `grw_converter.py`. Do not add logic that silently overwrites previous exports.

7. **`expected_subtotal` in `validator.py` defaults to `8736.75`** — this is the value from the original test invoice `S58672`. In the Streamlit app, the expected subtotal is dynamically calculated from the parsed items themselves, so this default does not affect production use. Don't remove the validation; just be aware of the default.

8. **`backend/` and `frontend/` directories are currently empty.** They are placeholders for a future architecture split. Do not put active code there yet.

---

## Current Limitations

- No authentication — anyone with the URL can use the app
- No cloud deployment — runs locally only
- RB6 and RADs column names must roughly match expected patterns (normalization handles variation, but not arbitrary formats)
- GRW PDF parser is tuned to GRW's current layout — a format change from GRW will require parser updates
- The Ordering Assistant does not yet write output to Excel (CSV export only)
- No Wine Needs sheet integration yet
- No automated PO creation yet

---

## Immediate Next Development Priorities

1. **Ordering Assistant Excel export** — output the recommendation table as a formatted `.xlsx`
2. **Wine Needs sheet integration** — pull in the needs/allocation sheet as a third data source
3. **PO creation/export** — generate a draft PO from approved reorder quantities
4. **UI header/logo polish** — logo centering and spacing in `app.py`
5. **Harden RB6/RADs column detection** — add explicit error messages when required columns are missing rather than silently defaulting to 0

---

## Planned Future Work (Not Started)

- **Combined tabbed front-end** — merge both apps into one Streamlit UI with tabs (`Ordering` / `GRW Converter`). **Do not do this yet.**
- **Cloud hosting** — likely Streamlit Community Cloud or a simple VPS
- **Agent integration** — `raw_df` is deliberately kept clean/numeric to support future AI agent queries over the recommendation data

---

## Suggested File Organization Going Forward

As the project grows, consider this structure:

```
stem-order-mvp/
├── apps/
│   ├── ordering_app.py         # Move app.py here
│   └── grw_converter_app.py    # Move here
├── core/
│   ├── wine_calculator.py      # Move here
│   └── sku_normalizer.py       # Extract SKU logic if it grows
├── modules/
│   └── po_tools/               # Keep as-is
├── data/
│   └── importers.csv           # Move reference data here
├── templates/                  # Consolidate all Excel templates here
└── tests/                      # Unit tests for pricing, parsing, calculations
```

For now, the flat root layout works fine. Reorganize when a second developer joins full-time.

---

## Git Workflow

```bash
# Daily work
git checkout -b feature/your-feature-name
# ... make changes ...
git add -p                        # Stage changes interactively
git commit -m "Short description of what changed and why"
git push origin feature/your-feature-name
# Open PR → review → merge to main
```

**Branch naming:**
- `feature/` — new functionality
- `fix/` — bug fixes
- `data/` — template or reference data updates

**Commit message tips:**
- Be specific: `Fix vintage displaying as 2,024 in ordering table` not `fix bug`
- One logical change per commit

**Never commit:**
- `venv/` (already in `.gitignore`)
- Actual invoice PDFs or client data
- Output Excel files from `~/Documents/Stem/PO's/GRW/`
- `.DS_Store` files (already in `.gitignore`)

---

## Quick Reference: Common Commands

```bash
# Activate environment
source venv/bin/activate

# Run Ordering Assistant
streamlit run app.py

# Run GRW Converter
streamlit run grw_converter_app.py

# Run GRW converter test (no Streamlit)
python modules/po_tools/grw_invoice_converter/run_test.py

# Install/update dependencies
pip install -r requirements.txt

# Freeze current dependencies
pip freeze > requirements.txt
```

---

*Questions? Start with Mark Yaeger. Business rule changes (velocity calc, pricing markup, target days) need Mark + Ryan sign-off before merging.*
