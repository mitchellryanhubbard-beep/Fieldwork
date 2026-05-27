import ExcelJS from "exceljs";
import type { EngagementSetup } from "@/lib/engagement-schema";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";
import {
  ASSERTION_LABELS,
  TESTING_APPROACH_LABELS,
  type AssertionMatrix,
  type AssertionMatrixRow,
} from "@/lib/assertion-matrix";
import type { TrialBalance, TrialBalanceAccount } from "@/lib/tb-parser";

// FSLI groupings — used to consolidate TB accounts into lead sheets.
// `prefix` is the account-number prefix. `relatedPrefixes` are siblings that
// roll into the same lead sheet (e.g. PP&E gross + Accumulated Depreciation).
type FsliGroup = {
  fsli: string;
  prefix: string;
  relatedPrefixes: string[];
};

const FSLI_GROUPS: FsliGroup[] = [
  { fsli: "Cash and Cash Equivalents", prefix: "101", relatedPrefixes: [] },
  { fsli: "Accounts Receivable, net", prefix: "110", relatedPrefixes: [] },
  { fsli: "Inventory", prefix: "120", relatedPrefixes: ["121", "122", "123"] },
  { fsli: "Prepaid Expenses", prefix: "130", relatedPrefixes: [] },
  { fsli: "Property, Plant & Equipment, net", prefix: "150", relatedPrefixes: ["151"] },
  { fsli: "Other Assets", prefix: "160", relatedPrefixes: ["170", "180", "190"] },
  { fsli: "Accounts Payable", prefix: "201", relatedPrefixes: [] },
  { fsli: "Accrued Liabilities", prefix: "210", relatedPrefixes: [] },
  { fsli: "Debt and Credit Facilities", prefix: "220", relatedPrefixes: ["230"] },
  { fsli: "Other Liabilities", prefix: "240", relatedPrefixes: ["250", "260"] },
  { fsli: "Equity", prefix: "30", relatedPrefixes: [] },
  { fsli: "Revenue", prefix: "4", relatedPrefixes: [] },
  { fsli: "Cost of Goods Sold", prefix: "5", relatedPrefixes: [] },
  { fsli: "Operating Expenses", prefix: "60", relatedPrefixes: ["61", "62", "63"] },
];

function findFsli(acctNum: string): string {
  for (const g of FSLI_GROUPS) {
    if (acctNum.startsWith(g.prefix)) return g.fsli;
    for (const rp of g.relatedPrefixes) {
      if (acctNum.startsWith(rp)) return g.fsli;
    }
  }
  return "Other";
}

// Match matrix rows to a TB account by token overlap. Token overlap is
// tolerant of small label variations ("Cash & Cash Equivalents" vs "Cash and
// Cash Equivalents") and of the matrix using grouped names like "Inventory —
// Raw Materials" that include the TB's single-row name as a substring.
const MATCH_STOPWORDS = new Set([
  "and",
  "of",
  "the",
  "to",
  "for",
  "net",
  "gross",
]);

function nameTokens(s: string): string[] {
  return s
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((w) => w.length >= 3 && !MATCH_STOPWORDS.has(w));
}

function matchMatrixRow(
  account: TrialBalanceAccount,
  matrix: AssertionMatrix,
): AssertionMatrixRow | undefined {
  // Respect the TB's per-account scoping — Below-PM accounts shouldn't pick
  // up a matrix row even if a token happens to overlap.
  if (/below pm/i.test(account.materialityScoping)) return undefined;

  const needle = nameTokens(account.name);
  if (needle.length === 0) return undefined;
  const needleSet = new Set(needle);

  let best: AssertionMatrixRow | undefined;
  let bestScore = 0;
  for (const row of matrix.rows) {
    const haystack = new Set(nameTokens(row.account));
    let overlap = 0;
    for (const tok of needleSet) if (haystack.has(tok)) overlap++;
    if (overlap > bestScore) {
      bestScore = overlap;
      best = row;
    }
  }
  // Require either full needle coverage (single-word needles like "Inventory")
  // or at least 2 shared tokens. Prevents matches like
  // "Other Long-Term Liabilities" → "Accrued Liabilities" via the single
  // shared token "liabilities".
  const requiredOverlap = Math.min(2, needleSet.size);
  return bestScore >= requiredOverlap ? best : undefined;
}

