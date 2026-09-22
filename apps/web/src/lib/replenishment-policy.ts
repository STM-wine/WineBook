export const REPLENISHMENT_POLICIES = [
  "Core",
  "Limited Core",
  "Limited",
  "Allocated",
  "Special Order"
] as const;

export type ReplenishmentPolicy = (typeof REPLENISHMENT_POLICIES)[number];
export type ReplenishmentPolicyFilter = "All" | ReplenishmentPolicy;
export const MANUAL_RECOMMENDATION_PAUSE_REASON = "Manually paused until restored";

export function replenishmentPolicyLabel(value: ReplenishmentPolicy | null | undefined) {
  return value === "Limited Core" ? "Select" : value || "Limited";
}

export function replenishmentPolicy(value: unknown): ReplenishmentPolicy {
  return REPLENISHMENT_POLICIES.includes(value as ReplenishmentPolicy)
    ? value as ReplenishmentPolicy
    : "Limited";
}

export function recommendationIsAutomatic(policy: ReplenishmentPolicy, suppressed: boolean) {
  return policySupportsAutomaticRecommendations(policy) && !suppressed;
}

export function policySupportsAutomaticRecommendations(policy: ReplenishmentPolicy) {
  return policy !== "Allocated" && policy !== "Special Order";
}

export function recommendationsAreSuppressed(
  suppressed: boolean | null | undefined,
  reason: string | null | undefined
) {
  return suppressed === true || reason === MANUAL_RECOMMENDATION_PAUSE_REASON;
}

export function replenishmentPolicyFamilyKey(name: string | null | undefined, vintage?: string | number | null) {
  let value = (name || "")
    .normalize("NFKC")
    .replace(/[’‘]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+\d+(?:\.\d+)?\s*\/\s*\d+(?:\.\d+)?\s*(?:ml|l)\s*$/i, "")
    .trim();
  const vintageText = String(vintage ?? "").trim();
  value = vintageText
    ? value.replace(new RegExp(`\\s+${escapeRegExp(vintageText)}\\s*$`, "i"), "").trim()
    : value.replace(/\s+(?:(?:19|20)\d{2}|N\.?V\.?)\s*$/i, "").trim();
  return value.replace(/\s+/g, " ").toLocaleLowerCase();
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
