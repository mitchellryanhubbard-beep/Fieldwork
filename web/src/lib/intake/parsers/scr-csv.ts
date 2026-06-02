import {
  buildHeaderIndex,
  cellDate,
  cellNum,
  cellStr,
  parseCsv,
} from "@/lib/intake/parsers/csv-util";
import type {
  ScrReceipt,
  SubsequentCashReceipts,
} from "@/lib/scr-parser";

// Subsequent Cash Receipts CSV parser.

type Field =
  | "receiptNum"
  | "customerName"
  | "invoiceNum"
  | "invoiceDate"
  | "invoiceAmount"
  | "receiptDate"
  | "amountReceived"
  | "appliedInFull"
  | "remainingBalance"
  | "notes";

const ALIASES: Record<Field, string[]> = {
  receiptNum: ["Receipt #", "Receipt Number", "Receipt No", "Transaction #"],
  customerName: ["Customer", "Customer Name"],
  invoiceNum: ["Invoice Applied", "Invoice #", "Invoice Number"],
  invoiceDate: ["Invoice Date", "Inv Date"],
  invoiceAmount: ["Invoice Amt", "Invoice Amount", "Invoice Total"],
  receiptDate: ["Receipt Date", "Date Received", "Date"],
  amountReceived: [
    "Amount Rcvd",
    "Amount Received",
    "Amount Rcvd ($)",
    "Amount",
    "Payment",
  ],
  appliedInFull: ["Applied In Full?", "Applied In Full", "Full Payment?"],
  remainingBalance: [
    "Remaining Balance",
    "Remaining Balance ($)",
    "Remaining",
    "Outstanding",
  ],
  notes: ["Notes", "Memo", "Comments"],
};

const REQUIRED: Field[] = [
  "receiptNum",
  "customerName",
  "invoiceNum",
  "amountReceived",
];

export async function parseSubsequentCashReceiptsCsv(
  bytes: Buffer,
): Promise<SubsequentCashReceipts> {
  const text = bytes.toString("utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("CSV is empty");

  let headerRowIdx = -1;
  let index: Record<Field, number | undefined> | null = null;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const candidate = buildHeaderIndex(rows[r], ALIASES);
    if (REQUIRED.every((f) => candidate[f] !== undefined)) {
      headerRowIdx = r;
      index = candidate;
      break;
    }
  }
  if (headerRowIdx === -1 || !index) {
    throw new Error(
      "Could not detect headers — at minimum 'Receipt #', 'Customer', 'Invoice', and 'Amount Received' must be present. Use manual mapping if your file uses different column names.",
    );
  }

  // Try to pick up the period label from a leading banner row.
  const periodLabel =
    rows
      .slice(0, headerRowIdx)
      .map((r) => r.find((c) => /jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec|period/i.test(c)))
      .find((s): s is string => typeof s === "string") ?? null;

  const receipts: ScrReceipt[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const receiptNum = cellStr(row, index.receiptNum);
    if (!receiptNum) continue;
    if (/^(total|subtotal)\b/i.test(receiptNum)) continue;
    if (/^auditor note/i.test(receiptNum)) continue;

    receipts.push({
      receiptNum,
      customerName: cellStr(row, index.customerName),
      invoiceNum: cellStr(row, index.invoiceNum),
      invoiceDate: cellDate(row, index.invoiceDate),
      invoiceAmount: cellNum(row, index.invoiceAmount),
      receiptDate: cellDate(row, index.receiptDate),
      amountReceived: cellNum(row, index.amountReceived),
      appliedInFull: /^yes|^y$|^true$/i.test(cellStr(row, index.appliedInFull)),
      remainingBalance: cellNum(row, index.remainingBalance),
      notes: cellStr(row, index.notes),
    });
  }

  if (receipts.length === 0) {
    throw new Error(
      "No receipt rows detected in the CSV — every row was filtered as a subtotal or note.",
    );
  }

  return {
    periodLabel,
    receipts,
    totalReceived: receipts.reduce((acc, r) => acc + r.amountReceived, 0),
  };
}
