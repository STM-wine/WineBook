"""Typed ordering-logic configuration shared by workers and settings UI."""

from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime
from typing import Any


DEFAULT_MONTHLY_MODES = {
    1: ("Aggressive", 1.15),
    2: ("Aggressive", 1.15),
    3: ("Aggressive", 1.15),
    4: ("Neutral", 1.00),
    5: ("Defensive", 0.75),
    6: ("Defensive", 0.75),
    7: ("Defensive", 0.75),
    8: ("Defensive", 0.75),
    9: ("Rebuild", 1.00),
    10: ("Growth", 1.10),
    11: ("Growth", 1.10),
    12: ("Growth", 1.10),
}


@dataclass(frozen=True)
class OrderingLogicSettings:
    schema_version: int = 1
    standard_target_days: int = 15
    core_target_days: int = 30
    btg_target_days: int = 45
    monthly_mode_enabled: bool = True
    monthly_multipliers: dict[int, tuple[str, float]] = field(default_factory=lambda: dict(DEFAULT_MONTHLY_MODES))
    minimum_multiplier: float = 0.5
    maximum_multiplier: float = 1.5
    default_pack_size: int = 12
    standard_minimum_packs: int = 1
    core_round_sub_case_to_one_pack: bool = True
    btg_round_sub_case_to_one_pack: bool = True
    rounding_method: str = "ceil_pack"
    urgent_weeks_threshold: float = 4.0
    high_risk_coverage_threshold: float = 0.5
    medium_risk_coverage_threshold: float = 1.0
    supplier_eta_warning_buffer_days: int = 7
    high_volume_flag_threshold: int = 480
    recommendation_default_status: str = "rejected"

    @classmethod
    def defaults(cls) -> "OrderingLogicSettings":
        return cls()

    @classmethod
    def from_mapping(cls, values: dict[str, Any] | "OrderingLogicSettings" | None) -> "OrderingLogicSettings":
        if values is None:
            return cls.defaults()
        if isinstance(values, cls):
            return values

        defaults = cls.defaults()
        monthly_raw = values.get("monthly_multipliers", values.get("monthlyMultipliers", defaults.monthly_multipliers))
        monthly_multipliers: dict[int, tuple[str, float]] = {}
        if isinstance(monthly_raw, dict):
            for month, raw in monthly_raw.items():
                month_number = int(month)
                if isinstance(raw, dict):
                    mode = str(raw.get("mode", DEFAULT_MONTHLY_MODES.get(month_number, ("Neutral", 1.0))[0]))
                    multiplier = float(raw.get("multiplier", DEFAULT_MONTHLY_MODES.get(month_number, ("Neutral", 1.0))[1]))
                else:
                    mode = str(raw[0])
                    multiplier = float(raw[1])
                monthly_multipliers[month_number] = (mode, multiplier)

        def pick(snake: str, camel: str, fallback: Any) -> Any:
            return values.get(snake, values.get(camel, fallback))

        settings = cls(
            schema_version=int(pick("schema_version", "schemaVersion", defaults.schema_version)),
            standard_target_days=int(pick("standard_target_days", "standardTargetDays", defaults.standard_target_days)),
            core_target_days=int(pick("core_target_days", "coreTargetDays", defaults.core_target_days)),
            btg_target_days=int(pick("btg_target_days", "btgTargetDays", defaults.btg_target_days)),
            monthly_mode_enabled=bool(pick("monthly_mode_enabled", "monthlyModeEnabled", defaults.monthly_mode_enabled)),
            monthly_multipliers=monthly_multipliers or defaults.monthly_multipliers,
            minimum_multiplier=float(pick("minimum_multiplier", "minimumMultiplier", defaults.minimum_multiplier)),
            maximum_multiplier=float(pick("maximum_multiplier", "maximumMultiplier", defaults.maximum_multiplier)),
            default_pack_size=int(pick("default_pack_size", "defaultPackSize", defaults.default_pack_size)),
            standard_minimum_packs=int(pick("standard_minimum_packs", "standardMinimumPacks", defaults.standard_minimum_packs)),
            core_round_sub_case_to_one_pack=bool(
                pick("core_round_sub_case_to_one_pack", "coreRoundSubCaseToOnePack", defaults.core_round_sub_case_to_one_pack)
            ),
            btg_round_sub_case_to_one_pack=bool(
                pick("btg_round_sub_case_to_one_pack", "btgRoundSubCaseToOnePack", defaults.btg_round_sub_case_to_one_pack)
            ),
            rounding_method=str(pick("rounding_method", "roundingMethod", defaults.rounding_method)),
            urgent_weeks_threshold=float(pick("urgent_weeks_threshold", "urgentWeeksThreshold", defaults.urgent_weeks_threshold)),
            high_risk_coverage_threshold=float(
                pick("high_risk_coverage_threshold", "highRiskCoverageThreshold", defaults.high_risk_coverage_threshold)
            ),
            medium_risk_coverage_threshold=float(
                pick("medium_risk_coverage_threshold", "mediumRiskCoverageThreshold", defaults.medium_risk_coverage_threshold)
            ),
            supplier_eta_warning_buffer_days=int(
                pick("supplier_eta_warning_buffer_days", "supplierEtaWarningBufferDays", defaults.supplier_eta_warning_buffer_days)
            ),
            high_volume_flag_threshold=int(pick("high_volume_flag_threshold", "highVolumeFlagThreshold", defaults.high_volume_flag_threshold)),
            recommendation_default_status=str(
                pick("recommendation_default_status", "recommendationDefaultStatus", defaults.recommendation_default_status)
            ),
        )
        settings.validate()
        return settings

    def validate(self) -> None:
        if self.schema_version != 1:
            raise ValueError("Unsupported ordering logic schema version.")
        if min(self.standard_target_days, self.core_target_days, self.btg_target_days) <= 0:
            raise ValueError("Coverage targets must be positive day counts.")
        if self.default_pack_size <= 0:
            raise ValueError("Default pack size must be positive.")
        if self.standard_minimum_packs < 0:
            raise ValueError("Standard minimum packs cannot be negative.")
        if self.rounding_method != "ceil_pack":
            raise ValueError("Unsupported rounding method.")
        if self.minimum_multiplier <= 0 or self.maximum_multiplier < self.minimum_multiplier:
            raise ValueError("Invalid monthly multiplier bounds.")
        if set(self.monthly_multipliers.keys()) != set(range(1, 13)):
            raise ValueError("Monthly multipliers must define months 1 through 12.")
        for _mode, multiplier in self.monthly_multipliers.values():
            if multiplier < self.minimum_multiplier or multiplier > self.maximum_multiplier:
                raise ValueError("Monthly multiplier is outside the validation range.")
        if self.high_risk_coverage_threshold <= 0 or self.medium_risk_coverage_threshold < self.high_risk_coverage_threshold:
            raise ValueError("Risk coverage thresholds are invalid.")
        if self.urgent_weeks_threshold <= 0:
            raise ValueError("Urgent weeks threshold must be positive.")
        if self.recommendation_default_status != "rejected":
            raise ValueError("Recommendation default status is fixed as rejected.")

    def to_dict(self) -> dict[str, Any]:
        values = asdict(self)
        values["monthly_multipliers"] = {
            str(month): {"mode": mode, "multiplier": multiplier}
            for month, (mode, multiplier) in sorted(self.monthly_multipliers.items())
        }
        return values

    def target_days(self, is_btg: bool, is_core: bool) -> int:
        if is_btg:
            return self.btg_target_days
        if is_core:
            return self.core_target_days
        return self.standard_target_days

    def purchasing_environment_for_month(self, month: int) -> tuple[str, float]:
        if not self.monthly_mode_enabled:
            return "Neutral", 1.0
        try:
            month_number = int(month)
        except (TypeError, ValueError):
            month_number = 4
        return self.monthly_multipliers.get(month_number, ("Neutral", 1.0))


def default_ordering_logic_settings() -> dict[str, Any]:
    return OrderingLogicSettings.defaults().to_dict()


def purchasing_environment_for_month(month: int, settings: OrderingLogicSettings | None = None) -> tuple[str, float]:
    return (settings or OrderingLogicSettings.defaults()).purchasing_environment_for_month(month)


def purchasing_environment_multiplier(reference_date: datetime | None = None, settings: OrderingLogicSettings | None = None) -> float:
    if reference_date is None:
        reference_date = datetime.now()
    _, multiplier = purchasing_environment_for_month(reference_date.month, settings)
    return multiplier
