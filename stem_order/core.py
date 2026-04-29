"""Core ordering calculations.

This module is the stable import path for app and worker code. The existing
``wine_calculator`` module remains in place while the MVP is migrated.
"""

from wine_calculator import calculate_reorder_recommendations, normalize_planning_sku

__all__ = ["calculate_reorder_recommendations", "normalize_planning_sku"]

