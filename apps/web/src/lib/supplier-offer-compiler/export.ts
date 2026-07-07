import ExcelJS from "exceljs";

export type ApprovedSupplierOfferExportRow = {
  supplier_name: string;
  producer: string;
  wine_name: string;
  vintage: string;
  appellation: string | null;
  region: string | null;
  country: string | null;
  bottle_size: string | null;
  pack_size: number | string | null;
  fob: number | string | null;
  quantity: number | string | null;
  arrival_date: string | null;
  valid_until: string | null;
  notes: string | null;
};

const EXPORT_HEADERS: Array<{ label: string; key: keyof ApprovedSupplierOfferExportRow }> = [
  { label: "Supplier", key: "supplier_name" },
  { label: "Producer", key: "producer" },
  { label: "Wine", key: "wine_name" },
  { label: "Vintage", key: "vintage" },
  { label: "Appellation", key: "appellation" },
  { label: "Region", key: "region" },
  { label: "Country", key: "country" },
  { label: "Bottle Size", key: "bottle_size" },
  { label: "Pack Size", key: "pack_size" },
  { label: "FOB", key: "fob" },
  { label: "Quantity", key: "quantity" },
  { label: "Arrival Date", key: "arrival_date" },
  { label: "Valid Until", key: "valid_until" },
  { label: "Notes", key: "notes" }
];

function csvEscape(value: unknown) {
  const text = String(value ?? "");
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

export function approvedSupplierOffersCsv(rows: ApprovedSupplierOfferExportRow[]) {
  return [
    EXPORT_HEADERS.map((header) => header.label),
    ...rows.map((row) => EXPORT_HEADERS.map((header) => row[header.key] ?? ""))
  ].map((row) => row.map(csvEscape).join(",")).join("\n");
}

export async function approvedSupplierOffersXlsxBuffer(rows: ApprovedSupplierOfferExportRow[]) {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Approved Offers");
  sheet.columns = EXPORT_HEADERS.map((header) => ({ header: header.label, key: header.key, width: 18 }));
  sheet.getRow(1).font = { bold: true };
  rows.forEach((row) => sheet.addRow(row));
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
