import { calculateGpMargin, money } from "@/lib/supplier-catalog";
import {
  SUPPLIER_OFFER_PRICING_VERSION
} from "./constants";
import type { SupplierOfferCandidateDraft, SupplierOfferPricingTraceDraft } from "./types";

export function buildSupplierOfferPricingTrace(input: {
  candidate: Pick<SupplierOfferCandidateDraft, "fob">;
  freight?: number | null;
  tax?: number | null;
  targetGp?: number | null;
  roundingRule?: string | null;
  dealPrice?: number | null;
}): SupplierOfferPricingTraceDraft {
  const fob = money(input.candidate.fob);
  const freight = money(input.freight);
  const tax = money(input.tax);
  const targetGp = Math.max(0, Math.min(0.99, Number(input.targetGp ?? 0.32)));
  const landedCost = money(fob + freight + tax);
  const rawWholesale = targetGp > 0 && landedCost > 0 ? landedCost / (1 - targetGp) : 0;
  const roundingRule = input.roundingRule || "ceil dollar";
  const suggestedWholesale = rawWholesale ? Math.ceil(rawWholesale) : 0;
  const suggestedFrontline = suggestedWholesale;
  const dealPrice = input.dealPrice === null || input.dealPrice === undefined ? null : money(input.dealPrice);
  const calculatedMargin = calculateGpMargin({
    bottlePrice: dealPrice || suggestedFrontline,
    landedBottleCost: landedCost
  });
  const warnings = calculatedMargin > 0 && calculatedMargin < 0.28 ? ["Gross profit margin is below 28%."] : [];

  return {
    pricingVersion: SUPPLIER_OFFER_PRICING_VERSION,
    currency: "USD",
    fob,
    freight,
    tax,
    landedCost,
    targetGp,
    rawWholesale: money(rawWholesale),
    roundingRule,
    suggestedWholesale,
    suggestedFrontline,
    dealPrice,
    calculatedMargin,
    warnings,
    traceSteps: [
      { label: "FOB", value: fob, source: "supplier_offer_candidate" },
      { label: "Freight", value: freight, source: "supplier_default_or_override" },
      { label: "Tax", value: tax, source: "pricing_input" },
      { label: "Landed cost", formula: "FOB + freight + tax", value: landedCost },
      { label: "Raw wholesale", formula: "landed_cost / (1 - target_gp)", value: money(rawWholesale) },
      { label: "Suggested wholesale", rule: roundingRule, value: suggestedWholesale },
      { label: "Calculated margin", formula: "(price - landed_cost) / price", value: calculatedMargin }
    ]
  };
}

