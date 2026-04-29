"""Run the ordering pipeline against local RB6/RADs sample exports.

This is intentionally a smoke script, not a production worker. It lets us verify
that the current MVP files still pass through the extracted ingest/core modules.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.pipeline import build_ordering_pipeline


RB6_FILE = ROOT / "RB6-87.xlsx"
RADS_FILE = ROOT / "RADs_StemWineCompany_Bottles_Apr2025_Apr2026-4.xlsx"
IMPORTERS_FILE = ROOT / "importers.csv"


def main() -> None:
    if not RB6_FILE.exists() or not RADS_FILE.exists():
        raise SystemExit("Expected RB6-87.xlsx and RADs_StemWineCompany_Bottles_Apr2025_Apr2026-4.xlsx")

    result = build_ordering_pipeline(RB6_FILE, RADS_FILE, IMPORTERS_FILE)
    recommendations = result.recommendations
    matched_importers = recommendations["eta_days"].notna().sum() if "eta_days" in recommendations else 0

    print(f"RB6 header row: {result.rb6.header_row}")
    print(f"RADs header row: {result.rads.header_row}")
    print(f"Recommendations: {len(recommendations)}")
    print(f"Urgent SKUs: {(recommendations['reorder_status'] == 'URGENT').sum()}")
    print(f"Recommended bottles: {int(recommendations['recommended_qty_rounded'].sum())}")
    print(f"Estimated order cost: ${recommendations['order_cost'].sum():,.2f}")
    if result.importers_loaded:
        print(f"Rows with matched importer ETA: {matched_importers}")
    else:
        print(f"Importer logistics not loaded: {result.importers_warning}")


if __name__ == "__main__":
    main()
