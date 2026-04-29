# GRW Invoice Converter

Convert GRW sales order PDFs into completed Stem Excel templates.

This folder contains the parsing, pricing, validation, and Excel export logic used by the GRW converter utility in the WineBook repo.

## What It Does

The converter:

1. Reads a GRW PDF sales order.
2. Extracts line items from the PDF text.
3. Normalizes wine descriptions, vintage, pack size, and bottle size.
4. Applies Stem pricing rules.
5. Validates the parsed and priced output.
6. Writes the results into a GRW Excel template.

## Main Entry Points

- `grw_converter_app.py`
  - Streamlit app for manual use.
  - Best option for day-to-day operation.
- `run_test.py`
  - CLI-style test runner for the end-to-end conversion flow.
  - Useful for debugging parser/export behavior with local test files.
- `grw_converter.py`
  - Core orchestration and updated-template writer.

## Folder Layout

```text
grw_invoice_converter/
├── README.md
├── parser.py
├── pricing.py
├── validator.py
├── excel_exporter.py
├── grw_converter.py
├── run_test.py
├── templates/
│   ├── GRW_Template.xlsx
│   └── GRW_Template_Updated.xlsx
├── test_data/
│   └── S58672.pdf
└── output/
```

## How the Pipeline Works

### `parser.py`

Responsible for PDF extraction and cleanup.

- Detects line-item blocks across GRW PDF pages.
- Extracts:
  - SKU prefix like `BDX`, `BUR`, `ITY`, `USR`
  - pack size
  - quantity
  - unit price
  - vintage
  - bottle size
- Cleans noisy PDF text such as page headers, timestamps, and formatting artifacts.
- Produces a standardized item description like `Wine Name 2022 3/750ml`.

### `pricing.py`

Applies pricing rules to parsed items.

- `FOB Bottle`
  - If `pack_size > 1`, `unit_price / pack_size`
  - Otherwise `unit_price`
- `FOB Case`
  - `FOB Bottle * pack_size`
- `Frontline`
  - `BDX`: `ceil(FOB Bottle * 1.15)`
  - Non-`BDX`: `ceil(FOB Bottle * 1.15 / 1.05)`
- Also calculates `ext_cost` and `ext_price`

### `validator.py`

Checks that output is safe to export.

- Required fields are present
- No duplicate items exist
- Pack math is correct
- Pricing math is correct
- `Ext Cost` total matches the expected subtotal

### `excel_exporter.py` and `grw_converter.py`

Write the final priced rows into Excel templates.

- Preserve template structure
- Avoid formula-based circular references by writing values only
- Generate unique filenames when a collision exists

## Running the Streamlit App

From the repo root:

```bash
streamlit run grw_converter_app.py --server.port 8502
```

The app:

- accepts a GRW PDF upload
- tries to parse account name and order number from the filename first
- falls back to PDF extraction when needed
- shows a preview table
- writes the finished workbook to:

```text
~/Documents/Stem/PO's/GRW/
```

If a file with the same name already exists, it appends ` (1)`, ` (2)`, and so on.

## Running the Local Test Flow

From the repo root:

```bash
python modules/po_tools/grw_invoice_converter/run_test.py
```

Optional arguments:

```bash
python modules/po_tools/grw_invoice_converter/run_test.py \
  --pdf modules/po_tools/grw_invoice_converter/test_data/S58672.pdf \
  --template modules/po_tools/grw_invoice_converter/templates/GRW_Template.xlsx \
  --output modules/po_tools/grw_invoice_converter/output \
  --subtotal 8736.75
```

This path is mainly for development and debugging. By default it writes output into the local `output/` folder inside this module.

## Expected Inputs

- GRW sales order PDF
- Excel template from `templates/`

The Streamlit app works best when the uploaded PDF filename follows the pattern:

```text
Account Name #58672.pdf
```

That helps the app derive:

- customer/account name
- GRW order number
- output filename

## Example Output Filename

```text
Cafe Monarch GRW S58672.xlsx
```

## Notes and Caveats

- The Streamlit app and the local test runner write to different output locations.
- `extract_customer_name()` in `grw_converter.py` is still a placeholder and currently defaults to `Cafe Monarch` unless the app can infer the customer from the uploaded filename.
- Validation currently expects a known subtotal unless a different value is passed in.
- This folder contains sample test/output artifacts that are useful for debugging but are not core source code.

## Related Files Outside This Folder

- `/Users/markyaeger/Documents/stem-projects/WineBook/grw_converter_app.py`
- `/Users/markyaeger/Documents/stem-projects/WineBook/requirements.txt`

