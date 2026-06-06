import ExcelJS from "exceljs";
import { autosizeAllSheets } from "@/lib/excel-autosize";
import { displayAccountName } from "@/lib/account-name";
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

// FSLI categorization — driven by the account NAME, not the account
// number. Chart-of-accounts numbering varies by client, so prefix-
// based matching gives wrong results outside narrow conventions
// ("1010 Cash" works; "1300 Cash" doesn't). We test the account name
// against an ordered list of regex patterns; the first match wins,
// which is why ordering matters — more-specific patterns sit ahead of
// their generic siblings (e.g. "accumulated depreciation" must beat
// "depreciation" alone).
//
// FSLI_GROUPS is the canonical list of FSLIs the binder groups
// accounts into. Each entry pairs a display label with the matchers
// that route accounts onto it.

type FsliGroup = {
  fsli: string;
  // Patterns ordered from most-specific to most-generic within this
  // FSLI. First hit wins across the whole list (not within a group).
  patterns: RegExp[];
};

const FSLI_GROUPS: FsliGroup[] = [
  // Accumulated depreciation rolls up under PP&E — list this BEFORE
  // bare "depreciation" (which is an operating expense) so the more
  // specific phrase wins.
  {
    fsli: "Property, Plant & Equipment, net",
    patterns: [/\baccumulated\s+depreci/i],
  },
  // Allowance for doubtful is a contra-AR account.
  {
    fsli: "Accounts Receivable, net",
    patterns: [/\ballowance\s+for\s+doubtful/i],
  },
  {
    fsli: "Cash and Cash Equivalents",
    patterns: [
      /\bcash\b/i,
      /\bpetty\s+cash\b/i,
      /\bmoney\s+market\b/i,
      /\bcertificat\w*\s+of\s+deposit\b/i,
      /\bcds?\b/i,
      /\b(bank|checking|savings)\s+account\b/i,
      /\bdemand\s+deposit\b/i,
    ],
  },
  {
    fsli: "Accounts Receivable, net",
    patterns: [
      /\baccounts?\s+receivable\b/i,
      /\btrade\s+receivable\b/i,
      /\ba\/?r\b/i,
      /\breceivable\s+from\b/i,
    ],
  },
  {
    fsli: "Inventory",
    patterns: [
      /\binventory\b/i,
      /\braw\s+materials?\b/i,
      /\bwork[- ]in[- ]progress\b/i,
      /\bwip\b/i,
      /\bfinished\s+goods?\b/i,
    ],
  },
  {
    fsli: "Prepaid Expenses",
    patterns: [/\bprepaid\b/i],
  },
  // Debt patterns sit AHEAD of PP&E so that names like "Long-Term
  // Debt — Equipment Loan" route to Debt instead of being captured by
  // the "Equipment" PP&E pattern.
  {
    fsli: "Debt and Credit Facilities",
    patterns: [
      /\bline\s+of\s+credit\b/i,
      /\bloc\b/i,
      /\bcredit\s+facility\b/i,
      /\b(long|short)[- ]term\s+debt\b/i,
      /\bequipment\s+loan\b/i,
      /\bloan\b/i,
      /\bnotes?\s+payable\b/i,
      /\bbonds?\s+payable\b/i,
      /\bmortgage\b/i,
    ],
  },
  {
    fsli: "Accounts Payable",
    patterns: [
      /\baccounts?\s+payable\b/i,
      /\btrade\s+payable\b/i,
      /\ba\/?p\b/i,
      /\bpayable\s+to\b/i,
    ],
  },
  {
    fsli: "Accrued Liabilities",
    patterns: [/\baccrued\b/i],
  },
  {
    fsli: "Property, Plant & Equipment, net",
    patterns: [
      /\bproperty\b/i,
      /\bplant\b/i,
      /\bequipment\b/i,
      /\bbuilding\b/i,
      /\bland\b/i,
      /\bmachinery\b/i,
      /\bfixtures?\b/i,
      /\bvehicles?\b/i,
      /\bleasehold\s+improvements?\b/i,
      /\bpp&?e\b/i,
    ],
  },
  {
    fsli: "Other Assets",
    patterns: [
      /\bdeposits?\b/i,
      /\bgoodwill\b/i,
      /\bintangible\b/i,
      /\binvestments?\b/i,
      /\bother\s+assets?\b/i,
    ],
  },
  {
    fsli: "Other Liabilities",
    patterns: [
      /\b(deferred|unearned)\s+(revenue|income)\b/i,
      /\bother\s+(long[- ]term\s+)?liabilit/i,
    ],
  },
  {
    fsli: "Equity",
    patterns: [
      /\bcommon\s+stock\b/i,
      /\bpreferred\s+stock\b/i,
      /\bretained\s+earnings\b/i,
      /\bpaid[- ]in\s+capital\b/i,
      /\bcontributed\s+capital\b/i,
      /\btreasury\s+stock\b/i,
      /\baoci\b/i,
      /\bequity\b/i,
      /\bdividends?\b/i,
    ],
  },
  {
    fsli: "Revenue",
    patterns: [
      /\brevenue\b/i,
      /\bnet\s+sales\b/i,
      /\bsales\s+revenue\b/i,
      /\bservice\s+revenue\b/i,
      /\bincome\s+from\s+operations\b/i,
    ],
  },
  {
    fsli: "Cost of Goods Sold",
    patterns: [
      /\bcost\s+of\s+goods\s+sold\b/i,
      /\bcogs\b/i,
      /\bcost\s+of\s+sales\b/i,
      /\bcost\s+of\s+revenue\b/i,
    ],
  },
  {
    fsli: "Operating Expenses",
    patterns: [
      /\bsalar/i,
      /\bwages?\b/i,
      /\bpayroll\b/i,
      /\butilit/i,
      /\brent\b/i,
      /\binsurance\b/i,
      /\bprofessional\s+fees?\b/i,
      /\blegal\s+fees?\b/i,
      /\bconsulting\b/i,
      /\brepairs?\s+(and|&)\s+maintenance\b/i,
      /\bmaintenance\b/i,
      /\bdeprec\w*\s+expenses?\b/i,
      /\bamortization\b/i,
      /\badvertising\b/i,
      /\bmarketing\b/i,
      /\btravel\b/i,
      /\boffice\s+suppl/i,
      /\binterest\s+expenses?\b/i,
      /\btax\s+expenses?\b/i,
      /\boperating\s+expenses?\b/i,
      /\bsg&?a\b/i,
      /\bg&?a\b/i,
      /\badministrative\b/i,
      /\bexpenses?\b/i,
    ],
  },
];

