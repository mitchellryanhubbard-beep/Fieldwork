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

  const periodLabel = readText(sheet, 3, 1).trim() || null;

  const receipts: ScrReceipt[] = [];
  for (let r = 8; r <= sheet.rowCount; r++) {
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

  const totalReceived = receipts.reduce((acc, r) => acc + r.amountReceived, 0);
  return { periodLabel, receipts, totalReceived };
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
