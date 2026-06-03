import ExcelJS from "exceljs";

// Subsequent Cash Receipts (SCR) — receipts collected after the balance
// sheet date that apply against pre-period invoices. Used as the primary
// alternative procedure for AR Existence (proves the receivable existed
// because the customer paid) and as direct evidence for AR Valuation
// (proves collectibility).
//
// Tolerant of the Hartwell layout:
//   row 1: blank
//   row 2: client banner
//   row 3: period banner ("January 1-31, 2025 ...")
//   row 4: blank
//   row 5: summary row (Period / Total / % / Remaining / # Receipts)
//   row 6: "DETAIL" banner
//   row 7: column headers (Receipt # | Customer | Invoice Applied | ...)
//   row 8..N: data rows
//   trailing: TOTAL row, optional AUDITOR NOTE row

export type ScrReceipt = {
  receiptNum: string;
  customerName: string;
  invoiceNum: string;
  invoiceDate: string | null;
  invoiceAmount: number;
  receiptDate: string | null;
  amountReceived: number;
  appliedInFull: boolean;
  remainingBalance: number;
  notes: string;
};

export type SubsequentCashReceipts = {
  periodLabel: string | null;
  receipts: ScrReceipt[];
  totalReceived: number;
};

export async function parseSubsequentCashReceipts(
  buffer: Buffer | ArrayBuffer,
): Promise<SubsequentCashReceipts> {
  const wb = new ExcelJS.Workbook();
  const buf =
    buffer instanceof Buffer ? buffer : Buffer.from(new Uint8Array(buffer));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("SCR file has no worksheets");

  const periodLabel = scanForPeriodLabel(sheet);

  // 1) Hartwell-style invoice-application schedule (receipt → invoice
  //    with applied-in-full / remaining-balance columns). This is the
  //    richest format because it ties each receipt to a specific pre-
  //    period invoice.
  const invoiceReceipts = parseInvoiceApplication(sheet);
  if (invoiceReceipts.length > 0) {
    const total = invoiceReceipts.reduce((a, r) => a + r.amountReceived, 0);
    return { periodLabel, receipts: invoiceReceipts, totalReceived: total };
  }

  // 2) Bank-statement layout with separate Debit (deposits) + Credit
  //    (payments) columns. We treat every Debit row as a receipt and
  //    ignore Credit rows (those are cash *out*, not subsequent
  //    receipts). Invoice linkage isn't available in this format.
  const bankReceipts = parseBankStatementDebitCredit(sheet);
  if (bankReceipts.length > 0) {
    const total = bankReceipts.reduce((a, r) => a + r.amountReceived, 0);
    return { periodLabel, receipts: bankReceipts, totalReceived: total };
  }

  // 3) Single signed-amount column (e.g., positive = receipt, negative
  //    = refund). We keep only positive amounts.
  const signedReceipts = parseSignedAmountColumn(sheet);
  if (signedReceipts.length > 0) {
    const total = signedReceipts.reduce((a, r) => a + r.amountReceived, 0);
    return { periodLabel, receipts: signedReceipts, totalReceived: total };
  }

  throw new Error(
    "SCR xlsx layout was not recognised. Expected an invoice-application schedule (Receipt # | Customer | Invoice | Amount Received …), a bank-statement detail with Debit + Credit columns, or a single signed Amount column.",
  );
}

