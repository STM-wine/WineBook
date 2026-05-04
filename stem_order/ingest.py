"""Input normalization helpers for RB6, RADs, and importer data."""

from pathlib import Path
from typing import BinaryIO

import pandas as pd


IMPORTER_LOGISTICS_COLUMNS = [
    "importer_name_clean",
    "importer_id",
    "eta_days",
    "pick_up_location",
    "freight_forwarder",
    "order_frequency",
    "trucking_cost_per_bottle",
    "notes",
]


def clean_importer_name(name) -> str:
    """Clean importer name for deterministic matching."""
    if pd.isna(name):
        return ""
    return " ".join(str(name).lower().strip().split())


def normalize_columns(df: pd.DataFrame) -> pd.DataFrame:
    """Normalize dataframe columns safely.

    Handles MultiIndex headers, blanks, duplicates, and punctuation-heavy source
    labels from spreadsheet exports.
    """
    df = df.copy()

    if isinstance(df.columns, pd.MultiIndex):
        df.columns = [
            "_".join([str(x) for x in col if str(x) != "nan"]).strip()
            for col in df.columns
        ]

    df.columns = [str(col) for col in df.columns]
    df.columns = (
        pd.Index(df.columns)
        .str.strip()
        .str.lower()
        .str.replace(r"[^a-z0-9]+", "_", regex=True)
        .str.replace(r"_+", "_", regex=True)
        .str.strip("_")
    )

    counts = {}
    new_cols = []
    for col in df.columns:
        if col in counts:
            counts[col] += 1
            new_cols.append(f"{col}_{counts[col]}")
        else:
            counts[col] = 0
            new_cols.append(col)

    df.columns = new_cols
    return df


def _file_name(file_or_path) -> str:
    return getattr(file_or_path, "name", str(file_or_path))


def _read_tabular_file(file_or_path, header=0, nrows=None) -> pd.DataFrame:
    if hasattr(file_or_path, "seek"):
        file_or_path.seek(0)
    name = _file_name(file_or_path).lower()
    if name.endswith(".csv"):
        return pd.read_csv(file_or_path, header=header, nrows=nrows)
    return pd.read_excel(file_or_path, header=header, nrows=nrows)


def detect_rb6_header(file_or_path) -> tuple[int, pd.DataFrame | None]:
    """Detect RB6 header row dynamically by looking for inventory columns."""
    key_headers = ["importer", "description", "available", "on_order", "inventory", "name"]

    for i in range(10):
        try:
            temp_df = normalize_columns(_read_tabular_file(file_or_path, header=i))
            cols = list(temp_df.columns)
            matches = sum(1 for key in key_headers if any(key in col for col in cols))
            if matches >= 2:
                return i, temp_df
        except Exception:
            continue

    return 0, None