const USD_FMT = '"$"#,##0;[Red]("$"#,##0);"—"';
const PCT_FMT = "0.0%;[Red]-0.0%;\"—\"";

export type WorkpaperBinderInput = {
  engagement: EngagementSetup;
  matrix: AssertionMatrix;
  trialBalance: TrialBalance | null;
};

export async function generateWorkpaperBinder(
  input: WorkpaperBinderInput,
): Promise<Buffer> {
  const { engagement, matrix, trialBalance } = input;

  const wb = new ExcelJS.Workbook();
  wb.creator = "Fieldwork";
  wb.created = new Date(matrix.generatedAt);
  wb.title = `${engagement.client.name} — FY${engagement.client.fiscalYearEnd.slice(0, 4)} Workpapers`;

  buildScopingSheet(wb, engagement, matrix, trialBalance);
  buildAssertionPlanSheet(wb, matrix);
  if (trialBalance) {
    buildLeadSheets(wb, engagement, matrix, trialBalance);
  }
  buildNotesSheet(wb, engagement, matrix, trialBalance);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Scoping sheet
// ---------------------------------------------------------------------------

function buildScopingSheet(
  wb: ExcelJS.Workbook,
  engagement: EngagementSetup,
  matrix: AssertionMatrix,
  trialBalance: TrialBalance | null,
) {
  const sheet = wb.addWorksheet("Scoping", {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  // Column widths.
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 60;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 60;

  // Title block.
  const title = sheet.addRow([`${engagement.client.name} — Scoping Memo`]);
  title.font = { name: "Calibri", size: 16, bold: true };
  sheet.mergeCells(title.number, 1, title.number, 6);

  const sub = sheet.addRow([
    `Fiscal year end ${engagement.client.fiscalYearEnd} · ${FRAMEWORK_LABELS[engagement.framework]} · ${INDUSTRY_LABELS[engagement.industry]}`,
  ]);
  sub.font = { italic: true, color: { argb: "FF555555" } };
  sheet.mergeCells(sub.number, 1, sub.number, 6);
  sheet.addRow([]);

  // Materiality block.
  sectionHeader(sheet, "Materiality");
  const m = engagement.materiality;
  addLabelValue(sheet, "Overall materiality", m.overallMateriality, USD_FMT);
  addLabelValue(sheet, "Performance materiality", m.performanceMateriality, USD_FMT);
  addLabelValue(sheet, "Clearly trivial threshold", m.clearlyTrivialThreshold, USD_FMT);
  const basisRow = sheet.addRow(["Basis", m.basis]);
  basisRow.getCell(1).font = { bold: true };
  basisRow.alignment = { vertical: "top", wrapText: true };
  basisRow.height = Math.max(40, m.basis.length / 1.2);
  sheet.mergeCells(basisRow.number, 2, basisRow.number, 6);
  sheet.addRow([]);

  // Account selection block.
  sectionHeader(sheet, "Account Selection");
  sheet.addRow([
    "TB Scoping is the auditor's judgment from the trial balance " +
      "(not a strict balance > PM math check). Above PM is shown separately.",
  ]).font = { italic: true, color: { argb: "FF555555" } };

  const header = sheet.addRow([
    "Account",
    "FSLI",
    "CY Balance",
    "PY Balance",
    "Above PM?",
    "TB Scoping",
    "Rationale",
  ]);
  styleTableHeader(header);

  const pm = engagement.materiality.performanceMateriality;

  if (trialBalance) {
    for (const a of trialBalance.accounts) {
      const matrixRow = matchMatrixRow(a, matrix);
      const aboveBalanceThreshold = Math.abs(a.cyBalance) > pm;
      // Normalize the TB's scoping column. Empty cells fall back to the
      // matrix match (matched ⇒ Scoped In, otherwise Out of Scope).
      const tbScoping = a.materialityScoping?.trim();
      const scope = tbScoping
        ? tbScoping
        : matrixRow
          ? "Scoped In"
          : "Out of Scope";
      const isScopedIn = /scoped in/i.test(scope);
      // Rationale picks the most accurate explanation we have:
      //   - matrix match → use the matrix's planned-approach rationale
      //   - scoped in per TB but no matrix row → flag for follow-up
      //   - out of scope per TB → reference the auditor's judgment (not the
      //     balance math, which may or may not be below PM)
      const rationale = matrixRow
        ? matrixRow.approachRationale
        : isScopedIn
          ? "Scoped per TB but no matrix row generated — confirm scoping before fieldwork."
          : "Auditor scoped out per TB (not subject to substantive procedures).";
      const row = sheet.addRow([
        `${a.acctNum} — ${a.name}`,
        a.section,
        a.cyBalance,
        a.pyBalance,
        aboveBalanceThreshold ? "Yes" : "No",
        scope,
        rationale,
      ]);
      row.alignment = { vertical: "top", wrapText: true };
      row.height = Math.max(row.height ?? 0, 30);
      row.getCell(3).numFmt = USD_FMT;
      row.getCell(4).numFmt = USD_FMT;

      // Color the "Above PM?" cell red when the math says above-PM but the
      // auditor scoped it out — that's the contradiction worth flagging.
      if (aboveBalanceThreshold && !isScopedIn) {
        row.getCell(5).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFFADBD8" },
        };
        row.getCell(5).font = { bold: true, color: { argb: "FF8A2F2F" } };
      } else if (aboveBalanceThreshold) {
        row.getCell(5).font = { bold: true };
      }

      const scopeFill = isScopedIn
        ? {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: "FFD4EDDA" },
          }
        : {
            type: "pattern" as const,
            pattern: "solid" as const,
            fgColor: { argb: "FFF8F9FA" },
          };
      row.getCell(6).fill = scopeFill;
      row.getCell(6).font = { bold: true };
    }
  } else {
    sheet.addRow([
      "Trial balance not parsed — upload the CY TB to populate this section.",
    ]);
  }
}

function sectionHeader(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text]);
  row.font = { bold: true, size: 12, color: { argb: "FF1D3A52" } };
  row.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: "FFEDE5D3" },
  };
  sheet.mergeCells(row.number, 1, row.number, 6);
}

