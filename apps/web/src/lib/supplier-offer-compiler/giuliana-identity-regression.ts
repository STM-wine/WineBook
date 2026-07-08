import { searchProductIdentityCandidates, type ProductIdentityCandidate } from "@/lib/product-identity-search";
import { classifySupplierOfferIdentityMatches } from "./matching";
import type { SupplierOfferCandidateDraft } from "./types";

type ExpectedClassification =
  | "Existing item"
  | "Existing item - cost changed"
  | "New vintage candidate"
  | "New SKU - Pack Size"
  | "New SKU - Bottle Size"
  | "Possible related wine"
  | "Possible duplicate / conflict"
  | "New wine";

type RegressionCase = {
  id: string;
  uploaded: Partial<SupplierOfferCandidateDraft> & Pick<SupplierOfferCandidateDraft, "producer" | "wineName" | "vintage" | "packSize" | "bottleSize">;
  expectedClassification: ExpectedClassification;
  expectedTopSourceId?: string;
};

const SUPPLIER_ID = "giuliana-imports";
const SUPPLIER_NAME = "Giuliana Imports";

function identityCandidate(input: {
  sourceId: string;
  producer: string;
  wineName: string;
  vintage: string;
  packSize: number;
  bottleSize?: string;
  fobBottle?: number;
  supplierId?: string | null;
  supplierName?: string;
  active?: boolean;
}): ProductIdentityCandidate {
  const bottleSize = input.bottleSize || "750ml";
  const fobBottle = input.fobBottle ?? 20;
  const displayName = `${input.producer} ${input.wineName} ${input.vintage} ${input.packSize}/${bottleSize}`;
  return {
    source: "supplier_catalog",
    sourceId: input.sourceId,
    supplierId: input.supplierId === undefined ? SUPPLIER_ID : input.supplierId,
    supplierName: input.supplierName || SUPPLIER_NAME,
    producer: input.producer,
    wineName: input.wineName,
    vintage: input.vintage,
    packSize: input.packSize,
    bottleSize,
    fobBottle,
    fobCase: fobBottle * input.packSize,
    laidInPerBottle: 0,
    frontlineBottlePrice: fobBottle / 0.68,
    bestPrice: null,
    grossProfitMargin: 0.32,
    displayName,
    planningSku: displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    planningSkuWithoutVintage: displayName.toLowerCase().replace(/\b(?:19|20)\d{2}\b/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""),
    quickbooksItemNumber: null,
    quickbooksItemName: null,
    systemTags: [],
    active: input.active !== false,
    updatedAt: "2026-01-01T00:00:00Z"
  };
}

export const giulianaIdentityRegressionCandidates: ProductIdentityCandidate[] = [
  identityCandidate({ sourceId: "azelia-barolo-2021-12-750", producer: "Azelia", wineName: "Barolo", vintage: "2021", packSize: 12, fobBottle: 36 }),
  identityCandidate({ sourceId: "azelia-barolo-cerretta-2021-3-750", producer: "Azelia", wineName: "Barolo Cerretta", vintage: "2021", packSize: 3, fobBottle: 72 }),
  identityCandidate({ sourceId: "azelia-barolo-bricco-fiasco-2021-6-750", producer: "Azelia", wineName: "Barolo Bricco Fiasco", vintage: "2021", packSize: 6, fobBottle: 88 }),
  identityCandidate({ sourceId: "clerico-barolo-2021-12-750", producer: "Domenico Clerico", wineName: "Barolo", vintage: "2021", packSize: 12, fobBottle: 42 }),
  identityCandidate({ sourceId: "clerico-ciabot-mentin-2021-6-750", producer: "Domenico Clerico", wineName: "Barolo Ciabot Mentin", vintage: "2021", packSize: 6, fobBottle: 105 }),
  identityCandidate({ sourceId: "clerico-pajana-2021-6-750", producer: "Domenico Clerico", wineName: "Barolo Pajana", vintage: "2021", packSize: 6, fobBottle: 96 }),
  identityCandidate({ sourceId: "clerico-aeroplanservaj-2021-6-750", producer: "Domenico Clerico", wineName: "Barolo Aeroplanservaj", vintage: "2021", packSize: 6, fobBottle: 120 }),
  identityCandidate({ sourceId: "antoniolo-osso-san-grato-2020-6-750", producer: "Antoniolo", wineName: "Gattinara Osso San Grato", vintage: "2020", packSize: 6, fobBottle: 74 }),
  identityCandidate({ sourceId: "altos-malbec-clasico-2023-12-750", producer: "Altos Las Hormigas", wineName: "Malbec Clasico", vintage: "2023", packSize: 12, fobBottle: 11 }),
  identityCandidate({ sourceId: "altos-el-jardin-los-amantes-2022-12-750", producer: "Altos Las Hormigas", wineName: "El Jardin Los Amantes", vintage: "2022", packSize: 12, fobBottle: 26 }),
  identityCandidate({ sourceId: "fontodi-chianti-classico-2021-12-750", producer: "Fontodi", wineName: "Chianti Classico", vintage: "2021", packSize: 12, fobBottle: 24 }),
  identityCandidate({ sourceId: "fontodi-chianti-classico-riserva-vigna-del-sorbo-2020-6-750", producer: "Fontodi", wineName: "Chianti Classico Riserva Vigna del Sorbo", vintage: "2020", packSize: 6, fobBottle: 82 }),
  identityCandidate({ sourceId: "same-wine-other-supplier-2021-12-750", producer: "Felsina", wineName: "Chianti Classico", vintage: "2021", packSize: 12, supplierId: "other-supplier", supplierName: "Other Supplier", fobBottle: 24 }),
  identityCandidate({ sourceId: "inactive-existing-2021-12-750", producer: "Produttori", wineName: "Barbaresco", vintage: "2021", packSize: 12, active: false, fobBottle: 38 })
];

