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
  // Combined 90+ bucket. When the source file splits 91-120 / 120+
  // separately, both are preserved on the optional `d91_120` and
  // `d120_plus` below and `d90_plus` carries their sum so legacy
  // callers keep working.
  d90_plus: number;
  d91_120?: number;
  d120_plus?: number;
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
  d91_120?: number;
  d120_plus?: number;
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

  const asOfDate = scanForAsOfDate(sheet);

  // First try the invoice-level layout (Hartwell pattern).
  const invoices = parseInvoiceLevel(sheet);

  // Customer-level fallback (Marigold pattern): one row per customer with
  // aging-bucket columns and no invoice detail. We synthesize one
  // placeholder invoice per customer so downstream code keeps working.
  if (invoices.length === 0) {
    const fallback = parseCustomerLevel(sheet);
    if (fallback.length > 0) {
      const customers = rollUpToCustomers(fallback);
      const total = fallback.reduce((acc, inv) => acc + inv.total, 0);
      return { asOfDate, customers, invoices: fallback, total };
    }
    throw new Error(
      "AR Aging xlsx did not match either the invoice-level or customer-level layouts the parser recognises. Use manual mapping or re-export the file with a 'Customer' header row plus aging-bucket columns (Total, Current, 1-30, 31-60, 61-90, 90+).",
    );
  }

  const customers = rollUpToCustomers(invoices);
  const total = invoices.reduce((acc, inv) => acc + inv.total, 0);

  return { asOfDate, customers, invoices, total };
}

// Returns true when the text reads like a footer/subtotal/total/summary
// row rather than a real customer or invoice. Both parsers run every
// row through this so the returned invoice + customer lists are
// guaranteed pure data — no sums, no cross-checks, no "% of" rows.
function isSummaryRowLabel(text: string): boolean {
  if (!text) return false;
  const t = text.trim();
  if (!t) return false;
  // Catches "Subtotal", "Sub-total", "Sub Total", "Sub-Totals", etc.
  // anywhere in the line. Customer names containing literal "subtotal"
  // are vanishingly rare; subtotal rows are common — so we err on
  // skip-if-present.
  if (/\bsub[-\s]?totals?\b/i.test(t)) return true;
  return (
    // Totals / grand totals / net rollups — anchored to start so a
    // real customer name like "Total Solutions LLC" isn't filtered.
    /^(grand\s+)?totals?\b/i.test(t) ||
    /^net\s+(total|ar|receivables?)\b/i.test(t) ||
    // "Total AR / Total Trade / Total receivables" anywhere — these
    // phrases never appear in a real customer name.
    /\btotal\s+(ar|trade|receivables?|aged|due|outstanding|customers?|aging|gross|net|past[-\s]?due)\b/i.test(
      t,
    ) ||
    /^\bttl\b/i.test(t) ||
    // Footer / cross-check / tie-out / reconciliation rows
    /^(cross[-\s]check|%\s+of|aging\s+(total|summary)|breakdown|summary|footnote|tickmark)/i.test(
      t,
    ) ||
    /^tie[-\s]?(out|to|in)\b|^tied?\s+(out|to)/i.test(t) ||
    /\btie[-\s]?out\b|\bties?\s+to\b/i.test(t) ||
    /^per\s+(tb|trial\s+balance|gl|general\s+ledger|ledger|books)\b/i.test(t) ||
    /\bper\s+(tb|trial\s+balance|gl|general\s+ledger)\b/i.test(t) ||
    /^(variance|difference|diff)\b/i.test(t) ||
    /^(reconciliation|recon)\b/i.test(t) ||
    /^(adj(ustment)?|audit\s+adj)/i.test(t) ||
    /^(book|ledger)\s+balance\b/i.test(t) ||
    // Footer pagination / continuation labels
    /^(continued|cont(\.|inued)?\s+from|carry\s*forward|c\/f|brought\s*forward|b\/f|\.{2,})/i.test(
      t,
    ) ||
    /^(end\s+of|all\s+customers?|customer\s+count)/i.test(t)
  );
}

