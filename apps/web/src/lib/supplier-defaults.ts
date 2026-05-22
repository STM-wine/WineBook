import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { asNumber } from "./order-data";
import type { SupplierLogistics } from "./types";

function parseCsvLine(line: string) {
  const cells: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let index = 0; index < line.length; index += 1) {
    const char = line[index];
    const next = line[index + 1];
    if (char === '"' && inQuotes && next === '"') {
      current += '"';
      index += 1;
    } else if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === "," && !inQuotes) {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }

  cells.push(current);
  return cells.map((cell) => cell.trim());
}

function supplierKey(value: string | null | undefined) {
  return (value || "").trim().toLowerCase();
}

async function importersCsvPath() {
  const candidates = [
    path.join(process.cwd(), "importers.csv"),
    path.join(process.cwd(), "../../importers.csv")
  ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      // Try the next likely Render/local working-directory location.
    }
  }

  return null;
}

export async function loadImporterDefaults(): Promise<SupplierLogistics[]> {
  const csvPath = await importersCsvPath();
  if (!csvPath) return [];

  const text = await readFile(csvPath, "utf8");
  const lines = text.split(/\r?\n/).filter((line) => line.trim());
  const [rawHeader, ...rows] = lines;
  const headers = parseCsvLine(rawHeader).map((header) => header.replace(/^\uFEFF/, ""));

  return rows.map((line, index) => {
    const cells = parseCsvLine(line);
    const row = Object.fromEntries(headers.map((header, cellIndex) => [header, cells[cellIndex] || ""]));
    return {
      id: `importers-csv-${row.importer_id || index}`,
      importer_id: row.importer_id || null,
      name: row.name || "",
      eta_days: row.eta_days || null,
      pick_up_location: row.pick_up_location || null,
      freight_forwarder: row.freight_forwarder || null,
      order_frequency: row.order_frequency || null,
      tdm: null,
      trucking_cost_per_bottle: row.laid_in_per_bottle || 0,
      notes: row.notes || null,
      active: true
    };
  }).filter((supplier) => supplier.name);
}

export function mergeSupplierDefaults(
  suppliers: SupplierLogistics[] = [],
  defaults: SupplierLogistics[] = []
): SupplierLogistics[] {
  const defaultLookup = new Map(defaults.map((supplier) => [supplierKey(supplier.name), supplier]));
  const merged = suppliers.map((supplier) => {
    const fallback = defaultLookup.get(supplierKey(supplier.name));
    if (!fallback) return supplier;

    return {
      ...supplier,
      importer_id: supplier.importer_id || fallback.importer_id,
      eta_days: asNumber(supplier.eta_days) > 0 ? supplier.eta_days : fallback.eta_days,
      pick_up_location: supplier.pick_up_location || fallback.pick_up_location,
      freight_forwarder: supplier.freight_forwarder || fallback.freight_forwarder,
      order_frequency: supplier.order_frequency || fallback.order_frequency,
      trucking_cost_per_bottle:
        asNumber(supplier.trucking_cost_per_bottle) > 0
          ? supplier.trucking_cost_per_bottle
          : fallback.trucking_cost_per_bottle,
      notes: supplier.notes || fallback.notes
    };
  });
  const existingKeys = new Set(merged.map((supplier) => supplierKey(supplier.name)));
  const csvOnly = defaults.filter((supplier) => !existingKeys.has(supplierKey(supplier.name)));
  return [...merged, ...csvOnly].sort((a, b) => a.name.localeCompare(b.name));
}
