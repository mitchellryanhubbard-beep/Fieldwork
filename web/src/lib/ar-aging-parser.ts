import ExcelJS from "exceljs";

// Parsed AR Aging — both customer-level (rolled up) and invoice-level so
// downstream sampling can pick at either grain.

export type ArInvoice = {
  custNum: string;
  custName: string;
  invoiceNum: string;
  invoiceDate: string | null;   // YYYY-MM-DD or null
  dueDate: string | null;
  terms: string;
  salesRep: string;
  total: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  credits: number;
  notes: string;
};

export type ArCustomer = {
  custNum: string;
  custName: string;
  total: number;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  credits: number;
  invoiceCount: number;
};

export type ArAging = {
  asOfDate: string | null;
  customers: ArCustomer[];
  invoices: ArInvoice[];
  total: number;
};

// Read an xlsx buffer and extract the AR Aging. Tolerant of the Hartwell
// layout:
//   row 1: blank
//   row 2: client banner
//   row 3: as-of date
//   row 4: confidentiality
//   row 5: blank
//   row 6: aging-bucket key
//   row 7: column headers
//   following rows: customer banner ("  C### — Name" in col 1 — leading
//     space; cells merged across the row), invoice rows (cust # in col 1 +
//     invoice # in col 3), and subtotal rows (start with "Subtotal —").
//
// Each invoice row contributes one ArInvoice. Customers are rolled up from
// their invoice rows so the customer totals always tie to the invoice
// detail, even if the source file's subtotal rows are off.
export async function parseArAging(
  buffer: Buffer | ArrayBuffer,
): Promise<ArAging> {
  const wb = new ExcelJS.Workbook();
  const buf =
    buffer instanceof Buffer ? buffer : Buffer.from(new Uint8Array(buffer));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("AR Aging has no worksheets");

  const asOfDate = parseAsOfDate(readCellText(sheet, 3, 1));

  const invoices: ArInvoice[] = [];

  for (let r = 8; r <= sheet.rowCount; r++) {
    const c1 = readCellText(sheet, r, 1).trim();
    const c3 = readCellText(sheet, r, 3).trim();

    // Customer banner row: starts with "C### —" in col 1 (merged across).
    // Invoice rows ALSO have the cust # in col 1 but col 3 (invoice #) is
    // populated. Subtotal rows start with "Subtotal —".
    if (!c1) continue;
    if (/^subtotal\b/i.test(c1)) continue;
    if (!c3) continue; // banner row — no invoice #

    // Defensive: if col 1 isn't a pure customer code (e.g., "C001"), skip.
    if (!/^[A-Z]\d{2,5}$/.test(c1)) continue;

    invoices.push({
      custNum: c1,
      custName: readCellText(sheet, r, 2).trim(),
      invoiceNum: c3,
      invoiceDate: parseDateCell(sheet.getRow(r).getCell(4).value),
      dueDate: parseDateCell(sheet.getRow(r).getCell(5).value),
      terms: readCellText(sheet, r, 6).trim(),
      salesRep: readCellText(sheet, r, 7).trim(),
      total: readCellNumber(sheet, r, 8),
      current: readCellNumber(sheet, r, 9),
      d1_30: readCellNumber(sheet, r, 10),
      d31_60: readCellNumber(sheet, r, 11),
      d61_90: readCellNumber(sheet, r, 12),
      d90_plus: readCellNumber(sheet, r, 13),
      credits: readCellNumber(sheet, r, 14),
      notes: readCellText(sheet, r, 15).trim(),
    });
  }

  const customers = rollUpToCustomers(invoices);
  const total = invoices.reduce((acc, inv) => acc + inv.total, 0);

  return { asOfDate, customers, invoices, total };
}

// Shared rollup helper — used by every aging source path (xlsx parse,
// PDF Claude extraction, manual-mapping entry). Customers are derived
// from invoices, never imported separately, so subtotals always tie.
export function rollUpArAgingCustomers(invoices: ArInvoice[]): ArCustomer[] {
  return rollUpToCustomers(invoices);
}

function rollUpToCustomers(invoices: ArInvoice[]): ArCustomer[] {
  const byNum = new Map<string, ArCustomer>();
  for (const inv of invoices) {
    const existing = byNum.get(inv.custNum);
    if (existing) {
      existing.total += inv.total;
      existing.current += inv.current;
      existing.d1_30 += inv.d1_30;
      existing.d31_60 += inv.d31_60;
      existing.d61_90 += inv.d61_90;
      existing.d90_plus += inv.d90_plus;
      existing.credits += inv.credits;
      existing.invoiceCount += 1;
    } else {
      byNum.set(inv.custNum, {
        custNum: inv.custNum,
        custName: inv.custName,
        total: inv.total,
        current: inv.current,
        d1_30: inv.d1_30,
        d31_60: inv.d31_60,
        d61_90: inv.d61_90,
        d90_plus: inv.d90_plus,
        credits: inv.credits,
        invoiceCount: 1,
      });
    }
  }
  return Array.from(byNum.values()).sort((a, b) => Math.abs(b.total) - Math.abs(a.total));
}

function readCellText(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
): string {
  const v = sheet.getRow(row).getCell(col).value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v) {
    if ("text" in v && typeof (v as { text: unknown }).text === "string") {
      return (v as { text: string }).text;
    }
    if (
      "richText" in v &&
      Array.isArray((v as { richText: unknown[] }).richText)
    ) {
      return (v as { richText: { text: string }[] }).richText
        .map((rt) => rt.text)
        .join("");
    }
    if ("result" in v) return String((v as { result: unknown }).result ?? "");
  }
  return String(v);
}

function readCellNumber(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
): number {
  const v = sheet.getRow(row).getCell(col).value;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,$]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "number") return r;
    if (typeof r === "string") {
      const n = Number(r.replace(/[,$]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

function parseDateCell(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string") {
    const d = new Date(value);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  return null;
}

function parseAsOfDate(text: string): string | null {
  // "As of December 31, 2024" → 2024-12-31; fall back to Date.parse.
  const m = /as of\s+([A-Za-z]+\s+\d+,\s+\d{4})/i.exec(text);
  const candidate = m ? m[1] : text;
  const d = new Date(candidate);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