export const giulianaIdentityRegressionCases: RegressionCase[] = [
  { id: "existing-azelia-barolo", uploaded: row("Azelia", "Barolo", "2021", 12, "750ml", 36), expectedClassification: "Existing item", expectedTopSourceId: "azelia-barolo-2021-12-750" },
  { id: "cost-change-azelia-barolo", uploaded: row("Azelia", "Barolo", "2021", 12, "750ml", 39), expectedClassification: "Existing item - cost changed", expectedTopSourceId: "azelia-barolo-2021-12-750" },
  { id: "new-vintage-azelia-barolo", uploaded: row("Azelia", "Barolo", "2022", 12, "750ml", 36), expectedClassification: "New vintage candidate", expectedTopSourceId: "azelia-barolo-2021-12-750" },
  { id: "new-sku-pack-azelia-barolo", uploaded: row("Azelia", "Barolo", "2021", 6, "750ml", 36), expectedClassification: "New SKU - Pack Size", expectedTopSourceId: "azelia-barolo-2021-12-750" },
  { id: "new-sku-bottle-azelia-barolo", uploaded: row("Azelia", "Barolo", "2021", 12, "1500ml", 72), expectedClassification: "New SKU - Bottle Size", expectedTopSourceId: "azelia-barolo-2021-12-750" },
  { id: "related-plain-to-cerretta", uploaded: row("Azelia", "Barolo", "2021", 12, "750ml", 36), expectedClassification: "Existing item", expectedTopSourceId: "azelia-barolo-2021-12-750" },
  { id: "existing-cerretta", uploaded: row("Azelia", "Barolo Cerretta", "2021", 3, "750ml", 72), expectedClassification: "Existing item", expectedTopSourceId: "azelia-barolo-cerretta-2021-3-750" },
  { id: "existing-bricco-fiasco", uploaded: row("Azelia", "Barolo Bricco Fiasco", "2021", 6, "750ml", 88), expectedClassification: "Existing item", expectedTopSourceId: "azelia-barolo-bricco-fiasco-2021-6-750" },
  { id: "existing-clerico-barolo", uploaded: row("Domenico Clerico", "Barolo", "2021", 12, "750ml", 42), expectedClassification: "Existing item", expectedTopSourceId: "clerico-barolo-2021-12-750" },
  { id: "existing-ciabot-mentin", uploaded: row("Domenico Clerico", "Barolo Ciabot Mentin", "2021", 6, "750ml", 105), expectedClassification: "Existing item", expectedTopSourceId: "clerico-ciabot-mentin-2021-6-750" },
  { id: "existing-pajana", uploaded: row("Domenico Clerico", "Barolo Pajana", "2021", 6, "750ml", 96), expectedClassification: "Existing item", expectedTopSourceId: "clerico-pajana-2021-6-750" },
  { id: "existing-aeroplanservaj", uploaded: row("Domenico Clerico", "Barolo Aeroplanservaj", "2021", 6, "750ml", 120), expectedClassification: "Existing item", expectedTopSourceId: "clerico-aeroplanservaj-2021-6-750" },
  { id: "related-clerico-plain-to-pajana", uploaded: row("Domenico Clerico", "Barolo Pajana", "2021", 12, "750ml", 96), expectedClassification: "New SKU - Pack Size", expectedTopSourceId: "clerico-pajana-2021-6-750" },
  { id: "existing-antoniolo", uploaded: row("Antoniolo", "Gattinara Osso San Grato", "2020", 6, "750ml", 74), expectedClassification: "Existing item", expectedTopSourceId: "antoniolo-osso-san-grato-2020-6-750" },
  { id: "new-vintage-antoniolo", uploaded: row("Antoniolo", "Gattinara Osso San Grato", "2021", 6, "750ml", 74), expectedClassification: "New vintage candidate", expectedTopSourceId: "antoniolo-osso-san-grato-2020-6-750" },
  { id: "existing-altos-malbec", uploaded: row("Altos Las Hormigas", "Malbec Clasico", "2023", 12, "750ml", 11), expectedClassification: "Existing item", expectedTopSourceId: "altos-malbec-clasico-2023-12-750" },
  { id: "existing-altos-jardin", uploaded: row("Altos Las Hormigas", "El Jardin Los Amantes", "2022", 12, "750ml", 26), expectedClassification: "Existing item", expectedTopSourceId: "altos-el-jardin-los-amantes-2022-12-750" },
  { id: "related-fontodi-riserva", uploaded: row("Fontodi", "Chianti Classico Riserva", "2020", 6, "750ml", 82), expectedClassification: "Possible related wine" },
  { id: "existing-fontodi-chianti", uploaded: row("Fontodi", "Chianti Classico", "2021", 12, "750ml", 24), expectedClassification: "Existing item", expectedTopSourceId: "fontodi-chianti-classico-2021-12-750" },
  { id: "supplier-conflict", uploaded: row("Felsina", "Chianti Classico", "2021", 12, "750ml", 24), expectedClassification: "Possible duplicate / conflict", expectedTopSourceId: "same-wine-other-supplier-2021-12-750" },
  { id: "inactive-conflict", uploaded: row("Produttori", "Barbaresco", "2021", 12, "750ml", 38), expectedClassification: "Possible duplicate / conflict", expectedTopSourceId: "inactive-existing-2021-12-750" },
  { id: "new-wine-no-source", uploaded: row("Giuliana Test", "Completely New Wine", "2024", 12, "750ml", 18), expectedClassification: "New wine" },
  { id: "pack-format-equivalence-x", uploaded: row("Azelia", "Barolo", "2021", 12, "750 ML", 36), expectedClassification: "Existing item", expectedTopSourceId: "azelia-barolo-2021-12-750" },
  { id: "bottle-format-equivalence-magnum", uploaded: row("Azelia", "Barolo", "2021", 3, "1.5L", 72), expectedClassification: "New SKU - Bottle Size", expectedTopSourceId: "azelia-barolo-2021-12-750" }
];