// Hartwell layout: receipt → invoice with applied-in-full + remaining
// balance. We only run this parser when the header row carries
// invoice-application keywords (Receipt #, Invoice Applied, Amount
// Received). Otherwise rows from a bank-statement layout would get
// silently misread as invoice rows.
function parseInvoiceApplication(sheet: ExcelJS.Worksheet): ScrReceipt[] {
  const header = findHeaderRow(sheet, (h) => {
    const has = (re: RegExp) =>
      Array.from(h.values()).some((cell) => re.test(cell));
    return (
      has(/^receipt\s*#/i) &&
      has(/^invoice/i) &&
      has(/amount\s+(received|applied)/i)
    );
  });
  if (header == null) return [];

  const receipts: ScrReceipt[] = [];
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const receiptNum = readText(sheet, r, 1).trim();
    const customerName = readText(sheet, r, 2).trim();
    if (!receiptNum) continue;
    if (/^total\b/i.test(receiptNum)) continue;
    if (/^auditor note/i.test(receiptNum)) continue;
    if (/^total\b/i.test(customerName)) continue;
    if (/^auditor note/i.test(customerName)) continue;

    receipts.push({
      receiptNum,
      customerName,
      invoiceNum: readText(sheet, r, 3).trim(),
      invoiceDate: parseDateCell(sheet.getRow(r).getCell(4).value),
      invoiceAmount: readNumber(sheet, r, 5),
      receiptDate: parseDateCell(sheet.getRow(r).getCell(6).value),
      amountReceived: readNumber(sheet, r, 7),
      appliedInFull: /^yes/i.test(readText(sheet, r, 8).trim()),
      remainingBalance: readNumber(sheet, r, 9),
      notes: readText(sheet, r, 10).trim(),
    });
  }
  return receipts;
}

// Marigold layout: bank-statement detail. One Debit column (deposits =
// cash in = receipts) and one Credit column (payments = cash out). We
// build a synthetic receipt per Debit row using the date, payee/source,
// and ref. Credit rows are dropped — they aren't subsequent receipts.
function parseBankStatementDebitCredit(
  sheet: ExcelJS.Worksheet,
): ScrReceipt[] {
  const header = findHeaderRow(sheet, (h) => {
    const has = (re: RegExp) =>
      Array.from(h.values()).some((cell) => re.test(cell));
    return (
      has(/^date\b/i) &&
      has(/\b(debit|deposit|dr)\b/i) &&
      has(/\b(credit|payment|cr)\b/i)
    );
  });
  if (header == null) return [];

  const map = mapBankColumns(sheet, header);
  if (map.date == null || map.debit == null) return [];

  const receipts: ScrReceipt[] = [];
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const debit = readNumber(sheet, r, map.debit);
    if (debit <= 0) continue; // skip credits (cash out) and empty rows

    const date = parseDateCell(sheet.getRow(r).getCell(map.date).value);
    const payee = map.payee != null ? readText(sheet, r, map.payee).trim() : "";
    const description =
      map.description != null
        ? readText(sheet, r, map.description).trim()
        : "";
    const ref = map.ref != null ? readText(sheet, r, map.ref).trim() : "";

    // Skip header/total/note rows that snuck past the value filter.
    if (/^total\b/i.test(payee) || /^total\b/i.test(description)) continue;

    receipts.push({
      receiptNum: ref || `DEP-${date ?? r}`,
      customerName: payee || description || "(unattributed deposit)",
      invoiceNum: "",
      invoiceDate: null,
      invoiceAmount: 0,
      receiptDate: date,
      amountReceived: debit,
      appliedInFull: false,
      remainingBalance: 0,
      notes: description,
    });
  }
  return receipts;
}

