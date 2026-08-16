import { AccountPending, getAppContext } from "@/lib/auth";
import { createServiceRoleClient } from "@/lib/supabase/server";

type VinosmithWineRow = {
  wine_id: string;
  importer_name: string | null;
  stem_laid_in_per_bottle: number | string | null;
  stem_laid_in_source: string | null;
};

type SupplierRow = {
  id: string;
  name: string;
  trucking_cost_per_bottle: number | string | null;
  active: boolean | null;
};

type SupplierImporterAliasRow = {
  importer_name: string;
  supplier_id: string;
};

type ImporterCoverageRow = {
  importerName: string;
  wines: number;
  supplierName: string | null;
  supplierActive: boolean | null;
  supplierLaidInPerBottle: number;
  materializedLaidInPerBottle: number;
  matchType: "exact" | "alias" | "none";
  status: "covered" | "zero_cost" | "unmatched";
};

type CoverageData = {
  totalWines: number;
  coveredWines: number;
  matchedWines: number;
  zeroCostMatchedWines: number;
  unmatchedWines: number;
  coveredImporters: ImporterCoverageRow[];
  zeroCostImporters: ImporterCoverageRow[];
  unmatchedImporters: ImporterCoverageRow[];
};

const PAGE_SIZE = 1000;

export default async function LaidInCoveragePage() {
  const context = await getAppContext();
  if ("pendingEmail" in context) return <AccountPending email={context.pendingEmail} />;

  const result = await loadCoverageData();
  if ("error" in result) {
    return (
      <>
        <header className="settings-header">
          <p className="eyebrow">Gross Profit</p>
          <h1>Laid-In Coverage</h1>
          <p className="muted">Supplier logistics coverage for GP cost add-ons.</p>
        </header>
        <section className="settings-panel">
          <h2>Coverage unavailable</h2>
          <p className="muted">{result.error}</p>
        </section>
      </>
    );
  }

  const data = result.data;
  return (
    <>
      <header className="settings-header">
        <p className="eyebrow">Gross Profit</p>
        <h1>Laid-In Coverage</h1>
        <p className="muted">
          Vinosmith importer coverage against Stem supplier logistics. GP uses QuickBooks cost plus the materialized laid-in value.
        </p>
      </header>

      <div className="settings-metrics">
        <div>
          <span>Covered Items</span>
          <strong>{number(data.coveredWines)}</strong>
          <small>{percent(data.coveredWines, data.totalWines)} of Vinosmith items</small>
        </div>
        <div>
          <span>Matched Items</span>
          <strong>{number(data.matchedWines)}</strong>
          <small>{number(data.zeroCostMatchedWines)} matched at {currency(0)}</small>
        </div>
        <div>
          <span>Unmatched Items</span>
          <strong>{number(data.unmatchedWines)}</strong>
          <small>{percent(data.unmatchedWines, data.totalWines)} need importer mapping</small>
        </div>
        <div>
          <span>Total Items</span>
          <strong>{number(data.totalWines)}</strong>
          <small>Vinosmith wine rows</small>
        </div>
      </div>

      <div className="settings-grid-two">
        <CoverageTable
          title="Unmatched Importers"
          badge="Map supplier"
          rows={data.unmatchedImporters}
          emptyText="All Vinosmith importers match Stem suppliers."
        />
        <CoverageTable
          title="Matched With $0.00 Laid-In"
          badge="Add cost"
          rows={data.zeroCostImporters}
          emptyText="Every matched supplier has a nonzero laid-in cost."
        />
      </div>

      <CoverageTable
        title="Covered Importers"
        badge="Active"
        rows={data.coveredImporters}
        emptyText="No covered importers yet."
      />
    </>
  );
}

