import ExcelJS from "exceljs";
import type { EngagementSetup } from "@/lib/engagement-schema";
import type { ArAging, ArInvoice } from "@/lib/ar-aging-parser";
import type { Selection } from "@/lib/sampling-methodologies";
import { autosizeAllSheets } from "@/lib/excel-autosize";

// Confirmation request workbook builder. Mirrors the AICPA "blank positive
// confirmation" pattern: one workbook, one tab per selected customer.
// Customer is asked to fill in their AP-records balance — we don't
// pre-populate ours. Letters are scoped to invoice-level so the customer
// confirms specific outstanding invoices, not just a top-line total.

const NAVY = "FF1D3A52";
const CREAM = "FFEDE5D3";
const USD_FMT = '"$"#,##0;[Red]("$"#,##0);"—"';

// v1 placeholders. When we ship per-auditor profiles, swap these for the
// values the auditor configured on their account.
const AUDITOR_FIRM_PLACEHOLDER = "[Auditor Firm Name]";
const AUDITOR_ADDRESS_PLACEHOLDER = "[Auditor Address, City, State ZIP]";
const AUDITOR_RETURN_INSTRUCTIONS =
  "Please complete and return this confirmation DIRECTLY TO OUR AUDITORS at the address above (or by email to [auditor email]). Do not return to the company.";

const CUSTOMER_ADDRESS_PLACEHOLDER = "[Customer Address, City, State ZIP]";

export type ConfirmationRequestsInput = {
  engagement: EngagementSetup;
  account: { acctNum: string; name: string };
  aging: ArAging;
  selections: Selection[];   // from the locked Existence sample
  asOfDate: string;          // typically engagement FYE
  letterDate?: string;       // auditor's preferred send date; defaults to today
};

export async function generateConfirmationRequests(
  input: ConfirmationRequestsInput,
): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "Fieldwork";
  wb.title = `${input.engagement.client.name} — AR Confirmation Requests`;

  // Index of invoices by customer #. We only need the ones for selected
  // customers, but indexing once is simpler than nested filters per tab.
  const invoicesByCust = new Map<string, ArInvoice[]>();
  for (const inv of input.aging.invoices) {
    const list = invoicesByCust.get(inv.custNum) ?? [];
    list.push(inv);
    invoicesByCust.set(inv.custNum, list);
  }

  const letterDate = input.letterDate ?? new Date().toISOString().slice(0, 10);

  for (const sel of input.selections) {
    const invoices = invoicesByCust.get(sel.custNum) ?? [];
    buildCustomerLetter(wb, {
      engagement: input.engagement,
      account: input.account,
      selection: sel,
      invoices,
      asOfDate: input.asOfDate,
      letterDate,
    });
  }

  autosizeAllSheets(wb);
  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