// Hartwell layout: invoice rows have customer code in col 1, invoice # in
// col 3, and aging buckets in fixed columns 8-13.
function parseInvoiceLevel(sheet: ExcelJS.Worksheet): ArInvoice[] {
  const invoices: ArInvoice[] = [];
  for (let r = 8; r <= sheet.rowCount; r++) {
    const c1 = readCellText(sheet, r, 1).trim();
    const c2 = readCellText(sheet, r, 2).trim();
    const c3 = readCellText(sheet, r, 3).trim();
    if (!c1) continue;
    if (isSummaryRowLabel(c1) || isSummaryRowLabel(c2) || isSummaryRowLabel(c3))
      continue;
    if (!c3) continue;
    if (!/^[A-Z]\d{2,5}$/.test(c1)) continue;

    const invoiceLevelD90Plus = readCellNumber(sheet, r, 13);
    const current = readCellNumber(sheet, r, 9);
    const d1_30 = readCellNumber(sheet, r, 10);
    const d31_60 = readCellNumber(sheet, r, 11);
    const d61_90 = readCellNumber(sheet, r, 12);
    // Reject rows with no aged-bucket breakdown — TB tie-out lines
    // and other reconciliation rows often carry a total but no aging.
    const bucketSum =
      Math.abs(current) +
      Math.abs(d1_30) +
      Math.abs(d31_60) +
      Math.abs(d61_90) +
      Math.abs(invoiceLevelD90Plus);
    if (bucketSum === 0) continue;
    invoices.push({
      custNum: c1,
      custName: readCellText(sheet, r, 2).trim(),
      invoiceNum: c3,
      invoiceDate: parseDateCell(sheet.getRow(r).getCell(4).value),
      dueDate: parseDateCell(sheet.getRow(r).getCell(5).value),
      terms: readCellText(sheet, r, 6).trim(),
      salesRep: readCellText(sheet, r, 7).trim(),
      total: readCellNumber(sheet, r, 8),
      current,
      d1_30,
      d31_60,
      d61_90,
      d90_plus: invoiceLevelD90Plus,
      // Hartwell layout has a single 90+ column; the split fields
      // aren't available here, so put everything on d91_120 and zero
      // d120_plus. Workpapers that use the split will still total to
      // d90_plus.
      d91_120: invoiceLevelD90Plus,
      d120_plus: 0,
      credits: readCellNumber(sheet, r, 14),
      notes: readCellText(sheet, r, 15).trim(),
    });
  }
  return invoices;
}

// Marigold-style customer-level layout. Detects the header row by scanning
// for "Customer" + aging-bucket keywords, then maps columns by header text
// (positions vary between schedules). Each customer becomes a synthetic
// one-invoice row tagged with `${custNum}-AGG` so downstream sampling can
// still pick at the customer grain.
function parseCustomerLevel(sheet: ExcelJS.Worksheet): ArInvoice[] {
  const headerRow = findCustomerAgingHeaderRow(sheet);
  if (headerRow == null) return [];

  const map = mapAgingColumns(sheet, headerRow);
  if (map.customer == null || map.total == null) return [];

  // If the schedule carries an Invoice # column, each row is a real
  // invoice and we treat them as such — rollUpToCustomers will then
  // aggregate same-name customers down to one ArCustomer.
  const invoiceCol = findInvoiceNumberColumn(sheet, headerRow);

  const invoices: ArInvoice[] = [];
  // Assign a stable custNum per UNIQUE customer name across all rows
  // (case-insensitive, trimmed) so multiple invoice rows for the same
  // customer share a custNum and the rollup collapses them correctly.
  const custNumByName = new Map<string, string>();
  let custCounter = 1;
  for (let r = headerRow + 1; r <= sheet.rowCount; r++) {
    const custName = readCellText(sheet, r, map.customer).trim();
    if (!custName) continue;
    if (isSummaryRowLabel(custName)) continue;

    const total = readCellNumber(sheet, r, map.total);
    if (total === 0) continue;

    const key = custName.toLowerCase();
    let custNum = custNumByName.get(key);
    if (!custNum) {
      custNum = `C${String(custCounter).padStart(3, "0")}`;
      custCounter += 1;
      custNumByName.set(key, custNum);
    }

    const d91_120 =
      map.d90_plus != null ? readCellNumber(sheet, r, map.d90_plus) : 0;
    const d120_plus =
      map.d120_plus != null ? readCellNumber(sheet, r, map.d120_plus) : 0;
    const d90_plus = d91_120 + d120_plus;
    const current = map.current != null ? readCellNumber(sheet, r, map.current) : 0;
    const d1_30 = map.d1_30 != null ? readCellNumber(sheet, r, map.d1_30) : 0;
    const d31_60 = map.d31_60 != null ? readCellNumber(sheet, r, map.d31_60) : 0;
    const d61_90 = map.d61_90 != null ? readCellNumber(sheet, r, map.d61_90) : 0;

    // Reject rows that carry a total but no aged-bucket breakdown. A
    // real customer's balance is always distributed across at least
    // one of the aging columns; rows like "TB account 1200" or other
    // tie-out/reconciliation lines often show a total with no aging
    // detail and slip past the label filter.
    const bucketSum =
      Math.abs(current) +
      Math.abs(d1_30) +
      Math.abs(d31_60) +
      Math.abs(d61_90) +
      Math.abs(d91_120) +
      Math.abs(d120_plus);
    if (bucketSum === 0) continue;

    const invoiceNum =
      invoiceCol != null
        ? readCellText(sheet, r, invoiceCol).trim() || `${custNum}-${r}`
        : `${custNum}-AGG`;
    invoices.push({
      custNum,
      custName,
      invoiceNum,
      invoiceDate: null,
      dueDate: null,
      terms: "",
      salesRep: "",
      total,
      current,
      d1_30,
      d31_60,
      d61_90,
      d90_plus,
      d91_120,
      d120_plus,
      credits: 0,
      notes: "",
    });
  }
  return invoices;
}