// Single-amount layout: one signed Amount column. Positive = receipt,
// negative = refund (dropped).
function parseSignedAmountColumn(
  sheet: ExcelJS.Worksheet,
): ScrReceipt[] {
  const header = findHeaderRow(sheet, (h) => {
    const has = (re: RegExp) =>
      Array.from(h.values()).some((cell) => re.test(cell));
    return (
      has(/^date\b/i) &&
      has(/^(amount|received|total)$/i) &&
      // Disambiguate from the bank-statement layout — only one money
      // column allowed.
      !has(/\b(debit|deposit|dr)\b/i) &&
      !has(/\b(credit|payment|cr)\b/i)
    );
  });
  if (header == null) return [];

  let dateCol: number | null = null;
  let amountCol: number | null = null;
  let payeeCol: number | null = null;
  let refCol: number | null = null;
  let descCol: number | null = null;
  const maxCol = Math.min(20, sheet.columnCount);
  for (let c = 1; c <= maxCol; c++) {
    const h = readText(sheet, header, c).trim().toLowerCase();
    if (!h) continue;
    if (dateCol == null && /^date\b/.test(h)) dateCol = c;
    else if (amountCol == null && /^(amount|received|total)$/.test(h))
      amountCol = c;
    else if (payeeCol == null && /^(payee|source|received from|customer)/.test(h))
      payeeCol = c;
    else if (refCol == null && /^(ref|check\s*#|receipt\s*#)/.test(h))
      refCol = c;
    else if (descCol == null && /^description/.test(h)) descCol = c;
  }
  if (dateCol == null || amountCol == null) return [];

  const receipts: ScrReceipt[] = [];
  for (let r = header + 1; r <= sheet.rowCount; r++) {
    const amount = readNumber(sheet, r, amountCol);
    if (amount <= 0) continue;

    const date = parseDateCell(sheet.getRow(r).getCell(dateCol).value);
    const payee = payeeCol != null ? readText(sheet, r, payeeCol).trim() : "";
    const description = descCol != null ? readText(sheet, r, descCol).trim() : "";
    const ref = refCol != null ? readText(sheet, r, refCol).trim() : "";

    if (/^total\b/i.test(payee) || /^total\b/i.test(description)) continue;

    receipts.push({
      receiptNum: ref || `R-${date ?? r}`,
      customerName: payee || description || "(unattributed)",
      invoiceNum: "",
      invoiceDate: null,
      invoiceAmount: 0,
      receiptDate: date,
      amountReceived: amount,
      appliedInFull: false,
      remainingBalance: 0,
      notes: description,
    });
  }
  return receipts;
}

type BankColumns = {
  date?: number;
  payee?: number;
  description?: number;
  ref?: number;
  debit?: number;
  credit?: number;
};

function mapBankColumns(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
): BankColumns {
  const map: BankColumns = {};
  const maxCol = Math.min(20, sheet.columnCount);
  for (let c = 1; c <= maxCol; c++) {
    const h = readText(sheet, headerRow, c).trim().toLowerCase();
    if (!h) continue;
    if (map.date == null && /^date\b/.test(h)) map.date = c;
    else if (
      map.payee == null &&
      /^(payee|source|received from|customer|payee\s*\/\s*source)/.test(h)
    )
      map.payee = c;
    else if (map.description == null && /^description/.test(h))
      map.description = c;
    else if (
      map.ref == null &&
      /^(ref|check|ref\s*\/\s*check)/.test(h)
    )
      map.ref = c;
    else if (map.debit == null && /\b(debit|deposit|dr)\b/.test(h))
      map.debit = c;
    else if (map.credit == null && /\b(credit|payment|cr)\b/.test(h))
      map.credit = c;
  }
  return map;
}

// Scans the top 20 rows for the first row that matches the supplied
// predicate (testing lower-cased trimmed cell text). Returns the row
// number (1-indexed) or null.
function findHeaderRow(
  sheet: ExcelJS.Worksheet,
  predicate: (cells: Map<number, string>) => boolean,
): number | null {
  const maxRow = Math.min(20, sheet.rowCount);
  const maxCol = Math.min(20, sheet.columnCount);
  for (let r = 1; r <= maxRow; r++) {
    const cells = new Map<number, string>();
    for (let c = 1; c <= maxCol; c++) {
      const h = readText(sheet, r, c).trim().toLowerCase();
      if (h) cells.set(c, h);
    }
    if (predicate(cells)) return r;
  }
  return null;
}

// Look in the first six rows for a period banner ("January 1–31, 2026
// — Subsequent…", "January 2025 …", etc.). Returns the longest non-
// trivial line so the auditor's eyeballed banner survives.
function scanForPeriodLabel(sheet: ExcelJS.Worksheet): string | null {
  const maxRow = Math.min(6, sheet.rowCount);
  let best: string | null = null;
  for (let r = 1; r <= maxRow; r++) {
    const text = readText(sheet, r, 1).trim();
    if (!text) continue;
    if (/january|february|march|april|may|june|july|august|september|october|november|december|jan\b|feb\b|mar\b|apr\b|jun\b|jul\b|aug\b|sep\b|oct\b|nov\b|dec\b/i.test(
      text,
    )) {
      if (!best || text.length > best.length) best = text;
    }
  }
  return best;
}

function readText(sheet: ExcelJS.Worksheet, row: number, col: number): string {
  const v = sheet.getRow(row).getCell(col).value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
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

function readNumber(sheet: ExcelJS.Worksheet, row: number, col: number): number {
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
