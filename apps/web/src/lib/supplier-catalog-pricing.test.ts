import { describe, expect, it } from "vitest";
import {
  balancePriceLevel,
  buildSupplierCatalogWine,
  calculateBestPrice,
  calculateGpMargin,
  calculatePricing,
  completeRequiredPriceLevels,
  findDuplicateActivePriceLevels,
  hasOfficialQuickBooksProduct,
  normalizeFobCosts,
  supplierCatalogWineToInput
} from "./supplier-catalog";
import type { SupplierCatalogWine } from "./types";

describe("production Supplier Hub pricing", () => {
  it("does not treat legacy NEW placeholders as official QuickBooks products", () => {
    expect(hasOfficialQuickBooksProduct({
      product_lifecycle_status: "pending_product_creation",
      quickbooks_item_id: "NEW",
      quickbooks_item_number: "NEW"
    })).toBe(false);
    expect(hasOfficialQuickBooksProduct({
      product_lifecycle_status: "supplier_available",
      quickbooks_item_id: "80000001-123456",
      quickbooks_item_number: "ABC000001"
    })).toBe(true);
  });

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

  it("calculates Best independently at a minimum 30% GP", () => {
    expect(calculateBestPrice(10.3)).toBe(14.75);
    expect(calculateBestPrice(22)).toBe(32);
  });

  it("matches the canonical $22 landed-cost example", () => {
    const result = calculatePricing({ packSize: 12, fobBottle: 20, laidInPerBottle: 2, pricingBasis: "bottle" });
    expect(result.frontlineBottlePrice).toBe(33);
    expect(result.bestPrice).toBe(32);
    expect(result.grossProfitMargin).toBe(0.3333);
    expect(calculateGpMargin({ bottlePrice: result.bestPrice, landedBottleCost: 22 })).toBe(0.3125);
  });

  it("keeps both automatic prices at or above their target GP", () => {
    const result = calculatePricing({ packSize: 12, fobBottle: 13, laidInPerBottle: 0, pricingBasis: "bottle" });
    expect(result.frontlineBottlePrice).toBe(19.25);
    expect(result.bestPrice).toBe(18.75);
    expect(calculateGpMargin({ bottlePrice: result.bestPrice, landedBottleCost: 13 })).toBeGreaterThanOrEqual(0.3);
    expect(result.diagnostics.best_target_conflict).toBe(false);
  });

  it("rounds sub-$20 Frontline upward to a quarter and uses Best DA", () => {
    const result = calculatePricing({
      packSize: 12,
      fobBottle: 13,
      laidInPerBottle: 0,
      bestDepletionAllowance: 1,
      pricingBasis: "bottle"
    });
    expect(result.frontlineBottlePrice).toBe(19.25);
    expect(result.bestPrice).toBe(18.75);
    expect(calculateGpMargin({ bottlePrice: 18.75, landedBottleCost: 13, depletionAllowance: 1 })).toBe(0.36);
    expect(result.diagnostics.best_target_conflict).toBe(false);
  });

  it("preserves manual prices exactly instead of silently overwriting them", () => {
    const result = calculatePricing({
      packSize: 12,
      fobBottle: 20,
      frontlineBottlePrice: 35,
      bestPrice: 39,
      pricingBasis: "bottle"
    });
    expect(result.frontlineBottlePrice).toBe(35);
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

  it("supports explicit Frontline-only pricing without a $50 suppression rule", () => {
    expect(calculatePricing({ packSize: 12, fobBottle: 40, laidInPerBottle: 0 }).bestPrice).toBe(58);
    expect(calculatePricing({ packSize: 12, fobBottle: 40, laidInPerBottle: 0, frontlineOnly: true }).bestPrice).toBeNull();
  });

  it("completes a partial source list with both required automatic price levels", () => {
    const pricing = calculatePricing({ packSize: 12, fobBottle: 11, laidInPerBottle: 1 });
    const levels = completeRequiredPriceLevels([{
      name: "Frontline",
      bottlePrice: 18,
      isFrontline: true,
      active: true
    }], pricing);

    expect(levels.filter((level) => level.active !== false).map((level) => level.name)).toEqual(["Frontline", "Best"]);
    expect(levels.find((level) => level.isBest)?.bottlePrice).toBe(17.25);
  });

  it("keeps the saved header and price-level rows consistent when the source has only Frontline", () => {
    const result = buildSupplierCatalogWine({
      supplierName: "Illahe",
      producer: "Illahe",
      wineName: "Viognier",
      vintage: "2026",
      packSize: 12,
      bottleSize: "750ml",
      fobBottle: 11,
      laidInPerBottle: 1,
      availabilityStatus: "available",
      conversionStatus: "new_vintage",
      priceLevels: [{ name: "Frontline", bottlePrice: 17.75, isFrontline: true, active: true }]
    });

    const best = result.price_levels.find((level) => level.is_best && level.active);
    expect(best?.bottle_price).toBe(17.25);
    expect(result.best_price).toBe(best?.bottle_price);
  });

  it("matches the requested under-$20 acceptance example", () => {
    const result = calculatePricing({ packSize: 12, fobBottle: 10, laidInPerBottle: 0.3 });
    expect(result.bestPrice).toBe(14.75);
    expect(result.frontlineBottlePrice).toBe(15.25);
    expect(result.bestGrossProfitMargin).toBe(0.3017);
    expect(result.grossProfitMargin).toBe(0.3246);
  });

  it("rounds raw prices immediately below, equal to, and above $20 upward", () => {
    expect(calculatePricing({ packSize: 12, fobBottle: 13.99, laidInPerBottle: 0 }).bestPrice).toBe(20);
    expect(calculatePricing({ packSize: 12, fobBottle: 14, laidInPerBottle: 0 }).bestPrice).toBe(20);
    expect(calculatePricing({ packSize: 12, fobBottle: 14.01, laidInPerBottle: 0 }).bestPrice).toBe(21);
    expect(calculatePricing({ packSize: 12, fobBottle: 13.59, laidInPerBottle: 0 }).frontlineBottlePrice).toBe(20);
    expect(calculatePricing({ packSize: 12, fobBottle: 13.6, laidInPerBottle: 0 }).frontlineBottlePrice).toBe(20);
    expect(calculatePricing({ packSize: 12, fobBottle: 13.61, laidInPerBottle: 0 }).frontlineBottlePrice).toBe(21);
  });

  it("does not suggest prices until FOB and laid-in are explicitly available", () => {
    expect(calculatePricing({ packSize: 12, fobBottle: 10 }).suggestionsReady).toBe(false);
    expect(calculatePricing({ packSize: 12, laidInPerBottle: 1 }).suggestionsReady).toBe(false);
    expect(calculatePricing({ packSize: 12, fobBottle: 10, laidInPerBottle: 0 }).suggestionsReady).toBe(true);
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

  it("preserves catalog metadata when a draft is edited from Order Summary", () => {
    const input = supplierCatalogWineToInput({
      id: "wine-1",
      supplier_id: "supplier-1",
      supplier_name: "Stateside",
      producer: "Domaine Vacheron",
      wine_name: "Sancerre Blanc",
      vintage: "2025",
      pack_size: 6,
      bottle_size: "750ml",
      pricing_basis: "case",
      pricing_model: "standard",
      fob_bottle: 20,
      fob_case: 120,
      laid_in_per_bottle: 1.5,
      availability_status: "available",
      conversion_status: "net_new_product",
      system_tags: ["Core"],
      copied_from_supplier_catalog_wine_id: "wine-template",
      quickbooks_item_id: null,
      quickbooks_item_name: null,
      quickbooks_item_number: null,
      source_system: "supplier_hub",
      source_id: "source-1",
      price_levels: [{
        id: "price-1",
        supplier_catalog_wine_id: "wine-1",
        name: "Frontline",
        bottle_price: 32,
        depletion_allowance: 0,
        target_gp_margin: 0.32,
        calculated_gp_margin: 0.3281,
        is_frontline: true,
        is_best: false,
        display_order: 0,
        active: true,
        source_system: null,
        source_id: null,
        created_at: "2026-09-14T00:00:00Z",
        updated_at: "2026-09-14T00:00:00Z"
      }],
      free_goods: [{
        id: "free-1",
        supplier_catalog_wine_id: "wine-1",
        buy_quantity: 5,
        free_quantity: 1,
        unit: "case",
        program_name: "5+1",
        starts_on: null,
        ends_on: null,
        notes: null,
        active: true,
        created_at: "2026-09-14T00:00:00Z",
        updated_at: "2026-09-14T00:00:00Z"
      }]
    } as SupplierCatalogWine);

    expect(input).toMatchObject({
      supplierId: "supplier-1",
      pricingBasis: "case",
      systemTags: ["Core"],
      copiedFromSupplierCatalogWineId: "wine-template",
      sourceSystem: "supplier_hub",
      sourceId: "source-1"
    });
    expect(input.priceLevels?.[0]).toMatchObject({ id: "price-1", name: "Frontline", bottlePrice: 32 });
    expect(input.freeGoods?.[0]).toMatchObject({ id: "free-1", buyQuantity: 5, freeQuantity: 1, unit: "case" });
  });
});