function addLabelValue(
  sheet: ExcelJS.Worksheet,
  label: string,
  value: number | string,
  numFmt?: string,
) {
  const row = sheet.addRow([label, value]);
  row.getCell(1).font = { bold: true };
  if (numFmt) row.getCell(2).numFmt = numFmt;
}

function styleTableHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.height = 22;
  row.alignment = { vertical: "middle" };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1D3A52" },
    };
  });
}

// ---------------------------------------------------------------------------
// Assertion plan sheet (reused matrix view)
// ---------------------------------------------------------------------------

function buildAssertionPlanSheet(wb: ExcelJS.Workbook, matrix: AssertionMatrix) {
  const sheet = wb.addWorksheet("Assertion Plan", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const columns = [
    { header: "#", width: 4 },
    { header: "Account", width: 38 },
    { header: "Type", width: 10 },
    { header: "CY Balance", width: 16 },
    { header: "PY Balance", width: 16 },
    { header: "Material?", width: 10 },
    { header: "Overall Risk", width: 14 },
    { header: "Assertions", width: 50 },
    { header: "Risks", width: 60 },
    { header: "PY Exceptions", width: 36 },
    { header: "Planned Approach", width: 22 },
    { header: "Rationale", width: 60 },
    { header: "Citation", width: 50 },
  ];

  const rows = matrix.rows.map((r, i) => [
    i + 1,
    r.account,
    r.accountType,
    r.cyBalance === 0 ? "—" : r.cyBalance,
    r.pyBalance == null || r.pyBalance === 0 ? "—" : r.pyBalance,
    r.materialAccount ? "Yes" : "No",
    r.overallRiskLevel,
    r.relevantAssertions.map((a) => ASSERTION_LABELS[a]).join(", "),
    r.risks.join("\n"),
    r.pyExceptions.join("\n"),
    TESTING_APPROACH_LABELS[r.plannedApproach],
    r.approachRationale,
    r.citation,
  ]);

  sheet.addTable({
    name: "FieldworkAssertionPlan",
    ref: "A1",
    headerRow: true,
    style: { theme: "TableStyleMedium2", showRowStripes: true },
    columns: columns.map((c) => ({ name: c.header, filterButton: true })),
    rows,
  });
  columns.forEach((c, i) => (sheet.getColumn(i + 1).width = c.width));

  styleTableHeader(sheet.getRow(1));
  sheet.getColumn(4).numFmt = USD_FMT;
  sheet.getColumn(5).numFmt = USD_FMT;
  sheet.eachRow({ includeEmpty: false }, (row, i) => {
    if (i === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(row.height ?? 0, 60);
  });
  sheet.getColumn(7).eachCell({ includeEmpty: false }, (cell, i) => {
    if (i === 1) return;
    const val = String(cell.value ?? "");
    const fg =
      val === "High"
        ? "FFFADBD8"
        : val === "Moderate"
          ? "FFFFF3CD"
          : val === "Low"
            ? "FFD4EDDA"
            : null;
    if (fg) {
      cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fg } };
    }
    cell.font = { bold: true };
  });
}