function row(producer: string, wineName: string, vintage: string, packSize: number, bottleSize: string, fob: number): RegressionCase["uploaded"] {
  return { supplierId: SUPPLIER_ID, supplierName: SUPPLIER_NAME, documentType: "price_list", producer, wineName, vintage, packSize, bottleSize, fob, overallConfidence: 1, fields: [] };
}

export function runGiulianaIdentityRegression() {
  return giulianaIdentityRegressionCases.map((testCase) => {
    const matches = searchProductIdentityCandidates(
      {
        query: `${testCase.uploaded.producer} ${testCase.uploaded.wineName} ${testCase.uploaded.vintage} ${testCase.uploaded.packSize}/${testCase.uploaded.bottleSize}`,
        producer: testCase.uploaded.producer,
        vintage: testCase.uploaded.vintage,
        packSize: testCase.uploaded.packSize,
        bottleSize: testCase.uploaded.bottleSize,
        supplierId: testCase.uploaded.supplierId,
        supplierName: testCase.uploaded.supplierName,
        limit: 5
      },
      giulianaIdentityRegressionCandidates
    );
    const classified = classifySupplierOfferIdentityMatches(testCase.uploaded as SupplierOfferCandidateDraft, matches);
    const top = classified[0] || null;
    const actualClassification = String(top?.explanation?.classification || "New wine") as ExpectedClassification;
    return {
      id: testCase.id,
      expectedClassification: testCase.expectedClassification,
      actualClassification,
      expectedTopSourceId: testCase.expectedTopSourceId || null,
      actualTopSourceId: top?.sourceId || null,
      score: top?.score || 0,
      passed: actualClassification === testCase.expectedClassification && (!testCase.expectedTopSourceId || top?.sourceId === testCase.expectedTopSourceId),
      topCandidates: classified.slice(0, 3).map((match) => ({
        sourceId: match.sourceId,
        classification: match.explanation.classification,
        score: match.score,
        matchedDisplayName: match.matchedDisplayName,
        uploadedOnly: match.explanation.uploaded_only_identity_tokens,
        matchedOnly: match.explanation.matched_only_identity_tokens
      }))
    };
  });
}

if (process.argv[1]?.endsWith("giuliana-identity-regression.ts")) {
  const results = runGiulianaIdentityRegression();
  for (const result of results) {
    console.log(`${result.passed ? "PASS" : "FAIL"} ${result.id}: expected ${result.expectedClassification}, got ${result.actualClassification} (${result.actualTopSourceId || "no match"})`);
  }
  const passed = results.filter((result) => result.passed).length;
  console.log(`${passed}/${results.length} Giuliana identity regression cases passed.`);
  if (passed !== results.length) process.exitCode = 1;
}
