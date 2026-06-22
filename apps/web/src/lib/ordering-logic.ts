export type MonthlyMultiplier = {
  mode: string;
  multiplier: number;
};

export type OrderingLogicSettings = {
  schema_version: 1;
  standard_target_days: number;
  core_target_days: number;
  btg_target_days: number;
  monthly_mode_enabled: boolean;
  monthly_multipliers: Record<string, MonthlyMultiplier>;
  minimum_multiplier: number;
  maximum_multiplier: number;
  default_pack_size: number;
  standard_minimum_packs: number;
  core_round_sub_case_to_one_pack: boolean;
  btg_round_sub_case_to_one_pack: boolean;
  rounding_method: "ceil_pack";
  urgent_weeks_threshold: number;
  high_risk_coverage_threshold: number;
  medium_risk_coverage_threshold: number;
  supplier_eta_warning_buffer_days: number;
  high_volume_flag_threshold: number;
  recommendation_default_status: "rejected";
};

export type ConfigurationVersion = {
  id: string;
  domain: "ordering_logic";
  schema_version: number;
  version_number: number;
  status: "draft" | "pending_approval" | "published" | "rejected" | "archived";
  values: OrderingLogicSettings;
  based_on_version_id: string | null;
  proposal_summary: string | null;
  change_reason: string | null;
  created_by: string | null;
  submitted_by: string | null;
  approved_by: string | null;
  published_by: string | null;
  created_at: string;
  submitted_at: string | null;
  published_at: string | null;
  effective_at: string | null;
};

export type SettingsChangeRequest = {
  id: string;
  domain: "ordering_logic";
  requested_changes: Record<string, unknown>;
  explanation: string;
  status: "open" | "accepted" | "declined" | "implemented";
  requested_by: string;
  assigned_to: string | null;
  resulting_version_id: string | null;
  admin_response: string | null;
  created_at: string;
  resolved_at: string | null;
};

export const DEFAULT_ORDERING_LOGIC_SETTINGS: OrderingLogicSettings = {
  schema_version: 1,
  standard_target_days: 15,
  core_target_days: 30,
  btg_target_days: 45,
  monthly_mode_enabled: true,
  monthly_multipliers: {
    "1": { mode: "Aggressive", multiplier: 1.15 },
    "2": { mode: "Aggressive", multiplier: 1.15 },
    "3": { mode: "Aggressive", multiplier: 1.15 },
    "4": { mode: "Neutral", multiplier: 1 },
    "5": { mode: "Defensive", multiplier: 0.75 },
    "6": { mode: "Defensive", multiplier: 0.75 },
    "7": { mode: "Defensive", multiplier: 0.75 },
    "8": { mode: "Defensive", multiplier: 0.75 },
    "9": { mode: "Rebuild", multiplier: 1 },
    "10": { mode: "Growth", multiplier: 1.1 },
    "11": { mode: "Growth", multiplier: 1.1 },
    "12": { mode: "Growth", multiplier: 1.1 }
  },
  minimum_multiplier: 0.5,
  maximum_multiplier: 1.5,
  default_pack_size: 12,
  standard_minimum_packs: 1,
  core_round_sub_case_to_one_pack: true,
  btg_round_sub_case_to_one_pack: true,
  rounding_method: "ceil_pack",
  urgent_weeks_threshold: 4,
  high_risk_coverage_threshold: 0.5,
  medium_risk_coverage_threshold: 1,
  supplier_eta_warning_buffer_days: 7,
  high_volume_flag_threshold: 480,
  recommendation_default_status: "rejected"
};

export type OrderingLogicField = {
  key: keyof OrderingLogicSettings;
  label: string;
  unit: string;
  explanation: string;
  impact: string;
};

