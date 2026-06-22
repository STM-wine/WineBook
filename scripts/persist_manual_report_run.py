"""Persist a manual RB6/RADs report run to Supabase."""

from pathlib import Path
import argparse
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.pipeline import build_ordering_pipeline
from stem_order.supabase_repository import SupabaseRepository


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--rb6", default=str(ROOT / "RB6-87.xlsx"), help="RB6 inventory export path")
    parser.add_argument(
        "--rads",
        default=str(ROOT / "RADs_StemWineCompany_Bottles_Apr2025_Apr2026-4.xlsx"),
        help="RADs sales export path",
    )
    parser.add_argument("--importers", default=str(ROOT / "importers.csv"), help="Importer logistics CSV path")
    return parser.parse_args()


def main() -> None:
    args = parse_args()
    repo = SupabaseRepository.from_env()
    ordering_config = repo.get_published_configuration("ordering_logic")
    result = build_ordering_pipeline(args.rb6, args.rads, args.importers, ordering_logic_settings=ordering_config["values"])
    try:
        seeded_suppliers = repo.seed_supplier_tdm_from_recommendations(result.recommendations)
    except Exception as exc:
        seeded_suppliers = []
        print(f"warning: could not seed supplier TDM values: {exc}")
    report_run = repo.create_report_run(
        run_type="manual_upload",
        diagnostics={
            **result.diagnostics,
            "rb6_file_name": Path(args.rb6).name,
            "rads_file_name": Path(args.rads).name,
            "configuration_version_number": ordering_config["version_number"],
            "configuration_fallback_used": ordering_config["fallback_used"],
        },
        configuration_version_id=ordering_config["id"],
        configuration_snapshot=ordering_config["values"],
    )

    try:
        saved = repo.save_recommendations(report_run["id"], result.recommendations)
        repo.complete_report_run(report_run["id"], diagnostics=result.diagnostics)
    except Exception as exc:
        repo.fail_report_run(report_run["id"], str(exc))
        raise

    print(f"report_run_id: {report_run['id']}")
    print(f"recommendations_built: {len(result.recommendations)}")
    print(f"recommendations_saved: {len(saved)}")
    print(f"supplier_tdm_seeded: {len(seeded_suppliers)}")
    print(f"urgent_skus: {result.diagnostics['urgent_skus']}")
    print(f"recommended_bottles: {result.diagnostics['recommended_bottles']}")
    print(f"estimated_order_cost: ${result.diagnostics['estimated_order_cost']:,.2f}")


if __name__ == "__main__":
    main()
