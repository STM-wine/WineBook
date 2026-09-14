import { describe, expect, it } from "vitest";
import {
  balancePriceLevel,
  calculateBestPrice,
  calculateGpMargin,
  calculatePricing,
  findDuplicateActivePriceLevels,
  normalizeFobCosts
} from "./supplier-catalog";

describe("production Supplier Hub pricing", () => {
  it("normalizes bottle and case FOB exactly once", () => {
    expect(normalizeFobCosts({ packSize: 12, fobCase: 240, pricingBasis: "case" })).toMatchObject({
      fobBottle: 20,
      fobCase: 240
    });
    expect(normalizeFobCosts({ packSize: 6, fobBottle: 20, fobCase: 999, pricingBasis: "bottle" })).toMatchObject({
      fobBottle: 20,
      fobCase: 120
    });
    expect(() => normalizeFobCosts({ packSize: 0, fobCase: 240 })).toThrow(/Pack size/);
    expect(() => normalizeFobCosts({ packSize: 2.5, fobCase: 240 })).toThrow(/Pack size/);
    expect(() => normalizeFobCosts({ packSize: Number.NaN, fobCase: 240 })).toThrow(/Pack size/);
  });

  it("applies the Best ladder at the Frontline boundaries", () => {
    expect(calculateBestPrice(19)).toBe(18);
    expect(calculateBestPrice(20)).toBe(18);
    expect(calculateBestPrice(49)).toBe(47);
    expect(calculateBestPrice(50)).toBeNull();
  });

  it("matches the canonical $22 landed-cost example", () => {
    const result = calculatePricing({ packSize: 12, fobBottle: 20, laidInPerBottle: 2, pricingBasis: "bottle" });
    expect(result.frontlineBottlePrice).toBe(33);
    expect(result.bestPrice).toBe(31);
    expect(result.grossProfitMargin).toBe(0.3333);
    expect(calculateGpMargin({ bottlePrice: result.bestPrice, landedBottleCost: 22 })).toBe(0.2903);
  });

  it("keeps the ladder and flags Best below its 30% target", () => {
    const result = calculatePricing({ packSize: 12, fobBottle: 13, laidInPerBottle: 0, pricingBasis: "bottle" });
    expect(result.frontlineBottlePrice).toBe(19.25);
    expect(result.bestPrice).toBe(18.25);
    expect(calculateGpMargin({ bottlePrice: result.bestPrice, landedBottleCost: 13 })).toBeGreaterThanOrEqual(0.28);
    expect(result.diagnostics.best_target_conflict).toBe(true);
    expect(result.warnings).toContain("Best ladder price is below the 30% target GP.");
  });

  it("rounds sub-$20 Frontline upward to a quarter and uses Best DA", () => {
    const result = calculatePricing({
      packSize: 12,
      fobBottle: 13,
      bestDepletionAllowance: 1,
      pricingBasis: "bottle"
    });
    expect(result.frontlineBottlePrice).toBe(19.25);
    expect(result.bestPrice).toBe(18.25);
    expect(calculateGpMargin({ bottlePrice: 18.25, landedBottleCost: 13, depletionAllowance: 1 })).toBe(0.3425);
    expect(result.diagnostics.best_target_conflict).toBe(false);
  });

  it("preserves higher manual prices and raises Frontline to maintain the ladder", () => {
    const result = calculatePricing({
      packSize: 12,
      fobBottle: 20,
      frontlineBottlePrice: 35,
      bestPrice: 39,
      pricingBasis: "bottle"
    });
    expect(result.frontlineBottlePrice).toBe(41);
    expect(result.bestPrice).toBe(39);

    const frontlineOnly = calculatePricing({
      packSize: 12,
      fobBottle: 20,
      frontlineBottlePrice: 50,
      bestPrice: 48,
      pricingBasis: "bottle"
    });
    expect(frontlineOnly.bestPrice).toBe(48);
    expect(frontlineOnly.diagnostics.best_target_conflict).toBe(false);
  });

  it("uses explicit solve modes without changing unrelated inputs", () => {
    const gp = balancePriceLevel({ bottlePrice: 30, depletionAllowance: 2, landedBottleCost: 22, solveFor: "gp" });
    expect(gp).toMatchObject({ bottlePrice: 30, depletionAllowance: 2, calculatedGpMargin: 0.3333 });

    const price = balancePriceLevel({ depletionAllowance: 1, targetGpMargin: 0.3, landedBottleCost: 20, solveFor: "price" });
    expect(price).toMatchObject({ bottlePrice: 27.14, depletionAllowance: 1 });

    const da = balancePriceLevel({ bottlePrice: 40, targetGpMargin: 0.28, landedBottleCost: 20, solveFor: "da" });
    expect(da).toMatchObject({ depletionAllowance: 0, noDaRequired: true });
    expect(() => balancePriceLevel({ bottlePrice: 20, targetGpMargin: 1, landedBottleCost: 20, solveFor: "da" })).toThrow(/below 100%/);
  });

  it("warns when DA exceeds landed cost and leaves GRW informational", () => {
    const gp = balancePriceLevel({ bottlePrice: 20, depletionAllowance: 21, landedBottleCost: 20, solveFor: "gp" });
    expect(gp.daExceedsLandedCost).toBe(true);
    expect(gp.calculatedGpMargin).toBe(1);

    const grw = calculatePricing({
      packSize: 12,
      fobBottle: 20,
      frontlineBottlePrice: 20,
      pricingBasis: "bottle",
      grwBrokerModel: true
    });
    expect(grw.diagnostics.informational_only).toBe(true);
    expect(grw.warnings).not.toContain("Gross profit margin is below 28%.");
  });

  it("detects normalized active duplicate labels without deleting either level", () => {
    expect(findDuplicateActivePriceLevels([
      { name: "On 1-Case", bottlePrice: 20, active: true },
      { name: "On 1 Case", bottlePrice: 19, active: true },
      { name: "On 1 Case", bottlePrice: 18, active: false }
    ])).toEqual(["On 1 Case"]);
  });
});