export const ORDERING_LOGIC_FIELD_GROUPS: Array<{ title: string; fields: OrderingLogicField[] }> = [
  {
    title: "Coverage Targets",
    fields: [
      {
        key: "standard_target_days",
        label: "Standard Target Coverage",
        unit: "days",
        explanation: "Used for items that are neither Core nor BTG.",
        impact: "Sets the demand coverage target before inventory and open orders are subtracted."
      },
      {
        key: "core_target_days",
        label: "Core Target Coverage",
        unit: "days",
        explanation: "Used for wines flagged as Core.",
        impact: "Core items can carry a longer target and may round positive sub-case needs to one pack."
      },
      {
        key: "btg_target_days",
        label: "BTG Target Coverage",
        unit: "days",
        explanation: "Used for wines flagged as BTG.",
        impact: "BTG items carry the longest target and may round positive sub-case needs to one pack."
      }
    ]
  },
  {
    title: "Purchasing Environment",
    fields: [
      {
        key: "monthly_mode_enabled",
        label: "Monthly Mode",
        unit: "",
        explanation: "Applies the published calendar-month purchasing multiplier.",
        impact: "Changes risk tolerance without changing base demand."
      },
      {
        key: "minimum_multiplier",
        label: "Minimum Multiplier",
        unit: "x",
        explanation: "Lowest allowed monthly multiplier.",
        impact: "Validation guard for admin proposals."
      },
      {
        key: "maximum_multiplier",
        label: "Maximum Multiplier",
        unit: "x",
        explanation: "Highest allowed monthly multiplier.",
        impact: "Validation guard for admin proposals."
      }
    ]
  },
  {
    title: "Minimums And Rounding",
    fields: [
      {
        key: "default_pack_size",
        label: "Default Pack Size",
        unit: "bottles",
        explanation: "Used only when source data is missing a pack size.",
        impact: "Determines case rounding when source pack data is absent."
      },
      {
        key: "standard_minimum_packs",
        label: "Standard Minimum",
        unit: "packs",
        explanation: "Positive standard recommendations below this minimum are suppressed.",
        impact: "Prevents defensive-month inventory creep on non-Core, non-BTG wines."
      },
      {
        key: "core_round_sub_case_to_one_pack",
        label: "Core Sub-Case Round Up",
        unit: "",
        explanation: "Allows positive Core needs below one pack to round to one pack.",
        impact: "Keeps important Core replenishment from disappearing."
      },
      {
        key: "btg_round_sub_case_to_one_pack",
        label: "BTG Sub-Case Round Up",
        unit: "",
        explanation: "Allows positive BTG needs below one pack to round to one pack.",
        impact: "Keeps glass-pour replenishment from disappearing."
      }
    ]
  },
  {
    title: "Risk Classifications",
    fields: [
      {
        key: "urgent_weeks_threshold",
        label: "Urgent Weeks Threshold",
        unit: "weeks",
        explanation: "Items below this many weeks on hand are marked urgent.",
        impact: "Affects UI urgency status only."
      },
      {
        key: "high_risk_coverage_threshold",
        label: "High-Risk Coverage",
        unit: "ratio",
        explanation: "Coverage below this fraction of target is High risk.",
        impact: "Affects UI risk classification only."
      },
      {
        key: "medium_risk_coverage_threshold",
        label: "Medium-Risk Coverage",
        unit: "ratio",
        explanation: "Coverage below this fraction of target is Medium risk.",
        impact: "Affects UI risk classification only."
      }
    ]
  },
  {
    title: "Operational Thresholds",
    fields: [
      {
        key: "supplier_eta_warning_buffer_days",
        label: "Supplier ETA Warning Buffer",
        unit: "days",
        explanation: "Reserved warning buffer for supplier ETA logic.",
        impact: "Stored as policy for future ETA warnings."
      },
      {
        key: "high_volume_flag_threshold",
        label: "High-Volume Flag",
        unit: "bottles",
        explanation: "Flags rows with very high 30-day sales.",
        impact: "Supports review warnings without changing default recommendation status."
      },
      {
        key: "recommendation_default_status",
        label: "Default Recommendation Status",
        unit: "",
        explanation: "Fixed as rejected.",
        impact: "The engine never auto-approves buyer orders."
      }
    ]
  }
];

export function normalizeOrderingLogicSettings(values: Partial<OrderingLogicSettings> | null | undefined): OrderingLogicSettings {
  const merged = {
    ...DEFAULT_ORDERING_LOGIC_SETTINGS,
    ...(values || {}),
    monthly_multipliers: {
      ...DEFAULT_ORDERING_LOGIC_SETTINGS.monthly_multipliers,
      ...(values?.monthly_multipliers || {})
    }
  };
  validateOrderingLogicSettings(merged);
  return merged;
}

export function validateOrderingLogicSettings(values: OrderingLogicSettings) {
  if (values.schema_version !== 1) throw new Error("Unsupported ordering logic schema version.");
  if (Math.min(values.standard_target_days, values.core_target_days, values.btg_target_days) <= 0) {
    throw new Error("Coverage targets must be positive.");
  }
  if (values.default_pack_size <= 0) throw new Error("Default pack size must be positive.");
  if (values.standard_minimum_packs < 0) throw new Error("Standard minimum packs cannot be negative.");
  if (values.rounding_method !== "ceil_pack") throw new Error("Unsupported rounding method.");
  if (values.minimum_multiplier <= 0 || values.maximum_multiplier < values.minimum_multiplier) {
    throw new Error("Invalid multiplier validation range.");
  }
  for (let month = 1; month <= 12; month += 1) {
    const entry = values.monthly_multipliers[String(month)];
    if (!entry) throw new Error("Monthly multipliers must define every month.");
    if (entry.multiplier < values.minimum_multiplier || entry.multiplier > values.maximum_multiplier) {
      throw new Error("A monthly multiplier is outside the validation range.");
    }
  }
  if (values.high_risk_coverage_threshold <= 0 || values.medium_risk_coverage_threshold < values.high_risk_coverage_threshold) {
    throw new Error("Risk coverage thresholds are invalid.");
  }
  if (values.urgent_weeks_threshold <= 0) throw new Error("Urgent weeks threshold must be positive.");
  if (values.recommendation_default_status !== "rejected") {
    throw new Error("Recommendation default status is fixed as rejected.");
  }
}

export function settingValueLabel(settings: OrderingLogicSettings, key: keyof OrderingLogicSettings) {
  const value = settings[key];
  if (typeof value === "boolean") return value ? "Enabled" : "Disabled";
  if (typeof value === "number") return Number.isInteger(value) ? value.toLocaleString() : value.toFixed(2);
  return String(value);
}