// ---------------------------------------------------------------------------
// Lead sheets — one per material FSLI
// ---------------------------------------------------------------------------

function buildLeadSheets(
  wb: ExcelJS.Workbook,
  engagement: EngagementSetup,
  matrix: AssertionMatrix,
  trialBalance: TrialBalance,
) {
  // Group accounts by FSLI.
  const grouped: Record<string, TrialBalanceAccount[]> = {};
  for (const a of trialBalance.accounts) {
    const fsli = findFsli(a.acctNum);
    (grouped[fsli] ??= []).push(a);
  }

  // Order: match the FSLI_GROUPS sequence, then any "Other".
  const orderedFslis = [
    ...FSLI_GROUPS.map((g) => g.fsli).filter((f) => grouped[f]?.length),
    ...(grouped["Other"] ? ["Other"] : []),
  ];

  for (const fsli of orderedFslis) {
    const accounts = grouped[fsli];
    if (!accounts || accounts.length === 0) continue;

    // Only generate lead sheets for FSLIs with at least one in-scope account.
    const hasScopedAccount = accounts.some((a) => {
      const m = matchMatrixRow(a, matrix);
      return m != null;
    });
    if (!hasScopedAccount) continue;

    buildLeadSheet(wb, engagement, matrix, fsli, accounts);
  }
}