function buildCustomerLetter(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
    account: { acctNum: string; name: string };
    selection: Selection;
    invoices: ArInvoice[];
    asOfDate: string;
    letterDate: string;
  },
) {
  const { engagement, selection, invoices, asOfDate, letterDate } = args;
  // Tab name = customer #. Excel caps at 31 chars; cust numbers are short.
  const sheet = wb.addWorksheet(selection.custNum.slice(0, 31), {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  // Layout: 6 columns wide, plenty of room for the invoice table.
  sheet.getColumn(1).width = 22;
  sheet.getColumn(2).width = 16;
  sheet.getColumn(3).width = 16;
  sheet.getColumn(4).width = 16;
  sheet.getColumn(5).width = 28;
  sheet.getColumn(6).width = 22;

  // -----------------------------------------------------------------------
  // Auditor letterhead (placeholders until per-auditor profile ships).
  // -----------------------------------------------------------------------
  addRow(sheet, [AUDITOR_FIRM_PLACEHOLDER], { bold: true });
  addRow(sheet, [AUDITOR_ADDRESS_PLACEHOLDER]);
  addRow(sheet, []);
  addRow(sheet, [formatLongDate(letterDate)]);
  addRow(sheet, []);

  // -----------------------------------------------------------------------
  // Customer address block
  // -----------------------------------------------------------------------
  addRow(sheet, ["Accounts Receivable Department"]);
  addRow(sheet, [selection.custName], { bold: true });
  addRow(sheet, [CUSTOMER_ADDRESS_PLACEHOLDER]);
  addRow(sheet, []);

  // -----------------------------------------------------------------------
  // Subject + salutation
  // -----------------------------------------------------------------------
  addRow(sheet, [
    `Re: Confirmation of Account Balance with ${engagement.client.name}`,
  ], { bold: true });
  addRow(sheet, []);
  addRow(sheet, ["Dear Sir or Madam:"]);
  addRow(sheet, []);

  // -----------------------------------------------------------------------
  // Body
  // -----------------------------------------------------------------------
  addParagraph(
    sheet,
    `Our auditors, ${AUDITOR_FIRM_PLACEHOLDER}, are performing an audit of the financial statements of ` +
      `${engagement.client.name} as of ${formatLongDate(asOfDate)}. In connection with that audit, ` +
      `please confirm the balance owed by your company to ${engagement.client.name} as of that date by ` +
      `completing the information below and returning this letter directly to our auditors.`,
  );
  addRow(sheet, []);

  // Important note — blank positive confirmation guidance.
  addParagraph(
    sheet,
    "IMPORTANT — BLANK POSITIVE CONFIRMATION: Please do not refer to a statement or invoice when " +
      "completing this confirmation. Provide the balance per your accounts payable records as of the " +
      "date shown above, even if that differs from the amount you may have been billed.",
    { bold: true },
  );
  addRow(sheet, []);

  addParagraph(
    sheet,
    `NOTE: This confirmation covers ${invoices.length} specific invoice(s) selected by the auditors for ` +
      `testing. Please verify the balance per your records for each of the invoices listed below.`,
  );
  addRow(sheet, []);

  // -----------------------------------------------------------------------
  // Selected invoices table
  // -----------------------------------------------------------------------
  sectionBanner(
    sheet,
    `SELECTED INVOICES AS OF ${formatLongDate(asOfDate).toUpperCase()}  (${invoices.length} items)`,
  );
  const hdr = addRow(sheet, [
    "Invoice Number",
    "Invoice Date",
    "Due Date",
    "Payment Terms",
    "Balance per Your AP Records ($)",
    "",
  ]);
  styleTableHeader(hdr);

  for (const inv of invoices) {
    const row = addRow(sheet, [
      inv.invoiceNum,
      inv.invoiceDate ?? "",
      inv.dueDate ?? "",
      inv.terms,
      "",            // BLANK — customer fills in
      "",
    ]);
    row.getCell(5).numFmt = USD_FMT;
    row.getCell(5).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FFFFFDD0" },  // soft yellow — visually flags "to fill"
    };
    row.getCell(5).border = {
      top: { style: "thin" },
      bottom: { style: "thin" },
      left: { style: "thin" },
      right: { style: "thin" },
    };
  }
  const totalRow = addRow(sheet, [
    `TOTAL BALANCE OWED TO ${engagement.client.name.toUpperCase()} — ${invoices.length} INVOICE(S)`,
    "",
    "",
    "",
    "",
    "",
  ]);
  totalRow.font = { bold: true };
  totalRow.getCell(5).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFFFFDD0" },
  };
  totalRow.getCell(5).border = {
    top: { style: "double" },
    bottom: { style: "double" },
    left: { style: "thin" },
    right: { style: "thin" },
  };
  addRow(sheet, []);

  // -----------------------------------------------------------------------
  // Return-to-auditor instructions
  // -----------------------------------------------------------------------
  addParagraph(sheet, AUDITOR_RETURN_INSTRUCTIONS, { bold: true });
  addRow(sheet, []);

  // -----------------------------------------------------------------------
  // Respondent signature block
  // -----------------------------------------------------------------------
  sectionBanner(sheet, "RESPONDENT SIGNATURE");
  signaturePair(sheet, "Authorized Signature", "");
  signaturePair(sheet, "Printed Name & Title", "");
  signaturePair(sheet, "Company Name", selection.custName);
  signaturePair(sheet, "Date", "");
  signaturePair(sheet, "Phone / Email", "");
  addRow(sheet, []);

  // -----------------------------------------------------------------------
  // Auditor tracking — filled in by the audit team after sending
  // -----------------------------------------------------------------------
  sectionBanner(sheet, "FOR AUDITOR USE ONLY — DO NOT COMPLETE");
  signaturePair(sheet, "Date Mailed / Emailed", "");
  signaturePair(sheet, "Date Response Received", "");
  signaturePair(sheet, "Response: Agree / Differ / No Response", "");
  signaturePair(sheet, "Exception Amount (if any)", "");
  signaturePair(sheet, "Follow-up Action Required", "");
  signaturePair(sheet, "Cleared By / Date", "");
}

// ---------------------------------------------------------------------------
// Sheet helpers — kept private to this file. Styling matches the rest of
// the workpaper output (navy + cream) so the binder reads as one product.
// ---------------------------------------------------------------------------

function addRow(
  sheet: ExcelJS.Worksheet,
  values: (string | number)[],
  opts: { bold?: boolean } = {},
): ExcelJS.Row {
  const row = sheet.addRow(values);
  row.alignment = { vertical: "top", wrapText: true };
  if (opts.bold) row.font = { bold: true };
  return row;
}

function addParagraph(
  sheet: ExcelJS.Worksheet,
  text: string,
  opts: { bold?: boolean } = {},
): void {
  const row = sheet.addRow([text]);
  row.alignment = { vertical: "top", wrapText: true };
  if (opts.bold) row.font = { bold: true };
  sheet.mergeCells(row.number, 1, row.number, 6);
}

function sectionBanner(sheet: ExcelJS.Worksheet, text: string): void {
  const row = sheet.addRow([text]);
  row.font = { bold: true, color: { argb: NAVY } };
  row.alignment = { vertical: "middle" };
  row.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: CREAM },
  };
  sheet.mergeCells(row.number, 1, row.number, 6);
}

function styleTableHeader(row: ExcelJS.Row): void {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.height = 22;
  row.alignment = { vertical: "middle" };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: NAVY },
    };
  });
}

function signaturePair(
  sheet: ExcelJS.Worksheet,
  label: string,
  value: string,
): void {
  const row = sheet.addRow([label, value, "", "", "", ""]);
  row.getCell(1).font = { bold: true };
  row.getCell(2).border = { bottom: { style: "thin" } };
  sheet.mergeCells(row.number, 2, row.number, 6);
}

function formatLongDate(iso: string): string {
  // "2024-12-31" → "December 31, 2024". Parse YYYY-MM-DD as a local date
  // (not UTC) so server-runtime timezones don't shift the displayed day.
  // Falls back to the raw string when the input isn't a valid date.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const [, y, mo, d] = m;
  const date = new Date(Number(y), Number(mo) - 1, Number(d));
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}
