import importlib.util
from pathlib import Path

import pandas as pd


MODULE_PATH = Path(__file__).resolve().parents[1] / "scripts" / "import_replenishment_policies.py"
SPEC = importlib.util.spec_from_file_location("policy_import", MODULE_PATH)
policy_import = importlib.util.module_from_spec(SPEC)
assert SPEC.loader is not None
SPEC.loader.exec_module(policy_import)


def test_normalized_family_name_removes_vintage_and_pack():
    assert policy_import.normalized_family_name(
        "Domaine Test Blanc 2025 12/750ml", 2025
    ) == "domaine test blanc"


def test_import_matches_exact_names_and_defaults_other_active_wines_to_limited():
    frame = pd.DataFrame([
        {"Name": "Domaine Test Blanc 2024 12/750ml", "Tag": "Core"},
    ])
    wines = [
        {"id": 1, "code": "ABC000001", "name": "Domaine Test Blanc 2024 12/750ml", "vintage": 2024},
        {"id": 2, "code": "XYZ000001", "name": "Another Wine 2025 6/750ml", "vintage": 2025},
    ]

    payload, audit = policy_import.build_import(frame, wines)

    assert [row["replenishment_policy"] for row in payload] == ["Core", "Limited"]
    assert payload[0]["is_core"] is True
    assert payload[1]["is_core"] is False
    assert audit["exact_active_matches"] == 1
    assert audit["active_wines_defaulted_to_limited"] == 1


def test_core_is_the_family_default_when_an_older_vintage_is_core():
    frame = pd.DataFrame([
        {"Name": "Domaine Test Blanc 2023 12/750ml", "Tag": "Core"},
        {"Name": "Domaine Test Blanc 2025 12/750ml", "Tag": "Limited"},
    ])
    wines = [
        {"id": 1, "code": "ABC000001", "name": "Domaine Test Blanc 2023 12/750ml", "vintage": 2023},
        {"id": 2, "code": "ABC000002", "name": "Domaine Test Blanc 2025 12/750ml", "vintage": 2025},
    ]

    payload, _ = policy_import.build_import(frame, wines)

    assert {row["family_default_policy"] for row in payload} == {"Core"}
