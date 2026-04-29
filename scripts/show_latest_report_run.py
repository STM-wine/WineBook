"""Print a summary of the latest completed Supabase report run."""

from pathlib import Path
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))

from stem_order.supabase_repository import SupabaseRepository


def main() -> None:
    repo = SupabaseRepository.from_env()
    report_run, recommendations = repo.get_latest_recommendations(limit=1000)
    if not report_run:
        print("No completed report runs found.")
        return

    urgent = sum(1 for row in recommendations if row.get("reorder_status") == "URGENT")
    recommended_bottles = sum(row.get("recommended_qty_rounded") or 0 for row in recommendations)
    order_cost = sum(float(row.get("order_cost") or 0) for row in recommendations)

    print(f"report_run_id: {report_run['id']}")
    print(f"completed_at: {report_run.get('completed_at')}")
    print(f"rows: {len(recommendations)}")
    print(f"urgent_skus: {urgent}")
    print(f"recommended_bottles: {recommended_bottles}")
    print(f"estimated_order_cost: ${order_cost:,.2f}")
    print("top_5:")
    for row in recommendations[:5]:
        print(
            f"- {row.get('product_name')} | {row.get('supplier_name')} | "
            f"{row.get('reorder_status')} | qty {row.get('recommended_qty_rounded')}"
        )


if __name__ == "__main__":
    main()

