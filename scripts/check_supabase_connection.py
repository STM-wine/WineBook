"""Check Supabase credentials and create a test report_run.

Run only after a Supabase project has been created, migrations have been
applied, and SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY are set locally.
"""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.supabase_repository import SupabaseRepository


def main() -> None:
    repo = SupabaseRepository.from_env()
    run = repo.create_report_run(
        run_type="manual_upload",
        diagnostics={"connection_check": True},
    )
    repo.complete_report_run(run["id"], diagnostics={"connection_check": True, "status": "ok"})
    print(f"Supabase connection OK. Created and completed report_run {run['id']}.")
    print("If Streamlit recommendation saves fail, apply supabase/migrations/002_manual_recommendation_ingest.sql.")


if __name__ == "__main__":
    main()