function buildLeadSheet(
  wb: ExcelJS.Workbook,
  engagement: EngagementSetup,
  matrix: AssertionMatrix,
  fsli: string,
  accounts: TrialBalanceAccount[],
) {
  const sheetName = `Lead — ${fsli}`.slice(0, 31); // Excel sheet-name cap
  const sheet = wb.addWorksheet(sheetName, {
    views: [{ state: "frozen", ySplit: 7 }],
  });

  // Column widths.
  sheet.getColumn(1).width = 14;
  sheet.getColumn(2).width = 42;
  sheet.getColumn(3).width = 16;
  sheet.getColumn(4).width = 16;
  sheet.getColumn(5).width = 14;
  sheet.getColumn(6).width = 12;
  sheet.getColumn(7).width = 20;
  sheet.getColumn(8).width = 60;

  // Title.
  const title = sheet.addRow([`${fsli} — Lead Sheet`]);
  title.font = { size: 14, bold: true, color: { argb: "FF1D3A52" } };
  sheet.mergeCells(title.number, 1, title.number, 8);

  const sub = sheet.addRow([
    `${engagement.client.name} · FYE ${engagement.client.fiscalYearEnd}`,
  ]);
  sub.font = { italic: true, color: { argb: "FF555555" } };
  sheet.mergeCells(sub.number, 1, sub.number, 8);
  sheet.addRow([]);

  // Tickmark legend placeholder.
  const tickHdr = sheet.addRow(["Tickmark legend"]);
  tickHdr.font = { bold: true };
  sheet.addRow(["✓", "Agreed to trial balance"]);
  sheet.addRow(["X", "Agreed to confirmation"]);
  sheet.addRow([]);

  // Account roll-forward table.
  const header = sheet.addRow([
    "Acct #",
    "Account",
    "CY Balance",
    "PY Balance",
    "$ Change",
    "% Change",
    "Planned Approach",
    "Risks / Notes",
  ]);
  styleTableHeader(header);

  let cyTotal = 0;
  let pyTotal = 0;
  for (const a of accounts) {
    const matrixRow = matchMatrixRow(a, matrix);
    const cy = a.cyBalance;
    const py = a.pyBalance;
    cyTotal += cy;
    pyTotal += py;
    const dollarChange = cy - py;
    const pctChange = py !== 0 ? dollarChange / Math.abs(py) : null;
    const row = sheet.addRow([
      a.acctNum,
      a.name,
      cy,
      py,
      dollarChange,
      pctChange,
      matrixRow
        ? TESTING_APPROACH_LABELS[matrixRow.plannedApproach]
        : "Not scoped",
      matrixRow ? matrixRow.risks.join("; ") : "—",
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(row.height ?? 0, 30);
    row.getCell(3).numFmt = USD_FMT;
    row.getCell(4).numFmt = USD_FMT;
    row.getCell(5).numFmt = USD_FMT;
    row.getCell(6).numFmt = PCT_FMT;
  }

  // Subtotal row.
  const subtotal = sheet.addRow([
    "",
    "TOTAL",
    cyTotal,
    pyTotal,
    cyTotal - pyTotal,
    pyTotal !== 0 ? (cyTotal - pyTotal) / Math.abs(pyTotal) : null,
    "",
    "",
  ]);
  subtotal.font = { bold: true };
  subtotal.eachCell((cell) => {
    cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
  });
  subtotal.getCell(3).numFmt = USD_FMT;
  subtotal.getCell(4).numFmt = USD_FMT;
  subtotal.getCell(5).numFmt = USD_FMT;
  subtotal.getCell(6).numFmt = PCT_FMT;

  // Materiality reference.
  sheet.addRow([]);
  const matRow = sheet.addRow([
    "",
    "Performance materiality (PM)",
    engagement.materiality.performanceMateriality,
    "",
    "Material?",
    Math.abs(cyTotal) > engagement.materiality.performanceMateriality
      ? "Yes"
      : "No",
  ]);
  matRow.getCell(3).numFmt = USD_FMT;
  matRow.getCell(2).font = { bold: true };
  matRow.getCell(5).font = { bold: true };

  // Reviewer sign-off block.
  sheet.addRow([]);
  const signoffHdr = sheet.addRow(["Sign-off"]);
  signoffHdr.font = { bold: true, color: { argb: "FF1D3A52" } };
  sheet.addRow(["Preparer", "", "Date", ""]);
  sheet.addRow(["Reviewer", "", "Date", ""]);
}

// ---------------------------------------------------------------------------
// Notes sheet
// ---------------------------------------------------------------------------

function buildNotesSheet(
  wb: ExcelJS.Workbook,
  engagement: EngagementSetup,
  matrix: AssertionMatrix,
  trialBalance: TrialBalance | null,
) {
  const sheet = wb.addWorksheet("Engagement Notes");
  sheet.getColumn(1).width = 24;
  sheet.getColumn(2).width = 110;

  const hdr = sheet.addRow(["Field", "Value"]);
  styleTableHeader(hdr);

  sheet.addRow(["Engagement ID", engagement.engagementId]);
  sheet.addRow(["Client", engagement.client.name]);
  sheet.addRow(["FYE", engagement.client.fiscalYearEnd]);
  sheet.addRow(["Framework", FRAMEWORK_LABELS[engagement.framework]]);
  sheet.addRow(["Industry", INDUSTRY_LABELS[engagement.industry]]);
  sheet.addRow(["Matrix generated at", matrix.generatedAt]);
  sheet.addRow(["Matrix model", matrix.modelVersion]);
  sheet.addRow(["Matrix rows", matrix.rows.length]);
  sheet.addRow([
    "Trial balance",
    trialBalance
      ? `Parsed: ${trialBalance.accounts.length} accounts`
      : "Not parsed — upload the CY TB for real balances",
  ]);

  if (matrix.notes) {
    sheet.addRow([]);
    const nh = sheet.addRow(["Model notes (caveats)", ""]);
    nh.font = { bold: true };
    const nc = sheet.addRow(["", matrix.notes]);
    nc.alignment = { vertical: "top", wrapText: true };
    nc.height = Math.max(matrix.notes.split("\n").length * 18, 120);
  }
}