function CoverageTable({
  title,
  badge,
  rows,
  emptyText
}: {
  title: string;
  badge: string;
  rows: ImporterCoverageRow[];
  emptyText: string;
}) {
  return (
    <section className="settings-panel">
      <div className="settings-panel-header">
        <h2>{title}</h2>
        <span className={`data-pill ${rows.length > 0 ? "is-warning" : "is-positive"}`}>{badge}</span>
      </div>
      {rows.length === 0 ? (
        <p className="muted">{emptyText}</p>
      ) : (
        <div className="settings-table-wrap">
          <table className="settings-table">
            <thead>
              <tr>
                <th>Importer</th>
                <th>Supplier</th>
                <th>Items</th>
                <th>Supplier Laid-In</th>
                <th>Item Laid-In</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={`${row.status}:${row.importerName}`}>
                  <td>
                    <strong>{row.importerName}</strong>
                    <small>{statusLabel(row)}</small>
                  </td>
                  <td>{row.supplierName || "No exact supplier match"}</td>
                  <td>{number(row.wines)}</td>
                  <td>{currency(row.supplierLaidInPerBottle)}</td>
                  <td>{currency(row.materializedLaidInPerBottle)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  );
}

async function loadCoverageData(): Promise<{ data: CoverageData } | { error: string }> {
  try {
    const supabase = createServiceRoleClient();
    const [wineRows, supplierRows, aliasRows] = await Promise.all([
      fetchAll<VinosmithWineRow>((from, to) =>
        supabase
          .from("vinosmith_wines")
          .select("wine_id,importer_name,stem_laid_in_per_bottle,stem_laid_in_source")
          .order("importer_name", { ascending: true, nullsFirst: false })
          .range(from, to)
          .returns<VinosmithWineRow[]>()
      ),
      fetchAll<SupplierRow>((from, to) =>
        supabase
          .from("suppliers")
          .select("id,name,trucking_cost_per_bottle,active")
          .order("name", { ascending: true })
          .range(from, to)
          .returns<SupplierRow[]>()
      ),
      fetchAliasRows(supabase)
    ]);

    return { data: buildCoverageData(wineRows, supplierRows, aliasRows) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : "Unknown coverage error." };
  }
}

async function fetchAliasRows(supabase: ReturnType<typeof createServiceRoleClient>) {
  try {
    return await fetchAll<SupplierImporterAliasRow>((from, to) =>
      supabase
        .from("supplier_importer_aliases")
        .select("importer_name,supplier_id")
        .order("importer_name", { ascending: true })
        .range(from, to)
        .returns<SupplierImporterAliasRow[]>()
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/supplier_importer_aliases|does not exist|schema cache/i.test(message)) return [];
    throw error;
  }
}

async function fetchAll<Row>(
  fetchPage: (from: number, to: number) => PromiseLike<{ data: Row[] | null; error: { message: string } | null }>
) {
  const rows: Row[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await fetchPage(from, to);
    if (error) throw new Error(error.message);
    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }
  return rows;
}

function buildCoverageData(wines: VinosmithWineRow[], suppliers: SupplierRow[], aliases: SupplierImporterAliasRow[]): CoverageData {
  const suppliersByName = new Map(suppliers.map((supplier) => [normalizeKey(supplier.name), supplier]));
  const suppliersById = new Map(suppliers.map((supplier) => [supplier.id, supplier]));
  const aliasesByImporter = new Map(aliases.map((alias) => [normalizeKey(alias.importer_name), alias]));
  const byImporter = new Map<string, ImporterCoverageRow>();

  wines.forEach((wine) => {
    const importerName = cleanName(wine.importer_name, "Missing Importer");
    const key = normalizeKey(importerName);
    const exactSupplier = suppliersByName.get(key) || null;
    const aliasSupplier = exactSupplier ? null : suppliersById.get(aliasesByImporter.get(key)?.supplier_id || "") || null;
    const supplier = exactSupplier || aliasSupplier;
    const supplierLaidIn = money(supplier?.trucking_cost_per_bottle);
    const materializedLaidIn = money(wine.stem_laid_in_per_bottle);
    const status: ImporterCoverageRow["status"] = !supplier ? "unmatched" : supplierLaidIn > 0 || materializedLaidIn > 0 ? "covered" : "zero_cost";
    const current =
      byImporter.get(key) ||
      {
        importerName,
        wines: 0,
        supplierName: supplier?.name || null,
        supplierActive: supplier?.active ?? null,
        supplierLaidInPerBottle: supplierLaidIn,
        materializedLaidInPerBottle: materializedLaidIn,
        matchType: exactSupplier ? "exact" : aliasSupplier ? "alias" : "none",
        status
      };

    current.wines += 1;
    current.materializedLaidInPerBottle = Math.max(current.materializedLaidInPerBottle, materializedLaidIn);
    byImporter.set(key, current);
  });

  const rows = Array.from(byImporter.values()).sort((a, b) => b.wines - a.wines || a.importerName.localeCompare(b.importerName));
  const coveredImporters = rows.filter((row) => row.status === "covered").slice(0, 50);
  const zeroCostImporters = rows.filter((row) => row.status === "zero_cost").slice(0, 50);
  const unmatchedImporters = rows.filter((row) => row.status === "unmatched").slice(0, 50);

  return {
    totalWines: wines.length,
    coveredWines: wines.filter((wine) => money(wine.stem_laid_in_per_bottle) > 0).length,
    matchedWines: wines.filter((wine) => importerSupplier(wine, suppliersByName, suppliersById, aliasesByImporter)).length,
    zeroCostMatchedWines: wines.filter((wine) => {
      const supplier = importerSupplier(wine, suppliersByName, suppliersById, aliasesByImporter);
      return Boolean(supplier) && money(supplier?.trucking_cost_per_bottle) === 0;
    }).length,
    unmatchedWines: wines.filter((wine) => !importerSupplier(wine, suppliersByName, suppliersById, aliasesByImporter)).length,
    coveredImporters,
    zeroCostImporters,
    unmatchedImporters
  };
}

function importerSupplier(
  wine: VinosmithWineRow,
  suppliersByName: Map<string, SupplierRow>,
  suppliersById: Map<string, SupplierRow>,
  aliasesByImporter: Map<string, SupplierImporterAliasRow>
) {
  const key = normalizeKey(cleanName(wine.importer_name, "Missing Importer"));
  return suppliersByName.get(key) || suppliersById.get(aliasesByImporter.get(key)?.supplier_id || "") || null;
}

function statusLabel(row: ImporterCoverageRow) {
  if (row.status === "unmatched") return "No exact supplier-name match";
  const match = row.matchType === "alias" ? "Alias matched" : "Supplier matched";
  if (row.status === "zero_cost") return row.supplierActive === false ? `${match}, inactive with $0.00 laid-in` : `${match} with $0.00 laid-in`;
  return row.supplierActive === false ? `${match}, inactive` : `${match} by logistics`;
}

function cleanName(value: string | null | undefined, fallback: string) {
  const trimmed = typeof value === "string" ? value.trim() : "";
  return trimmed || fallback;
}

function normalizeKey(value: string | null | undefined) {
  return cleanName(value, "").toLowerCase();
}

function money(value: unknown) {
  const number = Number(value || 0);
  return Number.isFinite(number) ? number : 0;
}

function number(value: number) {
  return new Intl.NumberFormat("en-US").format(value);
}

function currency(value: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(value);
}

function percent(numerator: number, denominator: number) {
  if (denominator === 0) return "0.0%";
  return new Intl.NumberFormat("en-US", { style: "percent", minimumFractionDigits: 1, maximumFractionDigits: 1 }).format(numerator / denominator);
}