type CustomerAgingColumns = {
  customer?: number;
  total?: number;
  current?: number;
  d1_30?: number;
  d31_60?: number;
  d61_90?: number;
  d90_plus?: number;
  d120_plus?: number;
};

// Scans the header row for an Invoice # column so the customer-level
// fallback can preserve invoice identity when the schedule is really
// an invoice-detail file dressed up with customer-style headers.
function findInvoiceNumberColumn(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
): number | null {
  const maxCol = Math.min(20, sheet.columnCount);
  for (let c = 1; c <= maxCol; c++) {
    const h = readCellText(sheet, headerRow, c).trim().toLowerCase();
    if (!h) continue;
    if (
      /^invoice(\s*#|\s+(num|number|no\.?))?\s*$/.test(h) ||
      /^inv\s*(#|num|no\.?|number)\s*$/.test(h) ||
      /^doc(ument)?\s*(#|no\.?|num|number)\s*$/.test(h)
    ) {
      return c;
    }
  }
  return null;
}

function findCustomerAgingHeaderRow(
  sheet: ExcelJS.Worksheet,
): number | null {
  const maxRow = Math.min(20, sheet.rowCount);
  const maxCol = Math.min(20, sheet.columnCount);
  for (let r = 1; r <= maxRow; r++) {
    let hasCustomer = false;
    let hasBucket = false;
    for (let c = 1; c <= maxCol; c++) {
      const h = readCellText(sheet, r, c).trim().toLowerCase();
      if (!h) continue;
      if (/^customer(\s+name)?$/.test(h)) hasCustomer = true;
      if (/^(current|1\s*-\s*30|31\s*-\s*60|61\s*-\s*90)$/.test(h))
        hasBucket = true;
    }
    if (hasCustomer && hasBucket) return r;
  }
  return null;
}

function mapAgingColumns(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
): CustomerAgingColumns {
  const map: CustomerAgingColumns = {};
  const maxCol = Math.min(20, sheet.columnCount);
  for (let c = 1; c <= maxCol; c++) {
    const h = readCellText(sheet, headerRow, c).trim().toLowerCase();
    if (!h) continue;
    if (map.customer == null && /^customer(\s+name)?$/.test(h)) {
      map.customer = c;
    } else if (map.total == null && /^total$/.test(h)) {
      map.total = c;
    } else if (map.current == null && /^current$/.test(h)) {
      map.current = c;
    } else if (map.d1_30 == null && /^1\s*-\s*30$/.test(h)) {
      map.d1_30 = c;
    } else if (map.d31_60 == null && /^31\s*-\s*60$/.test(h)) {
      map.d31_60 = c;
    } else if (map.d61_90 == null && /^61\s*-\s*90$/.test(h)) {
      map.d61_90 = c;
    } else if (
      map.d90_plus == null &&
      /^(90\+|over\s*90|91\s*-\s*120)$/.test(h)
    ) {
      map.d90_plus = c;
    } else if (map.d120_plus == null && /^120\+$/.test(h)) {
      map.d120_plus = c;
    }
  }
  return map;
}

// Scan the first six rows for the as-of date. Tolerates the Hartwell
// "As of December 31, 2024", the Marigold "Year Ended December 31, 2025",
// or a bare date string anywhere in those rows.
function scanForAsOfDate(sheet: ExcelJS.Worksheet): string | null {
  const maxRow = Math.min(6, sheet.rowCount);
  const maxCol = Math.min(10, sheet.columnCount);
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const text = readCellText(sheet, r, c).trim();
      if (!text) continue;
      const parsed = parseAsOfDate(text);
      if (parsed) return parsed;
    }
  }
  return null;
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
      existing.d91_120 = (existing.d91_120 ?? 0) + (inv.d91_120 ?? 0);
      existing.d120_plus = (existing.d120_plus ?? 0) + (inv.d120_plus ?? 0);
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
        d91_120: inv.d91_120 ?? 0,
        d120_plus: inv.d120_plus ?? 0,
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
  // "As of December 31, 2024" or "Year Ended December 31, 2025" or a bare
  // date string. Pull the first long-form date (Month Day, Year) we see.
  // Falls back to Date.parse on the raw text.
  const longForm = /([A-Z][a-z]+\s+\d{1,2},\s+\d{4})/.exec(text);
  if (longForm) {
    const d = new Date(longForm[1]);
    if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
  }
  // ISO-style: 2024-12-31
  const iso = /(\d{4})-(\d{2})-(\d{2})/.exec(text);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  // Slashed: 12/31/2024
  const slashed = /(\d{1,2})\/(\d{1,2})\/(\d{4})/.exec(text);
  if (slashed) {
    const mm = slashed[1].padStart(2, "0");
    const dd = slashed[2].padStart(2, "0");
    return `${slashed[3]}-${mm}-${dd}`;
  }
  const d = new Date(text);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}