def normalize_rb6_dataframe(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Normalize RB6 column names and return original columns for diagnostics."""
    original_cols = list(df.columns)
    return normalize_columns(df), original_cols


def map_rb6_columns(df: pd.DataFrame) -> dict[str, str]:
    """Map normalized RB6 columns to standard field names."""
    col_map = {}

    for col in df.columns:
        if "import" in col:
            col_map["importer"] = col
            break

    for col in df.columns:
        if col == "available_inventory":
            col_map["available_inventory"] = col
            break
        if "available" in col and "inventory" in col:
            col_map["available_inventory"] = col
            break
        if "true_available" in col or "trueavailable" in col:
            col_map["available_inventory"] = col
            break

    for col in df.columns:
        if col in ["on_order", "onorder", "qty_on_order", "quantity_on_order"]:
            col_map["on_order"] = col
            break

    if "on_order" not in col_map:
        for col in df.columns:
            if col.startswith("on_order") or col.endswith("_on_order"):
                col_map["on_order"] = col
                break

    if "on_order" not in col_map:
        for col in df.columns:
            if "on_order" in col and not any(
                excluded in col
                for excluded in ["considered", "remaining", "interval", "supply", "presold", "pre_sold"]
            ):
                col_map["on_order"] = col
                break

    if "on_order" not in col_map:
        for col in df.columns:
            if "order" in col and "on" in col and not any(
                excluded in col
                for excluded in ["considered", "remaining", "interval", "supply", "presold", "pre_sold"]
            ):
                col_map["on_order"] = col
                break

    for col in df.columns:
        lowered = col.lower()
        if col in ["fob", "unit_cost", "bottle_cost", "cost"]:
            col_map["fob"] = col
            break
        if "fob" in lowered:
            col_map["fob"] = col
            break
        if "cost" in lowered and "unit" in lowered:
            col_map["fob"] = col
            break
        if "bottle" in lowered and "cost" in lowered:
            col_map["fob"] = col
            break
        if "price" in lowered and "unit" in lowered:
            col_map["fob"] = col
            break

    for col in df.columns:
        if col in ["name", "description", "wine_name"]:
            col_map["description"] = col
            break
        if "description" in col or "name" in col:
            col_map["description"] = col
            break

    return col_map


def detect_rads_header(file_or_path) -> tuple[int, pd.DataFrame | None]:
    """Detect RADs header row dynamically by looking for sales columns."""
    key_headers = ["quantity", "date", "wine", "item", "customer", "account", "invoice"]

    for i in range(15):
        try:
            temp_df = normalize_columns(_read_tabular_file(file_or_path, header=i))
            cols = list(temp_df.columns)
            matches = sum(1 for key in key_headers if any(key in col for col in cols))
            if matches >= 2:
                return i, temp_df
        except Exception:
            continue

    return 0, None


def normalize_rads_dataframe(df: pd.DataFrame) -> tuple[pd.DataFrame, list[str]]:
    """Normalize RADs column names and return original columns for diagnostics."""
    original_cols = list(df.columns)
    return normalize_columns(df), original_cols


def map_rads_columns(df: pd.DataFrame) -> dict[str, str]:
    """Map normalized RADs columns to standard fields using known aliases."""
    col_map = {}
    cols = list(df.columns)
    aliases = {
        "item_number": [
            "item_number",
            "item_no",
            "item_num",
            "sku",
            "product_code",
            "item",
            "item_number_",
            "code",
            "item_code",
        ],
        "product_name": [
            "wine_name",
            "description",
            "item_description",
            "product_name",
            "name",
            "wine",
            "product",
            "item_name",
            "wine_description",
        ],
        "quantity": [
            "quantity",
            "qty",
            "bottles",
            "bottle_qty",
            "bottle_quantity",
            "units",
            "unit_qty",
            "bottle_count",
            "bottles_qty",
        ],
        "cases": [
            "cases",
            "case_qty",
            "case_quantity",
            "qty_cases",
            "num_cases",
            "case_count",
        ],
        "date": [
            "date_mm_dd_yyyy",
            "invoice_date",
            "date",
            "transaction_date",
            "order_date",
            "sale_date",
            "invoice_date_mm_dd_yyyy",
        ],
        "account": [
            "account_name",
            "customer",
            "account",
            "customer_name",
            "customer_code",
            "account_code",
            "customer_no",
            "account_number",
        ],
    }

    for standard_field, field_aliases in aliases.items():
        for col in cols:
            if col in field_aliases:
                col_map[standard_field] = col
                break

        if standard_field not in col_map:
            for col in cols:
                for alias in field_aliases:
                    if alias in col and len(col) < len(alias) + 10:
                        col_map[standard_field] = col
                        break
                if standard_field in col_map:
                    break

    return col_map


def load_importers_csv(path: str | Path) -> tuple[pd.DataFrame, bool, str | None]:
    """Load importer logistics data and return data, loaded flag, warning."""
    path = Path(path)
    if not path.exists():
        return empty_importers_frame(), False, "importers.csv not found in project root"

    try:
        importers_data = normalize_columns(pd.read_csv(path))
        if "name" in importers_data.columns:
            importers_data = importers_data.rename(columns={"name": "importer_name"})

        required_cols = ["importer_name", "eta_days"]
        missing_cols = [col for col in required_cols if col not in importers_data.columns]
        if missing_cols:
            return (
                empty_importers_frame(),
                False,
                f"importers.csv missing required columns: {missing_cols}",
            )

        importers_data["importer_name_clean"] = importers_data["importer_name"].apply(
            clean_importer_name
        )
        return importers_data, True, None
    except Exception as exc:
        return empty_importers_frame(), False, f"Error loading importers.csv: {exc}"


def empty_importers_frame() -> pd.DataFrame:
    """Return a correctly shaped importer logistics frame with no rows."""
    return pd.DataFrame(columns=IMPORTER_LOGISTICS_COLUMNS)


__all__ = [
    "IMPORTER_LOGISTICS_COLUMNS",
    "clean_importer_name",
    "detect_rads_header",
    "detect_rb6_header",
    "empty_importers_frame",
    "load_importers_csv",
    "map_rads_columns",
    "map_rb6_columns",
    "normalize_columns",
    "normalize_rads_dataframe",
    "normalize_rb6_dataframe",
]