// Canonical balance-sheet display order — used by lead-sheet
// pagination so tabs land in a predictable, audit-conventional
// sequence. Decoupled from FSLI_GROUPS so we can keep that list in
// pattern-match-specificity order without disturbing the UI.
const CANONICAL_FSLI_ORDER = [
  "Cash and Cash Equivalents",
  "Accounts Receivable, net",
  "Inventory",
  "Prepaid Expenses",
  "Property, Plant & Equipment, net",
  "Other Assets",
  "Accounts Payable",
  "Accrued Liabilities",
  "Debt and Credit Facilities",
  "Other Liabilities",
  "Equity",
  "Revenue",
  "Cost of Goods Sold",
  "Operating Expenses",
] as const;

// Resolve an account's FSLI from its NAME. Account number is accepted
// only for backwards compatibility with legacy call sites and is no
// longer consulted in the matching itself.
export function findFsli(_acctNum: string, name?: string): string {
  if (name && name.trim().length > 0) {
    for (const g of FSLI_GROUPS) {
      for (const re of g.patterns) {
        if (re.test(name)) return g.fsli;
      }
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

export function matchMatrixRow(
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
  wb.creator = "First-Pass";
  wb.created = new Date(matrix.generatedAt);
  wb.title = `${engagement.client.name} — FY${engagement.client.fiscalYearEnd.slice(0, 4)} Workpapers`;

  buildScopingSheet(wb, engagement, matrix, trialBalance);
  buildAssertionPlanSheet(wb, matrix);
  if (trialBalance) {
    buildLeadSheets(wb, engagement, matrix, trialBalance);
  }
  buildNotesSheet(wb, engagement, matrix, trialBalance);

  autosizeAllSheets(wb);

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
  sheet.addRow([]);

  // Account selection block.
  //
  // Scope is First-Pass-derived — never read from a TB column. Two signals
  // feed the decision:
  //   1. Materiality (PM):    |CY balance| > PM → coverage required
  //   2. Assertion matrix:    matrix row exists → risk-driven scoping
  //
  // Accounts are "Scoped In" when EITHER signal fires. The Rationale
  // column explains which one — using the matrix's own approach
  // rationale where available, falling back to a materiality citation.
  // The auditor can override either column post-generation.
  sectionHeader(sheet, "Account Selection");
  sheet.addRow([
    "Scope is derived from First-Pass: balance vs. performance materiality + assertion-matrix coverage. " +
      "Override the Scope or Rationale columns directly if your judgment differs.",
  ]).font = { italic: true, color: { argb: "FF555555" } };

  const header = sheet.addRow([
    "Account",
    "FSLI",
    "CY Balance",
    "PY Balance",
    "Above PM?",
    "Scope",
    "Rationale",
  ]);
  styleTableHeader(header);

  const pm = engagement.materiality.performanceMateriality;

  if (trialBalance) {
    for (const a of trialBalance.accounts) {
      const matrixRow = matchMatrixRow(a, matrix);
      const abovePm = Math.abs(a.cyBalance) > pm;
      const inMatrix = matrixRow != null;
      const isScopedIn = abovePm || inMatrix;

      // Rationale precedence: matrix's own approachRationale takes
      // priority (richest signal); otherwise cite the materiality math;
      // otherwise explicitly mark as out-of-scope.
      const rationale = matrixRow
        ? matrixRow.approachRationale
        : abovePm
          ? `Above performance materiality (|CY| $${Math.abs(a.cyBalance).toLocaleString()} > PM $${pm.toLocaleString()}) — substantive coverage required.`
          : "Below performance materiality and not flagged by the assertion matrix — no substantive procedures planned.";

      const row = sheet.addRow([
        `${a.acctNum} — ${displayAccountName(a.name)}`,
        findFsli(a.acctNum, a.name),
        a.cyBalance,
        a.pyBalance,
        abovePm ? "Yes" : "No",
        isScopedIn ? "Scoped In" : "Scoped Out",
        rationale,
      ]);
      row.alignment = { vertical: "top", wrapText: true };
      row.height = Math.max(row.height ?? 0, 30);
      row.getCell(3).numFmt = USD_FMT;
      row.getCell(4).numFmt = USD_FMT;

      // Above-PM emphasis. No flagging based on a manual override
      // anymore — the scope follows the math by default.
      if (abovePm) {
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
    name: "FirstPassAssertionPlan",
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
    const fsli = findFsli(a.acctNum, a.name);
    (grouped[fsli] ??= []).push(a);
  }

  // Display order — canonical balance-sheet flow (assets, liabilities,
  // equity, then P&L). Distinct from FSLI_GROUPS' ORDER, which is
  // tuned for pattern-match specificity (contra accounts first), not
  // for how a reader expects the lead-sheet tabs to appear.
  const orderedFslis: string[] = [];
  for (const fsli of CANONICAL_FSLI_ORDER) {
    if (grouped[fsli]?.length) orderedFslis.push(fsli);
  }
  if (grouped["Other"]) orderedFslis.push("Other");

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
  const firstAcctRow = sheet.rowCount + 1;
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
      displayAccountName(a.name),
      cy,
      py,
      "",
      "",
      matrixRow
        ? TESTING_APPROACH_LABELS[matrixRow.plannedApproach]
        : "Not scoped",
      matrixRow ? matrixRow.risks.join("; ") : "—",
    ]);
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(row.height ?? 0, 30);
    row.getCell(3).numFmt = USD_FMT;
    row.getCell(4).numFmt = USD_FMT;
    // $ Change = CY − PY, % Change = $ Change / |PY|. Live formulas so the
    // auditor can edit a balance and the column refreshes.
    row.getCell(5).value = {
      formula: `C${row.number}-D${row.number}`,
      result: dollarChange,
    };
    row.getCell(5).numFmt = USD_FMT;
    row.getCell(6).value = {
      formula: `IFERROR((C${row.number}-D${row.number})/ABS(D${row.number}),0)`,
      result: pctChange ?? 0,
    };
    row.getCell(6).numFmt = PCT_FMT;
  }
  const lastAcctRow = sheet.rowCount;

  // Subtotal row — SUM of the account rows + formula-driven $ Change /
  // % Change so it stays in sync with edits.
  const subtotal = sheet.addRow([
    "",
    "TOTAL",
    "",
    "",
    "",
    "",
    "",
    "",
  ]);
  subtotal.font = { bold: true };
  subtotal.eachCell((cell) => {
    cell.border = { top: { style: "thin" }, bottom: { style: "double" } };
  });
  if (lastAcctRow >= firstAcctRow) {
    subtotal.getCell(3).value = {
      formula: `SUM(C${firstAcctRow}:C${lastAcctRow})`,
      result: cyTotal,
    };
    subtotal.getCell(4).value = {
      formula: `SUM(D${firstAcctRow}:D${lastAcctRow})`,
      result: pyTotal,
    };
  } else {
    subtotal.getCell(3).value = cyTotal;
    subtotal.getCell(4).value = pyTotal;
  }
  subtotal.getCell(5).value = {
    formula: `C${subtotal.number}-D${subtotal.number}`,
    result: cyTotal - pyTotal,
  };
  subtotal.getCell(6).value = {
    formula: `IFERROR((C${subtotal.number}-D${subtotal.number})/ABS(D${subtotal.number}),0)`,
    result: pyTotal !== 0 ? (cyTotal - pyTotal) / Math.abs(pyTotal) : 0,
  };
  subtotal.getCell(3).numFmt = USD_FMT;
  subtotal.getCell(4).numFmt = USD_FMT;
  subtotal.getCell(5).numFmt = USD_FMT;
  subtotal.getCell(6).numFmt = PCT_FMT;

  // Materiality reference. Material? is a live formula comparing the
  // subtotal CY against PM so edits stay in sync.
  sheet.addRow([]);
  const matRow = sheet.addRow([
    "",
    "Performance materiality (PM)",
    engagement.materiality.performanceMateriality,
    "",
    "Material?",
    "",
  ]);
  matRow.getCell(3).numFmt = USD_FMT;
  matRow.getCell(2).font = { bold: true };
  matRow.getCell(5).font = { bold: true };
  matRow.getCell(6).value = {
    formula: `IF(ABS(C${subtotal.number})>C${matRow.number},"Yes","No")`,
    result:
      Math.abs(cyTotal) > engagement.materiality.performanceMateriality
        ? "Yes"
        : "No",
  };
  matRow.getCell(6).font = { bold: true };

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
