import { Fragment, useEffect, useMemo, useState } from "react";
import { parseProductIdentityQuery, type ProductIdentityMatch } from "@/lib/product-identity-search";
import type {
  PriceChangeEvent,
  SupplierCatalogWine,
  SupplierLogistics,
  SupplierQuickBooksVendorMatch,
  WineRequest
} from "@/lib/types";
import { asNumber, formatCurrency, formatCurrencyCents, formatInteger, uniqueSorted } from "@/lib/order-data";
import {
  APPROVAL_DECISIONS,
  APPROVER_NAMES,
  AVAILABILITY_STATUSES,
  PLACEMENT_TYPES,
  SYSTEM_TAGS,
  systemTagLabel,
  balancePriceLevel,
  buildSupplierCatalogWine,
  calculateGpMargin,
  calculatePricing,
  defaultLaidInForSupplier,
  detachInheritedQuickBooksIdentity,
  findDuplicateActivePriceLevels,
  money,
  normalizeWineIdentity,
  type SupplierCatalogWineInput
} from "@/lib/supplier-catalog";

type HubArea = "search" | "add" | "requests" | "pending" | "price-changes" | "logistics";
type SaveCatalogWineInput = Parameters<typeof buildSupplierCatalogWine>[0] & {
  existingCatalogWineId?: string | null;
  priceChangeReason?: string;
};
type DeleteCatalogWineInput = {
  id: string;
};
type CreateWineRequestInput = {
  sourceType: "net_new_wine" | "supplier_available_wine";
  supplierCatalogWineId?: string | null;
  supplierName: string;
  wineDisplayName: string;
  accountCustomer: string;
  requestedQuantity: number;
  neededByDate?: string | null;
  placementType: string;
  requesterName: string;
  notes?: string;
};
type UpdateWineRequestApprovalInput = {
  id: string;
  approverName: string;
  approvalDecision: string;
};

const HUB_AREAS: Array<{ id: HubArea; label: string }> = [
  { id: "search", label: "Search Wines" },
  { id: "add", label: "Add Wine" },
  { id: "requests", label: "Requests" },
  { id: "pending", label: "Pending Product Creation" },
  { id: "price-changes", label: "Upcoming Price Changes" },
  { id: "logistics", label: "Supplier Logistics" }
];

const PENDING_CONVERSION_STATUSES = new Set([
  "new_vintage",
  "new_format",
  "possible_match_needs_review",
  "net_new_product"
]);

function hasQuickBooksIdentity(wine: SupplierCatalogWine) {
  return Boolean(wine.quickbooks_item_id?.trim()) || Boolean(wine.quickbooks_item_number?.trim());
}

function isDraftOnlyCatalogWine(wine: SupplierCatalogWine) {
  if (wine.product_lifecycle_status === "active_product") return false;
  if (wine.quickbooks_sync_status === "created" || wine.quickbooks_sync_status === "linked") return false;
  if (hasQuickBooksIdentity(wine)) return false;
  return (
    wine.product_lifecycle_status === "pending_product_creation" ||
    wine.quickbooks_sync_status === "not_created" ||
    PENDING_CONVERSION_STATUSES.has(wine.conversion_status)
  );
}

function isSearchableSupplierWine(wine: SupplierCatalogWine) {
  return !isDraftOnlyCatalogWine(wine);
}

export function SupplierHubView({
  addWineSupplierName,
  suppliers,
  supplierCatalogWines,
  wineRequests,
  priceChangeEvents,
  quickBooksSupplierMatches,
  isPending,
  onCreateWineRequest,
  onDeleteCatalogWine,
  onSaveCatalogWine,
  onSaveSuppliers,
  onUpdateWineRequestApproval
}: {
  addWineSupplierName?: string | null;
  suppliers: SupplierLogistics[];
  supplierCatalogWines: SupplierCatalogWine[];
  wineRequests: WineRequest[];
  priceChangeEvents: PriceChangeEvent[];
  quickBooksSupplierMatches: SupplierQuickBooksVendorMatch[];
  isPending: boolean;
  onCreateWineRequest: (input: CreateWineRequestInput) => void;
  onDeleteCatalogWine: (input: DeleteCatalogWineInput) => void;
  onSaveCatalogWine: (input: SaveCatalogWineInput, onSuccess?: () => void) => void;
  onSaveSuppliers: (suppliers: SupplierLogistics[]) => void;
  onUpdateWineRequestApproval: (input: UpdateWineRequestApprovalInput) => void;
}) {
  const [activeArea, setActiveArea] = useState<HubArea>(addWineSupplierName ? "add" : "search");
  const [pendingEditWineId, setPendingEditWineId] = useState<string | null>(null);
  const searchableCatalogWines = useMemo(() => supplierCatalogWines.filter(isSearchableSupplierWine), [supplierCatalogWines]);
  const pendingWineCount = supplierCatalogWines.filter(isDraftOnlyCatalogWine).length;
  const pendingRequestCount = wineRequests.filter((request) => request.request_status === "pending_review").length;
  const draftPriceChanges = priceChangeEvents.filter((event) => event.status === "draft").length;

  useEffect(() => {
    if (!addWineSupplierName) return;
    setPendingEditWineId(null);
    setActiveArea("add");
  }, [addWineSupplierName]);

  return (
    <section className="panel supplier-hub-panel" id="supplier-hub">
      <div className="section-heading">
        <div>
          <h1>Supplier Hub</h1>
          <p>Manage supplier wines before they become official QuickBooks products.</p>
        </div>
      </div>

      <div className="supplier-hub-summary">
        <div>
          <span>Supplier Wines</span>
          <strong>{formatInteger(searchableCatalogWines.length)}</strong>
        </div>
        <div>
          <span>Pending Creation</span>
          <strong>{formatInteger(pendingWineCount)}</strong>
        </div>
        <div>
          <span>Open Requests</span>
          <strong>{formatInteger(pendingRequestCount)}</strong>
        </div>
        <div>
          <span>Draft Price Changes</span>
          <strong>{formatInteger(draftPriceChanges)}</strong>
        </div>
      </div>

      <div className="supplier-hub-tabs" role="tablist" aria-label="Supplier Hub areas">
        {HUB_AREAS.map((area) => (
          <button
            key={area.id}
            className={activeArea === area.id ? "active" : undefined}
            onClick={() => setActiveArea(area.id)}
            type="button"
          >
            {area.label}
          </button>
        ))}
      </div>

      {activeArea === "search" ? <SearchWinesPanel wines={searchableCatalogWines} /> : null}
      {activeArea === "add" ? (
        <AddWinePanel
          initialSupplierName={addWineSupplierName}
          suppliers={suppliers}
          wines={searchableCatalogWines}
          isPending={isPending}
          editWine={supplierCatalogWines.find((wine) => wine.id === pendingEditWineId) || null}
          onClearPendingEdit={() => setPendingEditWineId(null)}
          onSaveCatalogWine={onSaveCatalogWine}
        />
      ) : null}
      {activeArea === "requests" ? (
        <RequestsPanel
          wines={supplierCatalogWines}
          requests={wineRequests}
          isPending={isPending}
          onCreateWineRequest={onCreateWineRequest}
          onUpdateWineRequestApproval={onUpdateWineRequestApproval}
        />
      ) : null}
      {activeArea === "pending" ? (
        <PendingProductCreationPanel
          wines={supplierCatalogWines}
          requests={wineRequests}
          isPending={isPending}
          onDeleteCatalogWine={onDeleteCatalogWine}
          onEditCatalogWine={(wine) => {
            setPendingEditWineId(wine.id);
            setActiveArea("add");
          }}
        />
      ) : null}
      {activeArea === "price-changes" ? <PriceChangesPanel events={priceChangeEvents} /> : null}
      {activeArea === "logistics" ? (
        <SupplierLogisticsPanel
          suppliers={suppliers}
          quickBooksSupplierMatches={quickBooksSupplierMatches}
          isPending={isPending}
          onSaveSuppliers={onSaveSuppliers}
        />
      ) : null}
    </section>
  );
}

