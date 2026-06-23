import { useEffect, useMemo, useState } from "react";
import { parseProductIdentityQuery, type ProductIdentityMatch } from "@/lib/product-identity-search";
import type { PriceChangeEvent, SupplierCatalogWine, SupplierLogistics, WineRequest } from "@/lib/types";
import { asNumber, formatCurrency, formatCurrencyCents, formatInteger, uniqueSorted } from "@/lib/order-data";
import {
  APPROVAL_DECISIONS,
  APPROVER_NAMES,
  AVAILABILITY_STATUSES,
  PLACEMENT_TYPES,
  SYSTEM_TAGS,
  balancePriceLevel,
  buildSupplierCatalogWine,
  calculateGpMargin,
  calculatePricing,
  defaultLaidInForSupplier,
  money,
  normalizeWineIdentity,
  type SupplierCatalogWineInput
} from "@/lib/supplier-catalog";

type HubArea = "search" | "add" | "requests" | "pending" | "price-changes" | "logistics";
type SaveCatalogWineInput = Parameters<typeof buildSupplierCatalogWine>[0] & { priceChangeReason?: string };
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

export function SupplierHubView({
  suppliers,
  supplierCatalogWines,
  wineRequests,
  priceChangeEvents,
  isPending,
  onCreateWineRequest,
  onSaveCatalogWine,
  onSaveSupplier,
  onUpdateWineRequestApproval
}: {
  suppliers: SupplierLogistics[];
  supplierCatalogWines: SupplierCatalogWine[];
  wineRequests: WineRequest[];
  priceChangeEvents: PriceChangeEvent[];
  isPending: boolean;
  onCreateWineRequest: (input: CreateWineRequestInput) => void;
  onSaveCatalogWine: (input: SaveCatalogWineInput) => void;
  onSaveSupplier: (supplier: SupplierLogistics) => void;
  onUpdateWineRequestApproval: (input: UpdateWineRequestApprovalInput) => void;
}) {
  const [activeArea, setActiveArea] = useState<HubArea>("search");
  const pendingWineCount = supplierCatalogWines.filter((wine) => PENDING_CONVERSION_STATUSES.has(wine.conversion_status)).length;
  const pendingRequestCount = wineRequests.filter((request) => request.request_status === "pending_review").length;
  const draftPriceChanges = priceChangeEvents.filter((event) => event.status === "draft").length;

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
          <strong>{formatInteger(supplierCatalogWines.length)}</strong>
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

      {activeArea === "search" ? <SearchWinesPanel wines={supplierCatalogWines} /> : null}
      {activeArea === "add" ? (
        <AddWinePanel
          suppliers={suppliers}
          wines={supplierCatalogWines}
          isPending={isPending}
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
      {activeArea === "pending" ? <PendingProductCreationPanel wines={supplierCatalogWines} requests={wineRequests} /> : null}
      {activeArea === "price-changes" ? <PriceChangesPanel events={priceChangeEvents} /> : null}
      {activeArea === "logistics" ? <SupplierLogisticsPanel suppliers={suppliers} isPending={isPending} onSaveSupplier={onSaveSupplier} /> : null}
    </section>
  );
}

function AddWinePanel({
  suppliers,
  wines,
  isPending,
  onSaveCatalogWine
}: {
  suppliers: SupplierLogistics[];
  wines: SupplierCatalogWine[];
  isPending: boolean;
  onSaveCatalogWine: (input: SaveCatalogWineInput) => void;
}) {
  const firstSupplier = suppliers[0] || null;
  const [supplierId, setSupplierId] = useState(firstSupplier?.id || "");
  const [supplierName, setSupplierName] = useState(firstSupplier?.name || "Manual Supplier");
  const [producer, setProducer] = useState("");
  const [wineName, setWineName] = useState("");
  const [vintage, setVintage] = useState("NV");
  const [packSize, setPackSize] = useState("12");
  const [bottleSize, setBottleSize] = useState("750ml");
  const [fobBottle, setFobBottle] = useState("");
  const [fobCase, setFobCase] = useState("");
  const [laidInPerBottle, setLaidInPerBottle] = useState(() => String(defaultLaidInForSupplier(suppliers, firstSupplier?.id || null, firstSupplier?.name || "")));
  const [systemTags, setSystemTags] = useState<string[]>([]);
  const [quickbooksItemId, setQuickbooksItemId] = useState("");
  const [quickbooksItemName, setQuickbooksItemName] = useState("");
  const [quickbooksItemNumber, setQuickbooksItemNumber] = useState("");
  const [copiedFromSupplierCatalogWineId, setCopiedFromSupplierCatalogWineId] = useState<string | null>(null);
  const [templateWine, setTemplateWine] = useState<SupplierCatalogWine | null>(null);
  const [wineNameMatches, setWineNameMatches] = useState<ProductIdentityMatch[]>([]);
  const [wineMatchError, setWineMatchError] = useState("");
  const [isSearchingWineMatches, setIsSearchingWineMatches] = useState(false);
  const [priceLevels, setPriceLevels] = useState<PriceLevelDraft[]>(() => defaultPriceLevelDrafts());
  const [freeGoods, setFreeGoods] = useState<FreeGoodDraft[]>([]);
  const [priceChangeReason, setPriceChangeReason] = useState("Manual catalog update");
  const sortedCloneOptions = useMemo(() => [...wines].sort(sortNewestVintageFirst), [wines]);
  const producerOptions = useMemo(() => uniqueSorted(wines.map((wine) => wine.producer)), [wines]);
  const computedPricing = calculatePricing({
    packSize: Math.max(1, Math.trunc(Number(packSize) || 12)),
    fobBottle: parseOptionalNumber(fobBottle),
    fobCase: parseOptionalNumber(fobCase),
    laidInPerBottle: parseOptionalNumber(laidInPerBottle) || 0
  });
  const draftPriceLevels = priceLevels
    .map((level, index) => priceLevelDraftToInput(level, index, computedPricing))
    .filter((level) => level.active && (money(level.bottlePrice) > 0 || level.isFrontline));
  const copiedFromWine = templateWine;
  const showWineNameMatches = wineName.trim().length >= 3 && !templateWine;
  const currentIdentity = normalizeWineIdentity({
    producer,
    wineName,
    vintage,
    packSize: Math.max(1, Math.trunc(Number(packSize) || 12)),
    bottleSize
  });
  const copiedSkuChanged = Boolean(copiedFromWine && currentIdentity.planningSku !== copiedFromWine.planning_sku);
  const effectiveQuickbooksItemNumber =
    copiedSkuChanged && quickbooksItemNumber.trim() === (copiedFromWine?.quickbooks_item_number || "").trim()
      ? ""
      : quickbooksItemNumber;
  const conversionStatus = conversionStatusForDraft(copiedFromWine, currentIdentity);

  useEffect(() => {
    const query = wineName.trim();
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

      setIsSearchingWineMatches(true);
      setWineMatchError("");
      fetch(`/api/supplier-wines/matches?${params.toString()}`, { signal: controller.signal })
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
  }, [bottleSize, packSize, producer, supplierId, supplierName, templateWine, vintage, wineName]);

  function selectSupplier(nextSupplierId: string) {
    setSupplierId(nextSupplierId);
    const supplier = suppliers.find((row) => row.id === nextSupplierId);
    if (supplier) {
      setSupplierName(supplier.name);
      setLaidInPerBottle(String(defaultLaidInForSupplier(suppliers, supplier.id, supplier.name)));
      return;
    }
    setSupplierName("Manual Supplier");
    setLaidInPerBottle("0");
  }

  function applyWineTemplate(wine: SupplierCatalogWine, catalogWineId: string | null = null) {
    const nextProducer = wine.producer;
    const nextWineName = wine.wine_name;
    const nextVintage = wine.vintage || "NV";
    const nextPackSize = String(wine.pack_size || 12);
    const nextBottleSize = wine.bottle_size || "750ml";

    setTemplateWine(wine);
    setCopiedFromSupplierCatalogWineId(catalogWineId);
    setWineNameMatches([]);
    setWineMatchError("");
    setSupplierId(wine.supplier_id || "");
    setSupplierName(wine.supplier_name);
    setProducer(nextProducer);
    setWineName(nextWineName);
    setVintage(nextVintage);
    setPackSize(nextPackSize);
    setBottleSize(nextBottleSize);
    setFobBottle(String(asNumber(wine.fob_bottle) || ""));
    setFobCase(String(asNumber(wine.fob_case) || ""));
    setLaidInPerBottle(String(asNumber(wine.laid_in_per_bottle) || 0));
    setSystemTags(wine.system_tags || []);
    setQuickbooksItemId(wine.source_system === "quickbooks_item" ? wine.quickbooks_item_id || wine.quickbooks_item_number || "" : "");
    setQuickbooksItemName(wine.source_system === "quickbooks_item" ? wine.quickbooks_item_name || "" : "");
    setQuickbooksItemNumber(wine.source_system === "quickbooks_item" ? wine.quickbooks_item_number || wine.quickbooks_item_id || "" : "");
    setPriceLevels(priceLevelDraftsFromWine(wine));
    setFreeGoods(freeGoodDraftsFromWine(wine));
    setPriceChangeReason(`Matched from ${wine.display_name}`);
  }

  function selectClone(value: string) {
    const wine = wines.find((row) => row.id === value || row.display_name === value || row.planning_sku === value);
    if (!wine) return;

    applyWineTemplate(wine, wine.id);
  }

  function startNewSku() {
    setCopiedFromSupplierCatalogWineId(null);
    setTemplateWine(null);
    setWineNameMatches([]);
    setWineMatchError("");
    setProducer("");
    setWineName("");
    setVintage("NV");
    setPackSize("12");
    setBottleSize("750ml");
    setFobBottle("");
    setFobCase("");
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
        isFrontline: false,
        isBest: false,
        active: true
      }
    ]);
  }

  function removePriceLevel(id: string) {
    setPriceLevels((current) => (current.length <= 1 ? current : current.filter((level) => level.id !== id)));
  }

  function linkQuickbooksItem(match: ProductIdentityMatch) {
    setQuickbooksItemId(match.quickbooksItemNumber || match.sourceId);
    setQuickbooksItemName(match.quickbooksItemName || match.displayName);
    setQuickbooksItemNumber(match.quickbooksItemNumber || match.sourceId);
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
    supplierName,
    producer,
    wineName,
    vintage,
    packSize: Math.max(1, Math.trunc(Number(packSize) || 12)),
    bottleSize,
    fobBottle: parseOptionalNumber(fobBottle),
    fobCase: parseOptionalNumber(fobCase),
    laidInPerBottle: parseOptionalNumber(laidInPerBottle) || 0,
    frontlineOverride: null,
    bestPriceOverride: null,
    availabilityStatus: "available",
    conversionStatus,
    systemTags,
    copiedFromSupplierCatalogWineId,
    quickbooksItemId: quickbooksItemId || effectiveQuickbooksItemNumber,
    quickbooksItemName,
    quickbooksItemNumber: effectiveQuickbooksItemNumber,
    priceLevels: draftPriceLevels,
    freeGoods: freeGoods.map(freeGoodDraftToInput),
    priceChangeReason
  };
  const preview = buildSupplierCatalogWine(draftInput);
  const existing = wines.find((wine) => wine.planning_sku === preview.planning_sku);
  const previewDiagnostics = preview.diagnostics as Record<string, unknown>;
  const warnings = Array.isArray(previewDiagnostics.warnings) ? (previewDiagnostics.warnings as string[]) : [];
  const isBelowMinimumGp = warnings.some((warning) => warning.includes("below 28%"));

  function saveWine(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isBelowMinimumGp) return;
    onSaveCatalogWine({ ...draftInput, priceChangeReason });
  }

  return (
    <form className="supplier-hub-workspace" onSubmit={saveWine}>
      <div className="supplier-form-grid">
        <label className="wide-field">
          Wine Name
          <input
            list="supplier-catalog-clone-options"
            required
            value={wineName}
            onChange={(event) => {
              setWineName(event.target.value);
              selectClone(event.target.value);
            }}
            placeholder="Create new or search existing SKU"
          />
          <datalist id="supplier-catalog-clone-options">
            {sortedCloneOptions.map((wine) => (
              <option key={wine.id} value={wine.display_name}>
                {wine.supplier_name}
              </option>
            ))}
          </datalist>
        </label>
        {showWineNameMatches ? (
          <div className="catalog-match-suggestions">
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
                    className="ghost-button button-small"
                    onClick={() =>
                      applyWineTemplate(
                        productIdentityMatchToTemplateWine(match, wineName),
                        match.source === "supplier_catalog" ? match.sourceId : null
                      )
                    }
                    type="button"
                  >
                    Start From
                  </button>
                  {match.quickbooksItemNumber || match.source === "quickbooks_item" ? (
                    <button className="ghost-button button-small" onClick={() => linkQuickbooksItem(match)} type="button">
                      Link QB
                    </button>
                  ) : null}
                </div>
              ))
            ) : (
              <div className="catalog-match-empty">No product matches found.</div>
            )}
          </div>
        ) : null}
        <label>
          Supplier
          <select value={supplierId} onChange={(event) => selectSupplier(event.target.value)}>
            <option value="">Manual Supplier</option>
            {suppliers.map((supplier) => (
              <option key={supplier.id} value={supplier.id}>
                {supplier.name}
              </option>
            ))}
          </select>
        </label>
        <label className={supplierId ? "is-hidden-field" : undefined}>
          Supplier
          <input value={supplierName} onChange={(event) => setSupplierName(event.target.value)} />
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
        <label>
          Vintage
          <input value={vintage} onChange={(event) => setVintage(event.target.value)} />
        </label>
        <label>
          Pack size
          <input min={1} type="number" value={packSize} onChange={(event) => setPackSize(event.target.value)} />
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
              setFobBottle(event.target.value);
              const next = parseOptionalNumber(event.target.value);
              if (next !== null) setFobCase(String(money(next * Math.max(1, Number(packSize) || 12))));
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
              setFobCase(event.target.value);
              const next = parseOptionalNumber(event.target.value);
              if (next !== null) setFobBottle(String(money(next / Math.max(1, Number(packSize) || 12))));
            }}
          />
        </label>
        <label>
          Laid-in per bottle
          <input min={0} step={0.01} type="number" value={laidInPerBottle} onChange={(event) => setLaidInPerBottle(event.target.value)} />
        </label>
        <label>
          QB Item #
          <input
            value={quickbooksItemNumber}
            onChange={(event) => {
              setQuickbooksItemNumber(event.target.value);
              setQuickbooksItemId(event.target.value);
              setQuickbooksItemName("");
            }}
            placeholder="Leave blank for New Item"
          />
        </label>
        {quickbooksItemName ? (
          <label className="wide-field">
            Linked QuickBooks Item
            <input readOnly value={quickbooksItemName} />
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
            {tag}
          </label>
        ))}
      </div>

      <div className="catalog-preview-grid">
        <div>
          <span>QuickBooks Item Preview</span>
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
          <small>{effectiveQuickbooksItemNumber.trim() ? "Linked Item" : "New Item"}</small>
        </div>
      </div>

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
                <th>Name</th>
                <th>Price</th>
                <th>DA</th>
                <th>Target GP</th>
                <th>GM</th>
                <th>FL</th>
                <th>Best</th>
                <th>Active</th>
                <th>Remove</th>
              </tr>
            </thead>
            <tbody>
              {priceLevels.map((level, index) => {
                const effective = priceLevelDraftToInput(level, index, computedPricing);
                const bottlePriceEntered = level.bottlePrice.trim().length > 0;
                const daEntered = level.depletionAllowance.trim().length > 0;
                const gpEntered = level.targetGpMargin.trim().length > 0;

                return (
                  <tr key={level.id}>
                    <td>
                      <input aria-label="Price level name" value={level.name} onChange={(event) => patchPriceLevel(level.id, { name: event.target.value })} />
                    </td>
                    <td>
                      <div className="priced-field">
                        <input
                          aria-label="Bottle price"
                          min={0}
                          placeholder={String(effective.bottlePrice || "")}
                          step={0.01}
                          type="number"
                          value={level.bottlePrice}
                          onChange={(event) => patchPriceLevel(level.id, { bottlePrice: event.target.value })}
                        />
                        <small>{bottlePriceEntered && effective.calculatedField !== "frontline" ? "Entered" : "Calculated"}</small>
                      </div>
                    </td>
                    <td>
                      <div className="priced-field">
                        <input
                          aria-label="Depletion allowance"
                          min={0}
                          step={0.01}
                          type="number"
                          placeholder={String(effective.depletionAllowance || "")}
                          value={level.depletionAllowance}
                          onChange={(event) => patchPriceLevel(level.id, { depletionAllowance: event.target.value })}
                        />
                        <small>{daEntered && effective.calculatedField !== "da" ? "Entered" : "Calculated"}</small>
                      </div>
                    </td>
                    <td>
                      <div className="priced-field">
                        <input
                          aria-label="Target GP margin"
                          min={0}
                          max={99}
                          step={0.1}
                          type="number"
                          value={level.targetGpMargin}
                          onChange={(event) => patchPriceLevel(level.id, { targetGpMargin: event.target.value })}
                        />
                        <small>{gpEntered ? "Entered" : "Calculated"}</small>
                      </div>
                    </td>
                    <td className={effective.belowMinimumGp ? "danger-cell" : undefined}>{formatPercent(effective.calculatedGpMargin)}</td>
                    <td>
                      <input
                        aria-label="Frontline"
                        className="approval-input"
                        type="checkbox"
                        checked={level.isFrontline}
                        onChange={(event) => patchPriceLevel(level.id, { isFrontline: event.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label="Best"
                        className="approval-input"
                        type="checkbox"
                        checked={level.isBest}
                        onChange={(event) => patchPriceLevel(level.id, { isBest: event.target.checked })}
                      />
                    </td>
                    <td>
                      <input
                        aria-label="Active"
                        className="approval-input"
                        type="checkbox"
                        checked={level.active}
                        onChange={(event) => patchPriceLevel(level.id, { active: event.target.checked })}
                      />
                    </td>
                    <td>
                      <button className="ghost-button remove-line-button" disabled={priceLevels.length <= 1} onClick={() => removePriceLevel(level.id)} type="button">
                        Remove
                      </button>
                    </td>
                  </tr>
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
      {isBelowMinimumGp ? (
        <div className="inline-warning">
          Saving is blocked until every active price level is at or above 28% GP. Override permission is not available yet.
        </div>
      ) : null}
      {existing ? (
        <div className="inline-info">
          Existing planning SKU found. Saving updates the existing supplier wine and creates a draft price-change event if FOB or frontline changed.
        </div>
      ) : null}
      {!effectiveQuickbooksItemNumber.trim() ? (
        <div className="inline-warning">
          This SKU will be marked as a New Item in Order Review and PO Drafts until a QuickBooks Item Number is attached.
        </div>
      ) : null}
      {copiedFromSupplierCatalogWineId ? (
        <div className="inline-info">
          Copied from an existing SKU. Changing vintage, pack, or bottle size will save a separate orderable SKU row.
        </div>
      ) : null}

      <div className="form-actions">
        <button className="ghost-button" disabled={isPending} onClick={startNewSku} type="button">
          Create New
        </button>
        <button className="button" disabled={isPending || isBelowMinimumGp || !producer.trim() || !wineName.trim()} type="submit">
          {existing ? "Update SKU" : "Save SKU"}
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
  isFrontline: boolean;
  isBest: boolean;
  active: boolean;
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
    quickbooks_item_id: match.source === "quickbooks_item" ? match.sourceId : match.quickbooksItemNumber,
    quickbooks_item_name: match.quickbooksItemName,
    quickbooks_item_number: match.quickbooksItemNumber,
    quickbooks_sync_status: match.quickbooksItemNumber || match.source === "quickbooks_item" ? "linked" : "not_created",
    product_lifecycle_status: match.source === "supplier_catalog" ? "supplier_available" : "active_product",
    accounting_create_payload: {},
    system_tags: match.systemTags,
    copied_from_supplier_catalog_wine_id: match.source === "supplier_catalog" ? match.sourceId : null,
    source_system: match.source,
    source_id: match.sourceId,
    price_levels: [],
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
      isFrontline: true,
      isBest: false,
      active: true
    },
    {
      id: "best",
      name: "Best",
      bottlePrice: "",
      depletionAllowance: "",
      targetGpMargin: "",
      isFrontline: false,
      isBest: true,
      active: true
    }
  ];
}

function sortNewestVintageFirst(a: SupplierCatalogWine, b: SupplierCatalogWine) {
  const vintageA = Number(a.vintage);
  const vintageB = Number(b.vintage);
  if (Number.isFinite(vintageA) && Number.isFinite(vintageB) && vintageA !== vintageB) {
    return vintageB - vintageA;
  }
  if (Number.isFinite(vintageA) !== Number.isFinite(vintageB)) {
    return Number.isFinite(vintageA) ? -1 : 1;
  }
  return (b.updated_at || "").localeCompare(a.updated_at || "") || a.display_name.localeCompare(b.display_name);
}

function priceLevelDraftsFromWine(wine: SupplierCatalogWine): PriceLevelDraft[] {
  const levels = wine.price_levels && wine.price_levels.length > 0
    ? [...wine.price_levels].sort((a, b) => asNumber(a.display_order) - asNumber(b.display_order))
    : [
        {
          id: "frontline",
          name: "Frontline",
          bottle_price: wine.frontline_bottle_price,
          depletion_allowance: 0,
          target_gp_margin: null,
          is_frontline: true,
          is_best: false,
          active: true
        },
        ...(wine.best_price !== null
          ? [
              {
                id: "best",
                name: "Best",
                bottle_price: wine.best_price,
                depletion_allowance: 0,
                target_gp_margin: null,
                is_frontline: false,
                is_best: true,
                active: true
              }
            ]
          : [])
      ];

  return levels.map((level, index) => ({
    id: `${level.id || "level"}-${index}`,
    name: level.name || `Level ${index + 1}`,
    bottlePrice: asNumber(level.bottle_price).toString(),
    depletionAllowance: asNumber(level.depletion_allowance).toString(),
    targetGpMargin: level.target_gp_margin === null || level.target_gp_margin === undefined ? "" : (asNumber(level.target_gp_margin) * 100).toString(),
    isFrontline: Boolean(level.is_frontline),
    isBest: Boolean(level.is_best),
    active: level.active !== false
  }));
}

function freeGoodDraftsFromWine(wine: SupplierCatalogWine): FreeGoodDraft[] {
  return (wine.free_goods || []).map((freeGood, index) => ({
    id: `${freeGood.id || "free"}-${index}`,
    buyQuantity: asNumber(freeGood.buy_quantity).toString(),
    freeQuantity: asNumber(freeGood.free_quantity).toString(),
    unit: freeGood.unit === "bottle" ? "bottle" : "case",
    programName: freeGood.program_name || "",
    startsOn: freeGood.starts_on || "",
    endsOn: freeGood.ends_on || "",
    notes: freeGood.notes || "",
    active: freeGood.active !== false
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

function parseOptionalPercent(value: string) {
  if (!value.trim()) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, Math.min(0.99, parsed / 100));
}

function priceLevelDraftToInput(level: PriceLevelDraft, index: number, pricing: ReturnType<typeof calculatePricing>) {
  const fallbackPrice = level.isFrontline
    ? pricing.frontlineBottlePrice
    : level.isBest
      ? pricing.bestPrice || 0
      : 0;
  const bottlePrice = parseOptionalNumber(level.bottlePrice);
  const targetGpMargin = parseOptionalPercent(level.targetGpMargin);
  const depletionAllowance = parseOptionalNumber(level.depletionAllowance);
  const balanced = balancePriceLevel({
    bottlePrice,
    depletionAllowance,
    targetGpMargin,
    landedBottleCost: pricing.landedBottleCost,
    fallbackBottlePrice: fallbackPrice
  });

  return {
    name: level.name || `Level ${index + 1}`,
    bottlePrice: balanced.bottlePrice,
    depletionAllowance: balanced.depletionAllowance,
    targetGpMargin: balanced.targetGpMargin,
    calculatedGpMargin: balanced.calculatedGpMargin,
    calculatedField: balanced.calculatedField,
    belowMinimumGp: balanced.belowMinimumGp,
    isFrontline: level.isFrontline,
    isBest: level.isBest,
    displayOrder: index,
    active: level.active
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
          Wine display name
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

function PendingProductCreationPanel({ wines, requests }: { wines: SupplierCatalogWine[]; requests: WineRequest[] }) {
  const pendingWines = wines.filter((wine) => PENDING_CONVERSION_STATUSES.has(wine.conversion_status));
  const pendingRequests = requests.filter(
    (request) => request.request_status === "approved" && request.approval_decision === "approve_as_new_stem_product"
  );

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
              </tr>
            ))}
            {pendingWines.length + pendingRequests.length === 0 ? (
              <EmptyRow colSpan={6} label="No wines are waiting on official QuickBooks product creation." />
            ) : null}
          </tbody>
        </table>
      </div>
      <div className="inline-info">
        Items in this queue are not official Stem products yet. QuickBooks creation/linking is intentionally held behind the accounting integration boundary.
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
  isPending,
  onSaveSupplier
}: {
  suppliers: SupplierLogistics[];
  isPending: boolean;
  onSaveSupplier: (supplier: SupplierLogistics) => void;
}) {
  const [draftRows, setDraftRows] = useState<SupplierLogistics[]>([]);
  const [search, setSearch] = useState("");
  const [pickupLocation, setPickupLocation] = useState("All");
  const [showInactive, setShowInactive] = useState(false);
  const rows = useMemo(() => [...draftRows, ...suppliers], [draftRows, suppliers]);
  const pickupOptions = useMemo(
    () => ["All", ...uniqueSorted(rows.map((supplier) => supplier.pick_up_location))],
    [rows]
  );
  const filteredRows = useMemo(() => {
    const needle = search.trim().toLowerCase();

    return rows.filter((supplier) => {
      const isDraft = supplier.id.startsWith("new-");
      if (!showInactive && supplier.active === false && !isDraft) return false;
      if (pickupLocation !== "All" && (supplier.pick_up_location?.trim() || "") !== pickupLocation) return false;
      if (!needle) return true;

      return [
        supplier.name,
        supplier.importer_id,
        supplier.tdm,
        supplier.pick_up_location,
        supplier.freight_forwarder,
        supplier.order_frequency,
        supplier.notes
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(needle);
    });
  }, [pickupLocation, rows, search, showInactive]);
  const activeCount = suppliers.filter((supplier) => supplier.active !== false).length;
  const inactiveCount = suppliers.length - activeCount;
  const averageLaidIn =
    activeCount > 0
      ? suppliers
          .filter((supplier) => supplier.active !== false)
          .reduce((sum, supplier) => sum + asNumber(supplier.trucking_cost_per_bottle), 0) / activeCount
      : 0;

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

  return (
    <div className="supplier-hub-workspace">
      <div className="section-heading compact-heading">
        <div>
          <h2>Supplier Logistics</h2>
          <p>Maintain supplier defaults used by purchasing and laid-in calculations.</p>
        </div>
        <button className="button button-small" onClick={addDraftRow} disabled={isPending} type="button">
          Add Supplier
        </button>
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
      </div>
      <div className="supplier-hub-toolbar">
        <label className="search-field">
          Search
          <input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Supplier, TDM, pickup, notes"
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
      </div>
      <div className="table-shell logistics-table-shell">
        <table className="logistics-table">
          <thead>
            <tr>
              <th>Supplier</th>
              <th>Importer ID</th>
              <th>TDM</th>
              <th>Pickup</th>
              <th>Freight Forwarder</th>
              <th>Frequency</th>
              <th>ETA</th>
              <th>Laid In / Bottle</th>
              <th>Active</th>
              <th>Notes</th>
              <th>Save</th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.map((supplier) => (
              <SupplierLogisticsRow
                key={supplier.id}
                supplier={supplier}
                disabled={isPending}
                onSaveSupplier={onSaveSupplier}
                onDiscardDraft={discardDraftRow}
              />
            ))}
            {filteredRows.length === 0 ? <EmptyRow colSpan={11} label="No suppliers match the current filters." /> : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function SupplierLogisticsRow({
  supplier,
  disabled,
  onSaveSupplier,
  onDiscardDraft
}: {
  supplier: SupplierLogistics;
  disabled: boolean;
  onSaveSupplier: (supplier: SupplierLogistics) => void;
  onDiscardDraft: (id: string) => void;
}) {
  const [row, setRow] = useState(supplier);

  useEffect(() => {
    setRow(supplier);
  }, [supplier]);

  function patch(patchRow: Partial<SupplierLogistics>) {
    setRow((current) => ({ ...current, ...patchRow }));
  }

  const isNew = row.id.startsWith("new-");
  const isDirty = JSON.stringify(row) !== JSON.stringify(supplier);
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
          <button className="button button-tiny" disabled={disabled || !row.name.trim() || (!isNew && !isDirty)} onClick={() => onSaveSupplier(row)} type="button">
            {isNew ? "Add" : "Save"}
          </button>
          {!isNew ? (
            <button
              className={isActive ? "ghost-button supplier-delete-button" : "ghost-button supplier-reset-button"}
              disabled={disabled}
              onClick={() => onSaveSupplier({ ...row, active: !isActive })}
              type="button"
            >
              {isActive ? "Delete" : "Restore"}
            </button>
          ) : null}
          {isNew ? (
            <button className="ghost-button supplier-reset-button" disabled={disabled} onClick={() => onDiscardDraft(row.id)} type="button">
              Cancel
            </button>
          ) : null}
          {!isNew && isDirty ? (
            <button className="ghost-button supplier-reset-button" disabled={disabled} onClick={() => setRow(supplier)} type="button">
              Reset
            </button>
          ) : null}
        </div>
      </td>
    </tr>
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
