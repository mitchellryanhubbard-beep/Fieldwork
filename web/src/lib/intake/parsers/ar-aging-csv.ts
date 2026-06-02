import {
  buildHeaderIndex,
  cellDate,
  cellNum,
  cellStr,
  parseCsv,
} from "@/lib/intake/parsers/csv-util";
import {
  rollUpArAgingCustomers,
  type ArAging,
  type ArInvoice,
} from "@/lib/ar-aging-parser";

// AR Aging CSV parser. Accepts the formats typical accounting systems
// export — QuickBooks "Open Invoices" detail, NetSuite "AR Aging" detail,
// Sage exports, etc. Maps headers via alias lookup so we don't need a
// per-system parser. If headers don't match closely enough, throw with a
// readable hint — the auditor falls back to manual mapping.

const ALIASES: Record<keyof ArInvoice, string[]> = {
  custNum: ["Cust #", "Customer #", "Customer Number", "Customer ID", "Cust ID"],
  custName: ["Customer Name", "Customer", "Name"],
  invoiceNum: ["Invoice #", "Invoice Number", "Invoice No", "Inv #"],
  invoiceDate: ["Invoice Date", "Inv Date", "Date"],
  dueDate: ["Due Date", "Due"],
  terms: ["Terms", "Payment Terms"],
  salesRep: ["Sales Rep", "Rep", "Salesperson"],
  total: [
    "Invoice Total",
    "Invoice Total ($)",
    "Total",
    "Total ($)",
    "Amount",
    "Balance",
  ],
  current: ["Current", "Current ($)", "0-30", "Not Yet Due"],
  d1_30: ["1-30", "1-30 Days", "1-30 Days ($)", "1 to 30 Days", "30"],
  d31_60: ["31-60", "31-60 Days", "31-60 Days ($)", "31 to 60 Days", "60"],
  d61_90: ["61-90", "61-90 Days", "61-90 Days ($)", "61 to 90 Days", "90"],
  d90_plus: [
    "90+",
    "90+ Days",
    "90+ Days ($)",
    "Over 90",
    "Over 90 Days",
    "120+",
  ],
  credits: ["Credits", "Credits ($)", "Unapplied"],
  notes: ["Notes", "Memo", "Comments"],
};

// Headers that the parser considers REQUIRED. Without these we can't
// build a meaningful aging — error out and direct the auditor to manual
// mapping.
const REQUIRED_FIELDS: (keyof ArInvoice)[] = [
  "custNum",
  "custName",
  "invoiceNum",
  "total",
];

export async function parseArAgingCsv(bytes: Buffer): Promise<ArAging> {
  const text = bytes.toString("utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) {
    throw new Error("CSV is empty");
  }

  // Skip leading banner/metadata rows until we find a row whose columns
  // include enough of the alias map to be recognized as the header.
  let headerRowIdx = -1;
  let index: Record<keyof ArInvoice, number | undefined> | null = null;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const candidate = buildHeaderIndex(rows[r], ALIASES);
    const requiredHit = REQUIRED_FIELDS.every(
      (f) => candidate[f] !== undefined,
    );
    if (requiredHit) {
      headerRowIdx = r;
      index = candidate;
      break;
    }
  }
  if (headerRowIdx === -1 || !index) {
    throw new Error(
      "Could not detect headers — at minimum 'Customer #', 'Customer Name', 'Invoice #', and 'Total' must be present. Use manual mapping if your file uses different column names.",
    );
  }

  const invoices: ArInvoice[] = [];
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const custNum = cellStr(row, index.custNum);
    const custName = cellStr(row, index.custName);
    const invoiceNum = cellStr(row, index.invoiceNum);
    // Subtotal / total / blank rows.
    if (!custNum && !invoiceNum) continue;
    if (
      /^(subtotal|total|grand total)\b/i.test(custNum) ||
      /^(subtotal|total|grand total)\b/i.test(custName)
    ) {
      continue;
    }
    invoices.push({
      custNum,
      custName,
      invoiceNum,
      invoiceDate: cellDate(row, index.invoiceDate),
      dueDate: cellDate(row, index.dueDate),
      terms: cellStr(row, index.terms),
      salesRep: cellStr(row, index.salesRep),
      total: cellNum(row, index.total),
      current: cellNum(row, index.current),
      d1_30: cellNum(row, index.d1_30),
      d31_60: cellNum(row, index.d31_60),
      d61_90: cellNum(row, index.d61_90),
      d90_plus: cellNum(row, index.d90_plus),
      credits: cellNum(row, index.credits),
      notes: cellStr(row, index.notes),
    });
  }

  if (invoices.length === 0) {
    throw new Error(
      "No invoice rows detected in the CSV — the file may be empty or every row was filtered as a subtotal.",
    );
  }

  return {
    asOfDate: null, // Most CSVs don't carry an as-of date; auditor can set it on manual mapping.
    customers: rollUpArAgingCustomers(invoices),
    invoices,
    total: invoices.reduce((acc, inv) => acc + inv.total, 0),
  };
}