function AddWinePanel({
  initialSupplierName,
  suppliers,
  wines,
  isPending,
  editWine,
  onClearPendingEdit,
  onSaveCatalogWine
}: {
  initialSupplierName?: string | null;
  suppliers: SupplierLogistics[];
  wines: SupplierCatalogWine[];
  isPending: boolean;
  editWine: SupplierCatalogWine | null;
  onClearPendingEdit: () => void;
  onSaveCatalogWine: (input: SaveCatalogWineInput, onSuccess?: () => void) => void;
}) {
  const [supplierId, setSupplierId] = useState("");
  const [supplierName, setSupplierName] = useState("");
  const [producer, setProducer] = useState("");
  const [searchItem, setSearchItem] = useState("");
  const [wineName, setWineName] = useState("");
  const [vintage, setVintage] = useState("NV");
  const [packSize, setPackSize] = useState("12");
  const [bottleSize, setBottleSize] = useState("750ml");
  const [fobBottle, setFobBottle] = useState("");
  const [fobCase, setFobCase] = useState("");
  const [pricingBasis, setPricingBasis] = useState<"bottle" | "case">("bottle");
  const [pricingModel, setPricingModel] = useState<"standard" | "grw_broker">("standard");
  const [frontlineOnly, setFrontlineOnly] = useState(false);
  const [laidInPerBottle, setLaidInPerBottle] = useState("");
  const [systemTags, setSystemTags] = useState<string[]>([]);
  const [quickbooksItemId, setQuickbooksItemId] = useState("");
  const [quickbooksItemName, setQuickbooksItemName] = useState("");
  const [quickbooksItemNumber, setQuickbooksItemNumber] = useState("");
  const [copiedFromSupplierCatalogWineId, setCopiedFromSupplierCatalogWineId] = useState<string | null>(null);
  const [templateWine, setTemplateWine] = useState<SupplierCatalogWine | null>(null);
  const [pendingEditId, setPendingEditId] = useState<string | null>(null);
  const [pendingEditConversionStatus, setPendingEditConversionStatus] = useState<SupplierCatalogWineInput["conversionStatus"] | null>(null);
  const [wineNameMatches, setWineNameMatches] = useState<ProductIdentityMatch[]>([]);
  const [wineMatchError, setWineMatchError] = useState("");
  const [isSearchingWineMatches, setIsSearchingWineMatches] = useState(false);
  const [includeInactiveMatches, setIncludeInactiveMatches] = useState(false);
  const [priceLevels, setPriceLevels] = useState<PriceLevelDraft[]>(() => defaultPriceLevelDrafts());
  const [freeGoods, setFreeGoods] = useState<FreeGoodDraft[]>([]);
  const [priceChangeReason, setPriceChangeReason] = useState("Manual catalog update");
  const producerOptions = useMemo(() => uniqueSorted(wines.map((wine) => wine.producer)), [wines]);
  const supplierOptions = useMemo(() => uniqueSorted(suppliers.map((supplier) => supplier.name)), [suppliers]);
  const parsedPackSize = Number(packSize);
  const hasValidPack = Number.isInteger(parsedPackSize) && parsedPackSize > 0;
  const computedPricing = calculatePricing({
    packSize: hasValidPack ? parsedPackSize : 1,
    fobBottle: hasValidPack ? parseOptionalNumber(fobBottle) : null,
    fobCase: hasValidPack ? parseOptionalNumber(fobCase) : null,
    laidInPerBottle: parseOptionalNumber(laidInPerBottle),
    pricingBasis,
    grwBrokerModel: pricingModel === "grw_broker",
    frontlineOnly
  });
  const copiedFromWine = templateWine;
  const showWineNameMatches = searchItem.trim().length >= 3 && !templateWine;
  const currentIdentity = normalizeWineIdentity({
    producer,
    wineName,
    vintage,
    packSize: Math.max(1, Math.trunc(Number(packSize) || 12)),
    bottleSize
  });
  const effectiveQuickBooksIdentity = detachInheritedQuickBooksIdentity({
    currentPlanningSku: currentIdentity.planningSku,
    templatePlanningSku: copiedFromWine?.planning_sku,
    quickbooksItemId,
    quickbooksItemName,
    quickbooksItemNumber,
    templateQuickbooksItemId: copiedFromWine?.quickbooks_item_id,
    templateQuickbooksItemName: copiedFromWine?.quickbooks_item_name,
    templateQuickbooksItemNumber: copiedFromWine?.quickbooks_item_number
  });
  const conversionStatus =
    pendingEditId && pendingEditConversionStatus
      ? pendingEditConversionStatus
      : conversionStatusForDraft(copiedFromWine, currentIdentity);
  const priceLevelsForDraft = priceLevels;
  const draftPriceLevels = priceLevelsForDraft
    .map((level, index) => {
      const input = priceLevelDraftToInput(level, index, computedPricing);
      return frontlineOnly && input.isBest ? { ...input, active: false } : input;
    })
    .filter((level) => money(level.bottlePrice) > 0 || level.isFrontline);

  useEffect(() => {
    const query = searchItem.trim();
    if (query.length < 3 || templateWine) {
      setWineNameMatches([]);
      setWineMatchError("");
      setIsSearchingWineMatches(false);
      return;
    }

    const controller = new AbortController();
    const timeout = window.setTimeout(() => {
      const params = new URLSearchParams({ q: query });
      if (supplierId) params.set("supplierId", supplierId);
      if (supplierName) params.set("supplierName", supplierName);
      if (producer) params.set("producer", producer);
      if (vintage) params.set("vintage", vintage);
      if (packSize) params.set("packSize", packSize);
      if (bottleSize) params.set("bottleSize", bottleSize);
      if (includeInactiveMatches) params.set("includeInactive", "true");

      setIsSearchingWineMatches(true);
      setWineMatchError("");
      const endpoint = new URL("/api/supplier-wines/matches", window.location.origin);
      endpoint.search = params.toString();
      fetch(endpoint.toString(), { signal: controller.signal })
        .then(async (response) => {
          const body = await response.json();
          if (!response.ok) {
            throw new Error(body.error || "Could not search product matches.");
          }
          setWineNameMatches(Array.isArray(body.matches) ? body.matches : []);
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setWineNameMatches([]);
          setWineMatchError(error instanceof Error ? error.message : "Could not search product matches.");
        })
        .finally(() => setIsSearchingWineMatches(false));
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [bottleSize, includeInactiveMatches, packSize, producer, searchItem, supplierId, supplierName, templateWine, vintage]);

  function supplierByName(name: string) {
    const normalizedName = name.trim().toLowerCase();
    if (!normalizedName) return null;
    return suppliers.find((row) => row.name.trim().toLowerCase() === normalizedName) || null;
  }

  function setSupplierValue(nextSupplierName: string) {
    const supplier = supplierByName(nextSupplierName);
    setSupplierName(nextSupplierName);
    setSupplierId(supplier?.id || "");
    if (supplier) {
      setLaidInPerBottle(String(defaultLaidInForSupplier(suppliers, supplier.id, supplier.name)));
    } else {
      setLaidInPerBottle("");
    }
  }

  useEffect(() => {
    if (!initialSupplierName || editWine) return;
    startNewSku();
    setSupplierValue(initialSupplierName);
  }, [initialSupplierName]);

  function applyWineTemplate(
    wine: SupplierCatalogWine,
    catalogWineId: string | null = null,
    options: { followPricing?: boolean; linkQuickBooks?: boolean; preserveSupplier?: boolean; preservePricingModel?: boolean } = {}
  ) {
    const nextProducer = wine.producer;
    const nextWineName = wine.wine_name;
    const nextVintage = wine.vintage || "NV";
    const nextPackSize = String(wine.pack_size || 12);
    const nextBottleSize = wine.bottle_size || "750ml";

    setTemplateWine(wine);
    setCopiedFromSupplierCatalogWineId(catalogWineId);
    setWineNameMatches([]);
    setWineMatchError("");
    setIncludeInactiveMatches(false);
    setSearchItem(wine.display_name);
    const supplier = options.preserveSupplier
      ? null
      : (wine.supplier_id ? suppliers.find((row) => row.id === wine.supplier_id) : null) || supplierByName(wine.supplier_name);
    const nextSupplierId = options.preserveSupplier ? supplierId : supplier?.id || wine.supplier_id || "";
    const nextSupplierName = options.preserveSupplier ? supplierName : supplier?.name || wine.supplier_name || "";

    setSupplierId(nextSupplierId);
    setSupplierName(nextSupplierName);
    setProducer(nextProducer);
    setWineName(nextWineName);
    setVintage(nextVintage);
    setPackSize(nextPackSize);
    setBottleSize(nextBottleSize);
    setFobBottle(String(asNumber(wine.fob_bottle) || ""));
    setFobCase(String(asNumber(wine.fob_case) || ""));
    setPricingBasis(wine.pricing_basis === "case" ? "case" : "bottle");
    setPricingModel(options.preservePricingModel && wine.pricing_model === "grw_broker" ? "grw_broker" : "standard");
    setFrontlineOnly(Boolean(wine.frontline_only));
    const selectedSupplier = suppliers.find((row) => row.id === nextSupplierId) || supplierByName(nextSupplierName);
    setLaidInPerBottle(selectedSupplier
      ? String(defaultLaidInForSupplier(suppliers, selectedSupplier.id, selectedSupplier.name))
      : String(asNumber(wine.laid_in_per_bottle) || ""));
    setSystemTags(wine.system_tags || []);
    const shouldLinkQuickBooks = options.linkQuickBooks ?? wine.source_system === "quickbooks_item";
    setQuickbooksItemId(shouldLinkQuickBooks ? wine.quickbooks_item_id || wine.quickbooks_item_number || "" : "");
    setQuickbooksItemName(shouldLinkQuickBooks ? wine.quickbooks_item_name || "" : "");
    setQuickbooksItemNumber(shouldLinkQuickBooks ? wine.quickbooks_item_number || wine.quickbooks_item_id || "" : "");
    setPriceLevels(priceLevelDraftsFromWine(wine, { asReference: Boolean(options.followPricing) }));
    setFreeGoods(freeGoodDraftsFromWine(wine, { expirePastPrograms: Boolean(options.followPricing) }));
    setPriceChangeReason(`Matched from ${wine.display_name}`);
  }

  useEffect(() => {
    if (!editWine || editWine.id === pendingEditId) return;
    applyWineTemplate(editWine, editWine.copied_from_supplier_catalog_wine_id || null, { followPricing: false, preservePricingModel: true });
    setPendingEditId(editWine.id);
    setPendingEditConversionStatus(normalizeConversionStatus(editWine.conversion_status));
    setPriceChangeReason(`Editing pending product: ${editWine.display_name}`);
  }, [editWine, pendingEditId]);

  function startNewSku() {
    setPendingEditId(null);
    setPendingEditConversionStatus(null);
    onClearPendingEdit();
    setCopiedFromSupplierCatalogWineId(null);
    setTemplateWine(null);
    setWineNameMatches([]);
    setWineMatchError("");
    setIncludeInactiveMatches(false);
    setSearchItem("");
    setProducer("");
    setWineName("");
    setVintage("NV");
    setPackSize("12");
    setBottleSize("750ml");
    setFobBottle("");
    setFobCase("");
    setPricingBasis("bottle");
    setPricingModel("standard");
    setFrontlineOnly(false);
    setSystemTags([]);
    setQuickbooksItemId("");
    setQuickbooksItemName("");
    setQuickbooksItemNumber("");
    setPriceLevels(defaultPriceLevelDrafts());
    setFreeGoods([]);
    setPriceChangeReason("Manual catalog update");
    if (supplierId) {
      const supplier = suppliers.find((row) => row.id === supplierId);
      setLaidInPerBottle(String(defaultLaidInForSupplier(suppliers, supplier?.id || null, supplier?.name || supplierName)));
    }
  }

  function clearForm() {
    setPendingEditId(null);
    setPendingEditConversionStatus(null);
    onClearPendingEdit();
    setCopiedFromSupplierCatalogWineId(null);
    setTemplateWine(null);
    setWineNameMatches([]);
    setWineMatchError("");
    setIncludeInactiveMatches(false);
    setSearchItem("");
    setSupplierId("");
    setSupplierName("");
    setProducer("");
    setWineName("");
    setVintage("NV");
    setPackSize("12");
    setBottleSize("750ml");
    setFobBottle("");
    setFobCase("");
    setPricingBasis("bottle");
    setPricingModel("standard");
    setFrontlineOnly(false);
    setLaidInPerBottle("");
    setSystemTags([]);
    setQuickbooksItemId("");
    setQuickbooksItemName("");
    setQuickbooksItemNumber("");
    setPriceLevels(defaultPriceLevelDrafts());
    setFreeGoods([]);
    setPriceChangeReason("Manual catalog update");
  }

  function toggleSystemTag(tag: string) {
    setSystemTags((current) => (current.includes(tag) ? current.filter((value) => value !== tag) : [...current, tag]));
  }

  function patchPriceLevel(id: string, patch: Partial<PriceLevelDraft>) {
    setPriceLevels((current) =>
      current.map((level) => {
        if (level.id !== id) return level;
        const next = { ...level, ...patch };
        if (patch.isFrontline) next.isBest = false;
        if (patch.isBest) next.isFrontline = false;
        return next;
      })
    );
  }

  function addPriceLevel() {
    setPriceLevels((current) => [
      ...current,
      {
        id: `level-${Date.now()}`,
        name: `Level ${current.length + 1}`,
        bottlePrice: "",
        depletionAllowance: "",
        targetGpMargin: "",
        solveFor: "gp",
        approvalDecision: "",
        overrideReason: "",
        approvalOwner: "",
        decisionTimestamp: "",
        isFrontline: false,
        isBest: false,
        active: true,
        isManualOverride: true
      }
    ]);
  }

  function deactivatePriceLevel(id: string) {
    setPriceLevels((current) => current.map((level) => level.id === id ? { ...level, active: false } : level));
  }

  function patchFreeGood(id: string, patch: Partial<FreeGoodDraft>) {
    setFreeGoods((current) => current.map((freeGood) => (freeGood.id === id ? { ...freeGood, ...patch } : freeGood)));
  }

  function addFreeGood() {
    setFreeGoods((current) => [
      ...current,
      {
        id: `free-${Date.now()}`,
        buyQuantity: "",
        freeQuantity: "",
        unit: "case",
        programName: "",
        startsOn: "",
        endsOn: "",
        notes: "",
        active: true
      }
    ]);
  }

  const draftInput: SupplierCatalogWineInput = {
    supplierId: supplierId || null,
    supplierName: supplierName.trim(),
    producer,
    wineName,
    vintage,
    packSize: Math.max(1, Math.trunc(Number(packSize) || 12)),
    bottleSize,
    fobBottle: parseOptionalNumber(fobBottle),
    fobCase: parseOptionalNumber(fobCase),
    laidInPerBottle: parseOptionalNumber(laidInPerBottle),
    frontlineOverride: null,
    bestPriceOverride: null,
    availabilityStatus: "available",
    conversionStatus,
    systemTags,
    copiedFromSupplierCatalogWineId,
    quickbooksItemId: effectiveQuickBooksIdentity.itemId || effectiveQuickBooksIdentity.itemNumber,
    quickbooksItemName: effectiveQuickBooksIdentity.itemName,
    quickbooksItemNumber: effectiveQuickBooksIdentity.itemNumber,
    priceLevels: draftPriceLevels,
    freeGoods: freeGoods.map(freeGoodDraftToInput),
    priceChangeReason,
    pricingBasis,
    pricingModel,
    frontlineOnly,
    priorPricingCostFingerprint: templateWine?.pricing_cost_fingerprint || null,
    pricingCalculatedAt: templateWine?.pricing_calculated_at || null,
    expectedLockVersion: pendingEditId ? asNumber(editWine?.lock_version) : 0
  };
  const preview = buildSupplierCatalogWine(draftInput);
  const existing = wines.find((wine) => wine.planning_sku === preview.planning_sku && wine.id !== pendingEditId);
  const previewDiagnostics = preview.diagnostics as Record<string, unknown>;
  const warnings = Array.isArray(previewDiagnostics.warnings) ? (previewDiagnostics.warnings as string[]) : [];
  const isBelowMinimumGp = warnings.some((warning) => warning.includes("below 28%"));
  const lowGpOverridesComplete = draftPriceLevels
    .filter((level) => level.active && level.bottlePrice > 0 && level.calculatedGpMargin < 0.28)
    .every((level) => level.approvalDecision === "approve_price" && Boolean(level.overrideReason) && Boolean(level.approvalOwner));
  const lowGpBlocksSave = pricingModel !== "grw_broker" && isBelowMinimumGp && !lowGpOverridesComplete;
  const incompleteSolveBlocksSave = priceLevels.some((level) =>
    (level.solveFor === "price" && !level.targetGpMargin.trim()) ||
    (level.solveFor === "da" && (!level.targetGpMargin.trim() || !level.bottlePrice.trim()))
  );
  const invalidTargetGpBlocksSave = priceLevels.some((level) => {
    if (!level.targetGpMargin.trim()) return false;
    const target = Number(level.targetGpMargin);
    return !Number.isFinite(target) || target < 0 || target >= 100;
  });
  const activeFrontline = draftPriceLevels.find((level) => level.active && level.isFrontline && level.bottlePrice > 0);
  const activeBest = frontlineOnly
    ? null
    : draftPriceLevels.find((level) => level.active && level.isBest && level.bottlePrice > 0);
  const invalidPricingLadder = Boolean(activeFrontline && activeBest && activeFrontline.bottlePrice <= activeBest.bottlePrice);
  const duplicatePriceLevels = findDuplicateActivePriceLevels(draftPriceLevels);
  const vintagePricingComparisonRows = copiedFromWine && conversionStatus === "new_vintage"
    ? [
        {
          label: "FOB",
          from: formatCurrencyCents(asNumber(copiedFromWine.fob_bottle)),
          to: formatCurrencyCents(asNumber(preview.fob_bottle)),
          changed: money(copiedFromWine.fob_bottle) !== money(preview.fob_bottle)
        },
        {
          label: "Frontline Price",
          from: formatCurrencyCents(asNumber(copiedFromWine.frontline_bottle_price)),
          to: formatCurrencyCents(asNumber(preview.frontline_bottle_price)),
          changed: money(copiedFromWine.frontline_bottle_price) !== money(preview.frontline_bottle_price)
        },
        {
          label: "Best Price",
          from: copiedFromWine.best_price === null ? "Frontline only" : formatCurrencyCents(asNumber(copiedFromWine.best_price)),
          to: preview.best_price === null ? "Frontline only" : formatCurrencyCents(asNumber(preview.best_price)),
          changed: money(copiedFromWine.best_price) !== money(preview.best_price)
        },
        {
          label: "GP%",
          from: formatPercent(copiedFromWine.gross_profit_margin),
          to: formatPercent(preview.gross_profit_margin),
          changed: Number(copiedFromWine.gross_profit_margin || 0) !== Number(preview.gross_profit_margin || 0)
        }
      ]
    : [];

  function saveWine() {
    if (lowGpBlocksSave || incompleteSolveBlocksSave || invalidTargetGpBlocksSave || invalidPricingLadder) return;
    onSaveCatalogWine(
      {
        ...draftInput,
        existingCatalogWineId: pendingEditId,
        expectedLockVersion: asNumber((pendingEditId ? editWine : existing)?.lock_version),
        priceChangeReason,
        idempotencyKey: crypto.randomUUID()
      },
      clearForm
    );
  }

  return (
    <form className="supplier-hub-workspace" onSubmit={(event) => event.preventDefault()}>
      <div className="supplier-form-header">
        <div>
          <h2>{pendingEditId ? "Edit Pending Product" : "Add Wine"}</h2>
          <p>
            {pendingEditId
              ? "Changes save back to this pending product record until it is cleared."
              : "Draft form values stay in this workflow only. They are not searchable catalog rows until Save Wine succeeds."}
          </p>
        </div>
        <div className="supplier-form-header-actions">
          <button className="ghost-button" disabled={isPending} onClick={clearForm} type="button">
            Clear Form
          </button>
          <button className="ghost-button" disabled={isPending} onClick={startNewSku} type="button">
            Create New
          </button>
        </div>
      </div>

      <div className="supplier-form-grid">
        <div className="wide-field catalog-match-field">
          <label>
            Search Item
            <input
              aria-controls="add-wine-search-results"
              aria-expanded={showWineNameMatches}
              value={searchItem}
              onChange={(event) => {
                setSearchItem(event.target.value);
                setIncludeInactiveMatches(false);
              }}
              placeholder="Search active item / SKU"
            />
          </label>
          {showWineNameMatches ? (
            <div
              aria-label="Matching wines"
              className="catalog-match-suggestions"
              id="add-wine-search-results"
              role="region"
            >
              <div className="catalog-match-results">
                {isSearchingWineMatches ? (
                  <div className="catalog-match-empty">Searching product matches...</div>
                ) : wineMatchError ? (
                  <div className="catalog-match-empty">{wineMatchError}</div>
                ) : wineNameMatches.length > 0 ? (
                  wineNameMatches.map((match) => (
                    <div className="catalog-match-suggestion" key={`${match.source}:${match.sourceId}`}>
                      <div>
                        <span>{match.sourceLabel}</span>
                        <strong>{match.displayName}</strong>
                        <small>
                          {match.supplierName}
                          {match.quickbooksItemNumber ? ` · ${match.quickbooksItemNumber}` : ""}
                        </small>
                      </div>
                      <button
                        className="button button-outline button-small catalog-start-from-button"
                        onClick={() =>
                          applyWineTemplate(
                            productIdentityMatchToTemplateWine(match, searchItem),
                            match.source === "supplier_catalog" ? match.sourceId : null,
                            {
                              followPricing: true,
                              linkQuickBooks: match.active && Boolean(match.quickbooksItemNumber || match.quickbooksItemId),
                              preserveSupplier: match.source === "quickbooks_item" && Boolean(supplierName.trim())
                            }
                          )
                        }
                        type="button"
                      >
                        Start From
                      </button>
                    </div>
                  ))
                ) : (
                  <div className="catalog-match-empty">
                    {includeInactiveMatches ? "No active or inactive product matches found." : "No active product matches found."}
                  </div>
                )}
              </div>
              <div className="catalog-match-footer">
                <button
                  className="button button-small catalog-inactive-search-button"
                  disabled={isSearchingWineMatches}
                  onClick={() => setIncludeInactiveMatches((current) => !current)}
                  type="button"
                >
                  {includeInactiveMatches ? "Search active items only" : "Search inactive items too"}
                </button>
              </div>
            </div>
          ) : null}
        </div>
        <label className="wide-field">
          Supplier
          <input
            list="supplier-options"
            value={supplierName}
            onChange={(event) => setSupplierValue(event.target.value)}
            placeholder="No supplier selected"
          />
          <datalist id="supplier-options">
            {supplierOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <label>
          Producer
          <input list="producer-options" required value={producer} onChange={(event) => setProducer(event.target.value)} />
          <datalist id="producer-options">
            {producerOptions.map((option) => (
              <option key={option} value={option} />
            ))}
          </datalist>
        </label>
        <label className="wide-field">
          Item Name
          <input
            required
            value={wineName}
            onChange={(event) => setWineName(event.target.value)}
            placeholder="Saved item name"
          />
        </label>
        <label>
          Vintage
          <input value={vintage} onChange={(event) => setVintage(event.target.value)} />
        </label>
        <label>
          Pack size
          <input required min={1} step={1} type="number" value={packSize} onChange={(event) => {
            const nextPack = Number(event.target.value);
            setPackSize(event.target.value);
            if (Number.isInteger(nextPack) && nextPack > 0) {
              if (pricingBasis === "bottle") {
                const source = parseOptionalNumber(fobBottle);
                if (source !== null) setFobCase(String(money(source * nextPack)));
              } else {
                const source = parseOptionalNumber(fobCase);
                if (source !== null) setFobBottle(String(money(source / nextPack)));
              }
            }
          }} />
        </label>
        <label>
          FOB source unit
          <select value={pricingBasis} onChange={(event) => setPricingBasis(event.target.value as "bottle" | "case")}>
            <option value="bottle">Bottle</option>
            <option value="case">Case</option>
          </select>
        </label>
        <label>
          Bottle size
          <input value={bottleSize} onChange={(event) => setBottleSize(event.target.value)} />
        </label>
        <label>
          Bottle FOB
          <input
            min={0}
            step={0.01}
            type="number"
            value={fobBottle}
            onChange={(event) => {
              setPricingBasis("bottle");
              setFobBottle(event.target.value);
              const next = parseOptionalNumber(event.target.value);
              if (next !== null && hasValidPack) setFobCase(String(money(next * parsedPackSize)));
            }}
          />
        </label>
        <label>
          Case FOB
          <input
            min={0}
            step={0.01}
            type="number"
            value={fobCase}
            onChange={(event) => {
              setPricingBasis("case");
              setFobCase(event.target.value);
              const next = parseOptionalNumber(event.target.value);
              if (next !== null && hasValidPack) setFobBottle(String(money(next / parsedPackSize)));
            }}
          />
        </label>
        <label>
          Laid-in per bottle
          <input min={0} step={0.01} type="number" value={laidInPerBottle} onChange={(event) => setLaidInPerBottle(event.target.value)} />
        </label>
        <label className="check-control">
          <input type="checkbox" checked={frontlineOnly} onChange={(event) => setFrontlineOnly(event.target.checked)} />
          Frontline-only pricing
        </label>
        <label>
          QB Item #
          <input
            value={effectiveQuickBooksIdentity.itemNumber || ""}
            onChange={(event) => {
              setQuickbooksItemNumber(event.target.value);
              setQuickbooksItemId(event.target.value);
              setQuickbooksItemName("");
            }}
            placeholder="Leave blank for New Item"
          />
        </label>
        {effectiveQuickBooksIdentity.itemName ? (
          <label className="wide-field">
            Linked QuickBooks Item
            <input readOnly value={effectiveQuickBooksIdentity.itemName} />
          </label>
        ) : null}
        <label className="wide-field">
          Price change reason
          <input value={priceChangeReason} onChange={(event) => setPriceChangeReason(event.target.value)} />
        </label>
      </div>

      <div className="tag-selector" aria-label="System tags">
        {SYSTEM_TAGS.map((tag) => (
          <label className="check-control" key={tag}>
            <input type="checkbox" checked={systemTags.includes(tag)} onChange={() => toggleSystemTag(tag)} />
            {systemTagLabel(tag)}
          </label>
        ))}
      </div>

      <div className="catalog-preview-grid">
        <div>
          <span>Item Name</span>
          <strong>{preview.display_name || "Producer Wine NV 12/750ml"}</strong>
        </div>
        <div>
          <span>Planning SKU</span>
          <strong>{preview.planning_sku || "producer wine nv 12/750ml"}</strong>
        </div>
        <div>
          <span>Landed Bottle</span>
          <strong>{formatCurrencyCents(preview.landed_bottle_cost)}</strong>
        </div>
        <div>
          <span>Frontline / GM</span>
          <strong>{formatCurrency(preview.frontline_bottle_price)}</strong>
          <small>{formatPercent(preview.gross_profit_margin)}</small>
        </div>
        <div>
          <span>Best / GM</span>
          <strong>{preview.best_price === null ? "Frontline only" : formatCurrency(preview.best_price)}</strong>
          <small>
            {preview.best_price === null
              ? ""
              : formatPercent(calculateGpMargin({ bottlePrice: asNumber(preview.best_price), landedBottleCost: asNumber(preview.landed_bottle_cost) }))}
          </small>
        </div>
        <div>
          <span>Status</span>
          <strong>{conversionStatus.replace(/_/g, " ")}</strong>
          <small>{effectiveQuickBooksIdentity.itemNumber ? "Linked Item" : "New Item"}</small>
        </div>
      </div>

      {vintagePricingComparisonRows.length > 0 ? (
        <div className="previous-pricing-summary">
          <strong>Previous vintage</strong>
          {vintagePricingComparisonRows.map((row) => (
            <span key={row.label}>{row.label}: {row.from}</span>
          ))}
        </div>
      ) : null}

      <div className="price-level-editor">
        <div className="section-heading compact-heading">
          <div>
            <h2>Price Levels</h2>
            <p>Frontline and Best calculate from landed cost until edited.</p>
          </div>
          <button className="button button-small" onClick={addPriceLevel} type="button">
            Add Level
          </button>
        </div>
        <div className="table-shell price-level-table-shell">
          <table>
            <thead>
              <tr>
                <th>Level</th>
                <th>Price</th>
                <th>DA</th>
                <th>GP</th>
                <th>Action</th>
              </tr>
            </thead>
            <tbody>
              {priceLevels.filter((level) => level.active && !(frontlineOnly && level.isBest)).map((level, index) => {
                const effective = priceLevelDraftToInput(level, index, computedPricing);
                const bottlePriceEntered = level.bottlePrice.trim().length > 0;
                const isBaseLevel = level.isFrontline || level.isBest;

                return (
                  <Fragment key={level.id}>
                  <tr>
                    <td>
                      {isBaseLevel
                        ? <strong>{level.isFrontline ? "Frontline" : "Best"}</strong>
                        : <input aria-label="Price level name" value={level.name} onChange={(event) => patchPriceLevel(level.id, { name: event.target.value })} />}
                    </td>
                    <td>
                      <div className="priced-field">
                        <input
                          aria-label="Bottle price"
                          min={0}
                          placeholder={String(effective.bottlePrice || "")}
                          step={0.01}
                          type="number"
                          value={level.isManualOverride ? level.bottlePrice : String(effective.suggestedPrice || "")}
                          onChange={(event) => patchPriceLevel(level.id, { bottlePrice: event.target.value, solveFor: "gp", isManualOverride: true })}
                        />
                        <small className={!bottlePriceEntered && isBaseLevel ? "price-suggestion-value" : undefined}>
                          {bottlePriceEntered
                            ? "Manual price"
                            : isBaseLevel
                              ? `Suggested ${formatCurrencyCents(effective.suggestedPrice)}`
                              : "Enter price"}
                        </small>
                      </div>
                    </td>
                    <td>
                      <input
                        aria-label="Depletion allowance"
                        min={0}
                        step={0.01}
                        type="number"
                        value={level.depletionAllowance}
                        onChange={(event) => patchPriceLevel(level.id, { depletionAllowance: event.target.value, solveFor: "gp" })}
                      />
                    </td>
                    <td className={effective.belowMinimumGp ? "danger-cell" : undefined}>{formatPercent(effective.calculatedGpMargin)}</td>
                    <td className="price-level-action-cell">
                      {isBaseLevel ? (
                        <button
                          className="ghost-button button-small"
                          disabled={!level.isManualOverride && !level.bottlePrice.trim()}
                          type="button"
                          onClick={() => patchPriceLevel(level.id, { bottlePrice: "", depletionAllowance: "0", targetGpMargin: "", solveFor: "gp", isManualOverride: false })}
                        >
                          Reset
                        </button>
                      ) : (
                        <button className="ghost-button remove-line-button" onClick={() => deactivatePriceLevel(level.id)} type="button">
                          Remove
                        </button>
                      )}
                    </td>
                  </tr>
                  {effective.noDaRequired || effective.daExceedsLandedCost || effective.solveInputsMissing ? (
                    <tr className="price-level-note-row"><td colSpan={5}>
                      {effective.solveInputsMissing ? `Enter the required inputs before solving for ${level.solveFor.toUpperCase()}. ` : ""}
                      {effective.noDaRequired ? "No DA required. " : ""}
                      {effective.daExceedsLandedCost ? "Warning: DA exceeds landed cost." : ""}
                    </td></tr>
                  ) : null}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="free-goods-editor">
        <div className="section-heading compact-heading">
          <div>
            <h2>Free Goods</h2>
            <p>V1 records program terms for buyer review only.</p>
          </div>
          <button className="button button-small" onClick={addFreeGood} type="button">
            Add Program
          </button>
        </div>
        {freeGoods.length === 0 ? <div className="inline-info">No free-goods program recorded for this SKU.</div> : null}
        {freeGoods.map((freeGood) => (
          <div className="free-good-row" key={freeGood.id}>
            <label>
              Buy
              <input min={0} type="number" value={freeGood.buyQuantity} onChange={(event) => patchFreeGood(freeGood.id, { buyQuantity: event.target.value })} />
            </label>
            <label>
              Free
              <input min={0} type="number" value={freeGood.freeQuantity} onChange={(event) => patchFreeGood(freeGood.id, { freeQuantity: event.target.value })} />
            </label>
            <label>
              Unit
              <select value={freeGood.unit} onChange={(event) => patchFreeGood(freeGood.id, { unit: event.target.value as "bottle" | "case" })}>
                <option value="case">case</option>
                <option value="bottle">bottle</option>
              </select>
            </label>
            <label>
              Program
              <input value={freeGood.programName} onChange={(event) => patchFreeGood(freeGood.id, { programName: event.target.value })} />
            </label>
            <label>
              Starts
              <input type="date" value={freeGood.startsOn} onChange={(event) => patchFreeGood(freeGood.id, { startsOn: event.target.value })} />
            </label>
            <label>
              Ends
              <input type="date" value={freeGood.endsOn} onChange={(event) => patchFreeGood(freeGood.id, { endsOn: event.target.value })} />
            </label>
            <label>
              Active
              <input
                className="approval-input"
                type="checkbox"
                checked={freeGood.active}
                onChange={(event) => patchFreeGood(freeGood.id, { active: event.target.checked })}
              />
            </label>
            <label className="wide-field">
              Notes
              <input value={freeGood.notes} onChange={(event) => patchFreeGood(freeGood.id, { notes: event.target.value })} />
            </label>
            <button className="ghost-button remove-line-button" onClick={() => setFreeGoods((current) => current.filter((row) => row.id !== freeGood.id))} type="button">
              Remove
            </button>
          </div>
        ))}
      </div>

      {warnings.map((warning) => (
        <div className="inline-warning" key={warning}>
          {warning}
        </div>
      ))}
      {lowGpBlocksSave ? (
        <div className="inline-warning">
          A price below 28% requires “Approve price,” an override reason, and an owner/approver.
        </div>
      ) : null}
      {duplicatePriceLevels.length > 0 ? (
        <div className="inline-warning">Possible duplicate active price level: {duplicatePriceLevels.join(", ")}. Deactivate it or document why both should remain active.</div>
      ) : null}
      {invalidPricingLadder ? (
        <div className="inline-warning">Frontline must be higher than Best. Reset either level to the suggestion or enter a valid manual ladder.</div>
      ) : null}
      {pricingModel === "grw_broker" ? (
        <div className="inline-info">GRW broker pricing is informational only and is excluded from recommendations, automatic price changes, and approval blocking.</div>
      ) : null}
      {existing ? (
        <div className="inline-info">
          Existing planning SKU found. Save Wine updates the existing supplier wine and creates a draft price-change event if FOB or frontline changed.
        </div>
      ) : null}
      {!effectiveQuickBooksIdentity.itemNumber ? (
        <div className="inline-warning">
          This SKU will be marked as a New Item in Order Review and PO Drafts until a QuickBooks Item Number is attached.
        </div>
      ) : null}
      {copiedFromSupplierCatalogWineId ? (
        <div className="inline-info">
          Copied from an existing SKU. Changing vintage, pack, or bottle size will save a separate orderable SKU row.
        </div>
      ) : null}
      {pendingEditId ? (
        <div className="inline-info">
          Pending edit mode is using the saved record ID, so Item Name changes update the original pending row instead of creating a duplicate.
        </div>
      ) : null}

      <div className="form-actions">
        <button className="button" disabled={isPending || lowGpBlocksSave || incompleteSolveBlocksSave || invalidTargetGpBlocksSave || invalidPricingLadder || !producer.trim() || !wineName.trim() || !hasValidPack || !computedPricing.suggestionsReady} onClick={saveWine} type="button">
          {pendingEditId ? "Save Changes" : existing ? "Update Wine" : "Save Wine"}
        </button>
      </div>
    </form>
  );
}

type PriceLevelDraft = {
  id: string;
  name: string;
  bottlePrice: string;
  depletionAllowance: string;
  targetGpMargin: string;
  solveFor: "price" | "da" | "gp";
  approvalDecision: "approve_price" | "pursue_da" | "revise" | "hold" | "no_change" | "";
  overrideReason: string;
  approvalOwner: string;
  decisionTimestamp: string;
  isFrontline: boolean;
  isBest: boolean;
  active: boolean;
  isManualOverride: boolean;
};

type FreeGoodDraft = {
  id: string;
  buyQuantity: string;
  freeQuantity: string;
  unit: "bottle" | "case";
  programName: string;
  startsOn: string;
  endsOn: string;
  notes: string;
  active: boolean;
};

function productIdentityMatchToTemplateWine(match: ProductIdentityMatch, query: string): SupplierCatalogWine {
  const requested = parseProductIdentityQuery(query);
  const vintage = requested.vintage || match.vintage || "NV";
  const packSize = requested.packSize || match.packSize || 12;
  const bottleSize = requested.bottleSize || match.bottleSize || "750ml";
  const identity = normalizeWineIdentity({
    producer: match.producer,
    wineName: match.wineName,
    vintage,
    packSize,
    bottleSize
  });
  const pricing = calculatePricing({
    packSize,
    fobBottle: match.fobBottle,
    laidInPerBottle: match.laidInPerBottle,
    frontlineBottlePrice: match.frontlineBottlePrice,
    bestPrice: match.bestPrice
  });

  return {
    id: match.source === "supplier_catalog" ? match.sourceId : `${match.source}-${match.sourceId}`,
    supplier_id: match.supplierId,
    supplier_name: match.supplierName,
    producer: match.producer,
    wine_name: match.wineName,
    vintage,
    pack_size: packSize,
    bottle_size: bottleSize,
    pricing_basis: "bottle",
    fob_bottle: pricing.fobBottle,
    fob_case: pricing.fobCase,
    laid_in_per_bottle: pricing.laidInPerBottle,
    landed_bottle_cost: pricing.landedBottleCost,
    frontline_bottle_price: pricing.frontlineBottlePrice,
    best_price: pricing.bestPrice,
    gross_profit_margin: pricing.grossProfitMargin,
    availability_status: "available",
    conversion_status: "exact_existing_product",
    display_name: identity.displayName,
    planning_sku: identity.planningSku,
    planning_sku_without_vintage: identity.planningSkuWithoutVintage,
    diagnostics: { source: match.source, source_id: match.sourceId },
    quickbooks_item_id: match.quickbooksItemId || (match.source === "quickbooks_item" ? match.sourceId : null),
    quickbooks_item_name: match.quickbooksItemName,
    quickbooks_item_number: match.quickbooksItemNumber,
    quickbooks_sync_status: match.quickbooksItemNumber || match.source === "quickbooks_item" ? "linked" : "not_created",
    product_lifecycle_status: match.source === "supplier_catalog" ? "supplier_available" : "active_product",
    accounting_create_payload: {},
    system_tags: match.systemTags,
    copied_from_supplier_catalog_wine_id: match.source === "supplier_catalog" ? match.sourceId : null,
    source_system: match.source,
    source_id: match.sourceId,
    price_levels: (match.priceLevels || []).map((level, index) => ({
      id: level.id,
      supplier_catalog_wine_id: match.source === "supplier_catalog" ? match.sourceId : "",
      name: level.name,
      bottle_price: level.bottlePrice,
      depletion_allowance: level.depletionAllowance,
      target_gp_margin: null,
      solve_for: "gp",
      calculated_gp_margin: calculateGpMargin({
        bottlePrice: level.bottlePrice,
        landedBottleCost: pricing.landedBottleCost,
        depletionAllowance: level.depletionAllowance
      }),
      is_frontline: level.isFrontline,
      is_best: level.isBest,
      display_order: index,
      active: level.active,
      source_system: level.sourceSystem,
      source_id: level.id,
      is_manual_override: false,
      created_at: level.updatedAt || "",
      updated_at: level.updatedAt || ""
    })),
    free_goods: [],
    workbench_items: [],
    created_at: match.updatedAt || "",
    updated_at: match.updatedAt || ""
  };
}

function defaultPriceLevelDrafts(): PriceLevelDraft[] {
  return [
    {
      id: "frontline",
      name: "Frontline",
      bottlePrice: "",
      depletionAllowance: "",
      targetGpMargin: "",
      solveFor: "gp",
      approvalDecision: "",
      overrideReason: "",
      approvalOwner: "",
      decisionTimestamp: "",
      isFrontline: true,
      isBest: false,
      active: true,
      isManualOverride: false
    },
    {
      id: "best",
      name: "Best",
      bottlePrice: "",
      depletionAllowance: "",
      targetGpMargin: "",
      solveFor: "gp",
      approvalDecision: "",
      overrideReason: "",
      approvalOwner: "",
      decisionTimestamp: "",
      isFrontline: false,
      isBest: true,
      active: true,
      isManualOverride: false
    }
  ];
}

function priceLevelDraftsFromWine(wine: SupplierCatalogWine, options: { asReference?: boolean } = {}): PriceLevelDraft[] {
  const existingLevels = wine.price_levels && wine.price_levels.length > 0
    ? [...wine.price_levels].sort((a, b) => asNumber(a.display_order) - asNumber(b.display_order))
    : [];
  const levels = [
    ...(!existingLevels.some((level) => level.active !== false && level.is_frontline)
      ? [
        {
          id: "frontline",
          name: "Frontline",
          bottle_price: wine.frontline_bottle_price,
          depletion_allowance: 0,
          target_gp_margin: null,
          solve_for: "gp",
          approval_decision: null,
          override_reason: null,
          approval_owner: null,
          decision_timestamp: null,
          is_frontline: true,
          is_best: false,
          active: true,
          is_manual_override: true,
          updated_at: wine.updated_at
        }
      ]
      : []),
    ...existingLevels,
    ...(!wine.frontline_only && !existingLevels.some((level) => level.active !== false && level.is_best)
      ? [
          {
            id: "best",
            name: "Best",
            bottle_price: wine.best_price,
            depletion_allowance: 0,
            target_gp_margin: null,
            solve_for: "gp",
            approval_decision: null,
            override_reason: null,
            approval_owner: null,
            decision_timestamp: null,
            is_frontline: false,
            is_best: true,
            active: true,
            is_manual_override: false,
            updated_at: wine.updated_at
          }
        ]
      : [])
  ];

  return levels.map((level, index) => ({
    id: `${level.id || "level"}-${index}`,
    name: level.name || `Level ${index + 1}`,
    bottlePrice: options.asReference && (level.is_frontline || level.is_best) ? "" : asNumber(level.bottle_price).toString(),
    depletionAllowance: options.asReference && (level.is_frontline || level.is_best)
      ? "0"
      : asNumber(level.depletion_allowance).toString(),
    targetGpMargin: level.target_gp_margin === null || level.target_gp_margin === undefined ? "" : (asNumber(level.target_gp_margin) * 100).toString(),
    solveFor: level.solve_for === "price" || level.solve_for === "da" ? level.solve_for : "gp",
    approvalDecision: (level.approval_decision || "") as PriceLevelDraft["approvalDecision"],
    overrideReason: level.override_reason || "",
    approvalOwner: level.approval_owner || "",
    decisionTimestamp: level.decision_timestamp || "",
    isFrontline: Boolean(level.is_frontline),
    isBest: Boolean(level.is_best),
    active: level.active !== false,
    isManualOverride: options.asReference ? !(level.is_frontline || level.is_best) : level.is_manual_override !== false
  }));
}

function freeGoodDraftsFromWine(wine: SupplierCatalogWine, options: { expirePastPrograms?: boolean } = {}): FreeGoodDraft[] {
  const today = new Date().toISOString().slice(0, 10);
  return (wine.free_goods || []).map((freeGood, index) => ({
    id: `${freeGood.id || "free"}-${index}`,
    buyQuantity: asNumber(freeGood.buy_quantity).toString(),
    freeQuantity: asNumber(freeGood.free_quantity).toString(),
    unit: freeGood.unit === "bottle" ? "bottle" : "case",
    programName: freeGood.program_name || "",
    startsOn: freeGood.starts_on || "",
    endsOn: freeGood.ends_on || "",
    notes: freeGood.notes || "",
    active: options.expirePastPrograms && freeGood.ends_on && freeGood.ends_on < today ? false : freeGood.active !== false
  }));
}

function conversionStatusForDraft(
  copiedFromWine: SupplierCatalogWine | null,
  currentIdentity: ReturnType<typeof normalizeWineIdentity>
): SupplierCatalogWineInput["conversionStatus"] {
  if (!copiedFromWine) return "net_new_product";
  const copiedIdentity = normalizeWineIdentity({
    producer: copiedFromWine.producer,
    wineName: copiedFromWine.wine_name,
    vintage: copiedFromWine.vintage || "NV",
    packSize: copiedFromWine.pack_size || 12,
    bottleSize: copiedFromWine.bottle_size || "750ml"
  });

  if (currentIdentity.planningSku === copiedFromWine.planning_sku) return "exact_existing_product";
  if (currentIdentity.packFormat !== copiedIdentity.packFormat) return "new_format";
  if (currentIdentity.normalizedVintage !== copiedIdentity.normalizedVintage) return "new_vintage";
  return "possible_match_needs_review";
}

function normalizeConversionStatus(value: string): SupplierCatalogWineInput["conversionStatus"] {
  return PENDING_CONVERSION_STATUSES.has(value) ? (value as SupplierCatalogWineInput["conversionStatus"]) : "net_new_product";
}

function parseOptionalPercent(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  if (parsed < 0 || parsed >= 100) return null;
  return parsed / 100;
}

function priceLevelDraftToInput(level: PriceLevelDraft, index: number, pricing: ReturnType<typeof calculatePricing>) {
  const fallbackPrice = level.isFrontline
    ? pricing.frontlineBottlePrice
    : level.isBest
      ? pricing.bestPrice || 0
      : 0;
  const bottlePrice = level.isManualOverride ? parseOptionalNumber(level.bottlePrice) : null;
  const targetGpMargin = parseOptionalPercent(level.targetGpMargin);
  const depletionAllowance = parseOptionalNumber(level.depletionAllowance);
  const solveInputsMissing = (level.solveFor === "price" && targetGpMargin === null) ||
    (level.solveFor === "da" && (targetGpMargin === null || bottlePrice === null));
  const balanced = balancePriceLevel({
    bottlePrice,
    depletionAllowance,
    targetGpMargin,
    landedBottleCost: pricing.landedBottleCost,
    fallbackBottlePrice: fallbackPrice,
    solveFor: solveInputsMissing ? "gp" : level.solveFor
  });

  return {
    name: level.name || `Level ${index + 1}`,
    bottlePrice: balanced.bottlePrice,
    depletionAllowance: balanced.depletionAllowance,
    targetGpMargin: balanced.targetGpMargin,
    solveFor: solveInputsMissing ? "gp" : level.solveFor,
    requestedSolveFor: level.solveFor,
    solveInputsMissing,
    approvalDecision: level.approvalDecision || null,
    overrideReason: level.overrideReason || null,
    approvalOwner: level.approvalOwner || null,
    decisionTimestamp: level.decisionTimestamp || null,
    suggestedPrice: fallbackPrice,
    suggestedGpMargin: calculateGpMargin({ bottlePrice: fallbackPrice, landedBottleCost: pricing.landedBottleCost }),
    daAlternative: balancePriceLevel({
      bottlePrice: balanced.bottlePrice,
      landedBottleCost: pricing.landedBottleCost,
      targetGpMargin: 0.28,
      solveFor: "da"
    }).depletionAllowance,
    finalApprovedPrice: level.approvalDecision === "approve_price" ? balanced.bottlePrice : null,
    finalApprovedDa: level.approvalDecision === "approve_price" ? balanced.depletionAllowance : null,
    finalGpMargin: level.approvalDecision === "approve_price" ? balanced.calculatedGpMargin : null,
    calculatedGpMargin: balanced.calculatedGpMargin,
    calculatedField: balanced.calculatedField,
    noDaRequired: balanced.noDaRequired,
    daExceedsLandedCost: balanced.daExceedsLandedCost,
    belowMinimumGp: balanced.belowMinimumGp,
    isFrontline: level.isFrontline,
    isBest: level.isBest,
    displayOrder: index,
    active: level.active,
    isManualOverride: level.isManualOverride
  };
}

function freeGoodDraftToInput(freeGood: FreeGoodDraft) {
  return {
    buyQuantity: parseOptionalNumber(freeGood.buyQuantity) || 0,
    freeQuantity: parseOptionalNumber(freeGood.freeQuantity) || 0,
    unit: freeGood.unit,
    programName: freeGood.programName,
    startsOn: freeGood.startsOn || null,
    endsOn: freeGood.endsOn || null,
    notes: freeGood.notes,
    active: freeGood.active
  };
}

function SearchWinesPanel({ wines }: { wines: SupplierCatalogWine[] }) {
  const [search, setSearch] = useState("");
  const [supplier, setSupplier] = useState("All");
  const [status, setStatus] = useState("All");
  const supplierOptions = useMemo(() => ["All", ...uniqueSorted(wines.map((wine) => wine.supplier_name))], [wines]);
  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return wines.filter((wine) => {
      if (supplier !== "All" && wine.supplier_name !== supplier) return false;
      if (status !== "All" && wine.availability_status !== status) return false;
      if (!needle) return true;
      return [wine.display_name, wine.supplier_name, wine.producer, wine.wine_name, wine.planning_sku, wine.quickbooks_item_name]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [search, status, supplier, wines]);

  return (
    <div className="supplier-hub-workspace">
      <div className="supplier-hub-toolbar">
        <label className="search-field">
          Search
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Wine, producer, supplier, SKU" />
        </label>
        <label>
          Supplier
          <select value={supplier} onChange={(event) => setSupplier(event.target.value)}>
            {supplierOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label>
          Availability
          <select value={status} onChange={(event) => setStatus(event.target.value)}>
            <option>All</option>
            {AVAILABILITY_STATUSES.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <span>{formatInteger(filtered.length)} shown</span>
      </div>
      <div className="table-shell catalog-table-shell">
        <table>
          <thead>
            <tr>
              <th>Wine</th>
              <th>Supplier</th>
              <th>Status</th>
              <th>Match</th>
              <th>FOB</th>
              <th>Laid In</th>
              <th>Frontline</th>
              <th>Best</th>
              <th>QB Sync</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((wine) => (
              <tr key={wine.id}>
                <td>
                  <strong>{wine.display_name}</strong>
                  <span>{wine.planning_sku}</span>
                </td>
                <td>{wine.supplier_name}</td>
                <td><StatusPill value={wine.availability_status} /></td>
                <td><StatusPill value={wine.conversion_status} /></td>
                <td>{formatCurrency(asNumber(wine.fob_bottle))}</td>
                <td>{formatCurrency(asNumber(wine.laid_in_per_bottle))}</td>
                <td>{formatCurrency(asNumber(wine.frontline_bottle_price))}</td>
                <td>{wine.best_price === null ? "Frontline only" : formatCurrency(asNumber(wine.best_price))}</td>
                <td><StatusPill value={wine.quickbooks_sync_status} /></td>
              </tr>
            ))}
            {filtered.length === 0 ? <EmptyRow colSpan={9} label="No supplier wines match the current filters." /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RequestsPanel({
  wines,
  requests,
  isPending,
  onCreateWineRequest,
  onUpdateWineRequestApproval
}: {
  wines: SupplierCatalogWine[];
  requests: WineRequest[];
  isPending: boolean;
  onCreateWineRequest: (input: CreateWineRequestInput) => void;
  onUpdateWineRequestApproval: (input: UpdateWineRequestApprovalInput) => void;
}) {
  const [selectedWineId, setSelectedWineId] = useState("net_new");
  const selectedWine = wines.find((wine) => wine.id === selectedWineId) || null;
  const [supplierName, setSupplierName] = useState("");
  const [wineDisplayName, setWineDisplayName] = useState("");
  const [accountCustomer, setAccountCustomer] = useState("");
  const [requestedQuantity, setRequestedQuantity] = useState("1");
  const [neededByDate, setNeededByDate] = useState("");
  const [placementType, setPlacementType] = useState("BTG");
  const [requesterName, setRequesterName] = useState("");
  const [notes, setNotes] = useState("");

  useEffect(() => {
    if (selectedWine) {
      setSupplierName(selectedWine.supplier_name);
      setWineDisplayName(selectedWine.display_name);
    }
  }, [selectedWine]);

  function createRequest(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onCreateWineRequest({
      sourceType: selectedWine ? "supplier_available_wine" : "net_new_wine",
      supplierCatalogWineId: selectedWine?.id || null,
      supplierName,
      wineDisplayName,
      accountCustomer,
      requestedQuantity: Math.max(1, Math.round(Number(requestedQuantity) || 1)),
      neededByDate: neededByDate || null,
      placementType,
      requesterName,
      notes
    });
  }

  return (
    <div className="supplier-hub-workspace">
      <form className="request-form-grid" onSubmit={createRequest}>
        <label className="wide-field">
          Wine selector
          <select value={selectedWineId} onChange={(event) => setSelectedWineId(event.target.value)}>
            <option value="net_new">Net new wine</option>
            {wines.map((wine) => (
              <option key={wine.id} value={wine.id}>
                {wine.display_name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Supplier
          <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
        </label>
        <label>
          Item Name
          <input required value={wineDisplayName} onChange={(event) => setWineDisplayName(event.target.value)} />
        </label>
        <label>
          Account/customer
          <input required value={accountCustomer} onChange={(event) => setAccountCustomer(event.target.value)} />
        </label>
        <label>
          Requested quantity
          <input min={1} type="number" value={requestedQuantity} onChange={(event) => setRequestedQuantity(event.target.value)} />
        </label>
        <label>
          Needed by date
          <input type="date" value={neededByDate} onChange={(event) => setNeededByDate(event.target.value)} />
        </label>
        <label>
          Placement type
          <select value={placementType} onChange={(event) => setPlacementType(event.target.value)}>
            {PLACEMENT_TYPES.map((type) => (
              <option key={type}>{type}</option>
            ))}
          </select>
        </label>
        <label>
          Requester
          <input value={requesterName} onChange={(event) => setRequesterName(event.target.value)} />
        </label>
        <label className="wide-field">
          Notes/comments
          <textarea required={placementType === "Other"} value={notes} onChange={(event) => setNotes(event.target.value)} />
        </label>
        <div className="form-actions wide-field">
          <button className="button" disabled={isPending || !wineDisplayName.trim() || !accountCustomer.trim()} type="submit">
            Create Request
          </button>
        </div>
      </form>

      <div className="table-shell request-table-shell">
        <table>
          <thead>
            <tr>
              <th>Request</th>
              <th>Wine</th>
              <th>Account</th>
              <th>Qty</th>
              <th>Placement</th>
              <th>Status</th>
              <th>Fulfillment</th>
              <th>Approval</th>
            </tr>
          </thead>
          <tbody>
            {requests.map((request) => (
              <RequestRow
                key={request.id}
                request={request}
                isPending={isPending}
                onUpdateWineRequestApproval={onUpdateWineRequestApproval}
              />
            ))}
            {requests.length === 0 ? <EmptyRow colSpan={8} label="No wine requests yet." /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function RequestRow({
  request,
  isPending,
  onUpdateWineRequestApproval
}: {
  request: WineRequest;
  isPending: boolean;
  onUpdateWineRequestApproval: (input: UpdateWineRequestApprovalInput) => void;
}) {
  const [approverName, setApproverName] = useState(request.approver_name || "Mark");
  const [approvalDecision, setApprovalDecision] = useState(request.approval_decision || "approve");

  return (
    <tr>
      <td>
        <strong>{request.request_id}</strong>
        <span>{request.requester_name || "Unassigned requester"}</span>
      </td>
      <td>
        <strong>{request.wine_display_name}</strong>
        <span>{request.supplier_name || request.source_type}</span>
      </td>
      <td>{request.account_customer}</td>
      <td>{formatInteger(asNumber(request.requested_quantity))}</td>
      <td>{request.placement_type}</td>
      <td><StatusPill value={request.request_status} /></td>
      <td><StatusPill value={request.fulfillment_status} /></td>
      <td>
        <div className="approval-controls">
          <select value={approverName} onChange={(event) => setApproverName(event.target.value)}>
            {APPROVER_NAMES.map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
          <select value={approvalDecision} onChange={(event) => setApprovalDecision(event.target.value)}>
            {APPROVAL_DECISIONS.map((decision) => (
              <option key={decision}>{decision}</option>
            ))}
          </select>
          <button
            className="button button-tiny"
            disabled={isPending}
            onClick={() => onUpdateWineRequestApproval({ id: request.id, approverName, approvalDecision })}
            type="button"
          >
            Save
          </button>
        </div>
      </td>
    </tr>
  );
}

function PendingProductCreationPanel({
  wines,
  requests,
  isPending,
  onDeleteCatalogWine,
  onEditCatalogWine
}: {
  wines: SupplierCatalogWine[];
  requests: WineRequest[];
  isPending: boolean;
  onDeleteCatalogWine: (input: DeleteCatalogWineInput) => void;
  onEditCatalogWine: (wine: SupplierCatalogWine) => void;
}) {
  const pendingWines = wines.filter(isDraftOnlyCatalogWine);
  const pendingRequests = requests.filter(
    (request) => request.request_status === "approved" && request.approval_decision === "approve_as_new_stem_product"
  );

  function confirmDelete(wine: SupplierCatalogWine) {
    const message = `Delete pending product "${wine.display_name}"? This removes only the pending catalog draft and draft-only pricing/free-good/workbench records.`;
    if (!window.confirm(message)) return;
    onDeleteCatalogWine({ id: wine.id });
  }

  return (
    <div className="supplier-hub-workspace">
      <div className="table-shell pending-table-shell">
        <table>
          <thead>
            <tr>
              <th>Item</th>
              <th>Source</th>
              <th>Supplier</th>
              <th>Reason</th>
              <th>QB Status</th>
              <th>Lifecycle</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {pendingWines.map((wine) => (
              <tr key={wine.id}>
                <td>
                  <strong>{wine.display_name}</strong>
                  <span>{wine.planning_sku}</span>
                </td>
                <td>Supplier catalog wine</td>
                <td>{wine.supplier_name}</td>
                <td><StatusPill value={wine.conversion_status} /></td>
                <td><StatusPill value={wine.quickbooks_sync_status} /></td>
                <td><StatusPill value={wine.product_lifecycle_status} /></td>
                <td>
                  <div className="pending-row-actions">
                    <button className="ghost-button button-tiny" disabled={isPending} onClick={() => onEditCatalogWine(wine)} type="button">
                      Edit
                    </button>
                    <button className="ghost-button button-tiny danger-button" disabled={isPending} onClick={() => confirmDelete(wine)} type="button">
                      Delete
                    </button>
                  </div>
                </td>
              </tr>
            ))}
            {pendingRequests.map((request) => (
              <tr key={request.id}>
                <td>
                  <strong>{request.wine_display_name}</strong>
                  <span>{request.request_id}</span>
                </td>
                <td>Approved request</td>
                <td>{request.supplier_name}</td>
                <td><StatusPill value="approve_as_new_stem_product" /></td>
                <td><StatusPill value="not_created" /></td>
                <td><StatusPill value="pending_product_creation" /></td>
                <td>
                  <span className="muted">Request only</span>
                </td>
              </tr>
            ))}
            {pendingWines.length + pendingRequests.length === 0 ? (
              <EmptyRow colSpan={7} label="No wines are waiting on official QuickBooks product creation." />
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="inline-info">
        Items in this queue are saved pending records, not official Stem products. Delete is limited to draft-only records without linked QuickBooks items.
      </div>
    </div>
  );
}

function PriceChangesPanel({ events }: { events: PriceChangeEvent[] }) {
  return (
    <div className="supplier-hub-workspace">
      <div className="table-shell price-change-table-shell">
        <table>
          <thead>
            <tr>
              <th>Wine</th>
              <th>Supplier</th>
              <th>FOB</th>
              <th>Frontline</th>
              <th>Best</th>
              <th>Margin</th>
              <th>Effective</th>
              <th>Status</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {events.map((event) => (
              <tr key={event.id}>
                <td>
                  <strong>{event.wine}</strong>
                  <span>{event.vintage}</span>
                </td>
                <td>{event.supplier}</td>
                <td>{formatCurrency(asNumber(event.old_fob))} {"->"} {formatCurrency(asNumber(event.new_fob))}</td>
                <td>{formatCurrency(asNumber(event.old_frontline))} {"->"} {formatCurrency(asNumber(event.new_frontline))}</td>
                <td>{formatNullableCurrency(event.old_best_price)} {"->"} {formatNullableCurrency(event.new_best_price)}</td>
                <td>{formatPercent(event.margin_before)} {"->"} {formatPercent(event.margin_after)}</td>
                <td>{event.effective_date || ""}</td>
                <td><StatusPill value={event.status} /></td>
                <td>{event.reason || ""}</td>
              </tr>
            ))}
            {events.length === 0 ? <EmptyRow colSpan={9} label="No price change events yet." /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplierLogisticsPanel({
  suppliers,
  quickBooksSupplierMatches,
  isPending,
  onSaveSuppliers
}: {
  suppliers: SupplierLogistics[];
  quickBooksSupplierMatches: SupplierQuickBooksVendorMatch[];
  isPending: boolean;
  onSaveSuppliers: (suppliers: SupplierLogistics[]) => void;
}) {
  const [draftRows, setDraftRows] = useState<SupplierLogistics[]>([]);
  const [editedRows, setEditedRows] = useState<SupplierLogistics[]>(suppliers);
  const [search, setSearch] = useState("");
  const [pickupLocation, setPickupLocation] = useState("All");
  const [showInactive, setShowInactive] = useState(false);
  const originalById = useMemo(() => new Map(suppliers.map((supplier) => [supplier.id, supplier])), [suppliers]);
  const rows = useMemo(() => [...draftRows, ...editedRows], [draftRows, editedRows]);
  const changedRows = useMemo(
    () => rows.filter((row) => row.id.startsWith("new-") || JSON.stringify(row) !== JSON.stringify(originalById.get(row.id))),
    [originalById, rows]
  );
  const invalidChangedRows = changedRows.filter((row) => !row.name.trim());
  const pickupOptions = useMemo(
    () => ["All", ...uniqueSorted(rows.map((supplier) => supplier.pick_up_location))],
    [rows]
  );
  const qbMatchesBySupplierId = useMemo(() => {
    const grouped = new Map<string, SupplierQuickBooksVendorMatch[]>();
    quickBooksSupplierMatches.forEach((match) => {
      grouped.set(match.supplier_id, [...(grouped.get(match.supplier_id) || []), match]);
    });
    return grouped;
  }, [quickBooksSupplierMatches]);
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return rows.filter((supplier) => {
      const isDraft = supplier.id.startsWith("new-");
      if (!showInactive && supplier.active === false && !isDraft) return false;
      if (pickupLocation !== "All" && (supplier.pick_up_location?.trim() || "") !== pickupLocation) return false;
      if (!needle) return true;
      const quickBooksMatches = qbMatchesBySupplierId.get(supplier.id) || [];

      return [
        supplier.name,
        supplier.importer_id,
        supplier.tdm,
        supplier.pick_up_location,
        supplier.freight_forwarder,
        supplier.order_frequency,
        supplier.notes,
        ...quickBooksMatches.flatMap((match) => [
          match.vendor_name,
          match.vendor_classification,
          match.notes
        ])
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [pickupLocation, qbMatchesBySupplierId, rows, search, showInactive]);
  const activeCount = suppliers.filter((supplier) => supplier.active !== false).length;
  const inactiveCount = suppliers.length - activeCount;
  const averageLaidIn =
    activeCount > 0
      ? suppliers
          .filter((supplier) => supplier.active !== false)
          .reduce((sum, supplier) => sum + asNumber(supplier.trucking_cost_per_bottle), 0) / activeCount
      : 0;

  useEffect(() => {
    setEditedRows(suppliers);
  }, [suppliers]);

  function addDraftRow() {
    setDraftRows((current) => [
      {
        id: `new-${Date.now()}`,
        importer_id: null,
        name: "",
        eta_days: 0,
        pick_up_location: "",
        freight_forwarder: "",
        order_frequency: "",
        tdm: "",
        trucking_cost_per_bottle: 0,
        notes: "",
        active: true
      },
      ...current
    ]);
  }

  function discardDraftRow(id: string) {
    setDraftRows((current) => current.filter((supplier) => supplier.id !== id));
  }

  function patchSupplier(id: string, patch: Partial<SupplierLogistics>) {
    const setter = id.startsWith("new-") ? setDraftRows : setEditedRows;
    setter((current) => current.map((supplier) => (supplier.id === id ? { ...supplier, ...patch } : supplier)));
  }

  function resetSupplier(id: string) {
    const original = originalById.get(id);
    if (!original) return;
    setEditedRows((current) => current.map((supplier) => (supplier.id === id ? original : supplier)));
  }

  function saveChanges() {
    if (changedRows.length === 0 || invalidChangedRows.length > 0) return;
    onSaveSuppliers(changedRows);
  }

  return (
    <div className="supplier-hub-workspace">
      <div className="section-heading compact-heading">
        <div>
          <h2>Supplier Logistics</h2>
          <p>Maintain supplier defaults used by purchasing and laid-in calculations.</p>
        </div>
        <div className="supplier-form-header-actions">
          <button className="ghost-button" onClick={addDraftRow} disabled={isPending} type="button">
            Add Supplier
          </button>
          <button
            className="button button-small"
            onClick={saveChanges}
            disabled={isPending || changedRows.length === 0 || invalidChangedRows.length > 0}
            type="button"
          >
            Save Changes
          </button>
        </div>
      </div>
      <div className="supplier-hub-summary logistics-summary">
        <div>
          <span>Active</span>
          <strong>{formatInteger(activeCount)}</strong>
        </div>
        <div>
          <span>Inactive</span>
          <strong>{formatInteger(inactiveCount)}</strong>
        </div>
        <div>
          <span>Avg Laid In</span>
          <strong>{formatCurrency(averageLaidIn)}</strong>
        </div>
        <div>
          <span>QB Matched</span>
          <strong>{formatInteger(new Set(quickBooksSupplierMatches.map((match) => match.supplier_id)).size)}</strong>
        </div>
      </div>
      <div className="supplier-hub-toolbar">
        <label className="search-field">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Supplier, QB vendor, TDM, pickup, notes"
          />
        </label>
        <label>
          Pickup
          <select value={pickupLocation} onChange={(event) => setPickupLocation(event.target.value)}>
            {pickupOptions.map((option) => (
              <option key={option}>{option}</option>
            ))}
          </select>
        </label>
        <label className="check-control">
          <input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} />
          Show inactive
        </label>
        <span>{formatInteger(filteredRows.length)} shown</span>
        <span>{formatInteger(changedRows.length)} unsaved</span>
      </div>
      <div className="table-shell logistics-table-shell">
        <table className="logistics-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>QB Vendor</th>
              <th>Importer ID</th>
              <th>TDM</th>
              <th>Pickup</th>
              <th>Freight Forwarder</th>
              <th>Frequency</th>
              <th>ETA</th>
              <th>Laid In / Bottle</th>
              <th>Active</th>
              <th>Notes</th>
              <th>State</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((supplier) => (
              <SupplierLogisticsRow
                key={supplier.id}
                supplier={supplier}
                quickBooksMatches={qbMatchesBySupplierId.get(supplier.id) || []}
                original={originalById.get(supplier.id) || null}
                disabled={isPending}
                onPatchSupplier={patchSupplier}
                onResetSupplier={resetSupplier}
                onDiscardDraft={discardDraftRow}
              />
            ))}
            {filteredRows.length === 0 ? <EmptyRow colSpan={12} label="No suppliers match the current filters." /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplierLogisticsRow({
  supplier,
  quickBooksMatches,
  original,
  disabled,
  onPatchSupplier,
  onResetSupplier,
  onDiscardDraft
}: {
  supplier: SupplierLogistics;
  quickBooksMatches: SupplierQuickBooksVendorMatch[];
  original: SupplierLogistics | null;
  disabled: boolean;
  onPatchSupplier: (id: string, patch: Partial<SupplierLogistics>) => void;
  onResetSupplier: (id: string) => void;
  onDiscardDraft: (id: string) => void;
}) {
  function patch(patchRow: Partial<SupplierLogistics>) {
    onPatchSupplier(supplier.id, patchRow);
  }

  const row = supplier;
  const isNew = row.id.startsWith("new-");
  const isDirty = isNew || JSON.stringify(row) !== JSON.stringify(original);
  const isActive = row.active ?? true;
  const rowClassName = [
    row.active === false ? "inactive-row" : "",
    isNew ? "draft-row" : "",
    !isNew && isDirty ? "dirty-row" : ""
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <tr className={rowClassName || undefined}>
      <td>
        <input aria-label="Supplier name" value={row.name} onChange={(event) => patch({ name: event.target.value })} />
      </td>
      <td>
        <QuickBooksVendorMatchCell matches={isNew ? [] : quickBooksMatches} />
      </td>
      <td>
        <input aria-label="Importer ID" value={row.importer_id || ""} onChange={(event) => patch({ importer_id: event.target.value })} />
      </td>
      <td>
        <input aria-label="TDM" value={row.tdm || ""} onChange={(event) => patch({ tdm: event.target.value })} />
      </td>
      <td>
        <input aria-label="Pickup location" value={row.pick_up_location || ""} onChange={(event) => patch({ pick_up_location: event.target.value })} />
      </td>
      <td>
        <input aria-label="Freight forwarder" value={row.freight_forwarder || ""} onChange={(event) => patch({ freight_forwarder: event.target.value })} />
      </td>
      <td>
        <input aria-label="Order frequency" value={row.order_frequency || ""} onChange={(event) => patch({ order_frequency: event.target.value })} />
      </td>
      <td>
        <input
          aria-label="ETA days"
          type="number"
          min={0}
          value={asNumber(row.eta_days)}
          onChange={(event) => patch({ eta_days: Number(event.target.value) })}
        />
      </td>
      <td>
        <input
          aria-label="Laid in per bottle"
          type="number"
          min={0}
          step={0.01}
          value={asNumber(row.trucking_cost_per_bottle)}
          onChange={(event) => patch({ trucking_cost_per_bottle: Number(event.target.value) })}
        />
      </td>
      <td>
        <input
          aria-label="Active"
          className="approval-input"
          type="checkbox"
          checked={row.active ?? true}
          onChange={(event) => patch({ active: event.target.checked })}
        />
      </td>
      <td>
        <input aria-label="Notes" value={row.notes || ""} onChange={(event) => patch({ notes: event.target.value })} />
      </td>
      <td>
        <div className="supplier-row-actions">
          {isNew ? <span className="row-state-badge">New</span> : null}
          {!isNew && isDirty ? <span className="row-state-badge">Unsaved</span> : null}
          {!isNew ? (
            <button
              className={isActive ? "ghost-button supplier-delete-button" : "ghost-button supplier-reset-button"}
              disabled={disabled}
              onClick={() => patch({ active: !isActive })}
              type="button"
            >
              {isActive ? "Deactivate" : "Restore"}
            </button>
          ) : null}
          {isNew ? (
            <button className="ghost-button supplier-reset-button" disabled={disabled} onClick={() => onDiscardDraft(row.id)} type="button">
              Cancel
            </button>
          ) : null}
          {!isNew && isDirty ? (
            <button className="ghost-button supplier-reset-button" disabled={disabled} onClick={() => onResetSupplier(row.id)} type="button">
              Reset
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function QuickBooksVendorMatchCell({ matches }: { matches: SupplierQuickBooksVendorMatch[] }) {
  if (matches.length === 0) {
    return (
      <div className="qb-match-cell">
        <span className="status-pill status-muted">No QB match</span>
      </div>
    );
  }

  const activeInventoryMatches = matches.filter(
    (match) => match.vendor_classification === "inventory_wine" && match.vendor_is_active !== false
  );
  const hasInactiveMatch = matches.some((match) => match.vendor_is_active === false);
  const hasNonInventoryMatch = matches.some((match) => match.vendor_classification !== "inventory_wine");
  const primaryMatch = activeInventoryMatches[0] || matches[0];
  const statusLabel = activeInventoryMatches.length > 0 ? "QB matched" : hasInactiveMatch ? "Inactive QB vendor" : "Review QB type";
  const statusClass = activeInventoryMatches.length > 0 ? "status-good" : "status-progress";
  const detail = matches.length > 1 ? `${matches.length} QB vendors` : primaryMatch.vendor_name;

  return (
    <div className="qb-match-cell">
      <span className={`status-pill ${statusClass}`}>{statusLabel}</span>
      <small>{detail}</small>
      {hasNonInventoryMatch ? <small>Stem type is not Inventory / Wine</small> : null}
    </div>
  );
}

function StatusPill({ value }: { value: string | null | undefined }) {
  const text = value || "unknown";
  const className = text.includes("approved") || text === "linked" || text === "available" ? "status-good" : text.includes("pending") || text.includes("draft") || text.includes("new") ? "status-progress" : "status-muted";
  return <span className={`status-pill ${className}`}>{text.replace(/_/g, " ")}</span>;
}

function EmptyRow({ colSpan, label }: { colSpan: number; label: string }) {
  return (
    <tr>
      <td colSpan={colSpan}>
        <div className="empty-inline">{label}</div>
      </td>
    </tr>
  );
}

function parseOptionalNumber(value: string) {
  if (!value.trim()) return null;
  return Math.max(0, money(value));
}

function formatNullableCurrency(value: number | string | null | undefined) {
  return value === null || value === undefined || value === "" ? "Frontline only" : formatCurrency(asNumber(value));
}

function formatPercent(value: number | string | null | undefined) {
  return `${(asNumber(value) * 100).toFixed(1)}%`;
}
