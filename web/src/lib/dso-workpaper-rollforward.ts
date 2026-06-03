import ExcelJS from "exceljs";
import type { TrialBalance } from "@/lib/tb-parser";
import type { ArAging } from "@/lib/ar-aging-parser";

// Focused DSO-workpaper rollforward. The generic year-column engine
// in py-workpaper-cy-generator treats a DSO workpaper as a trend
// table with year columns; that destroys the row labels in col B
// because col B is BOTH the year column (after a merged "DSO (2024)"
// header) AND the label column. This module walks each section by
// banner text and writes specific values to specific cells without
// ever touching the label column.

const DAYS_IN_PERIOD = 365;

type Metrics = {
  revenue?: number;
  grossAr?: number;
  allowance?: number;
  netAr?: number;
  days?: number;
  dso?: number;
  industry?: number;
  variance?: number;
};

export type DsoRolloverResult = {
  handledSheets: Set<string>;
  updates: number;
};

export function rolloverDsoWorkpaper(
  wb: ExcelJS.Workbook,
  trialBalance: TrialBalance | null,
  arAging: ArAging | null,
): DsoRolloverResult {
  const handled = new Set<string>();
  let updates = 0;

  for (const sheet of wb.worksheets) {
    if (!isDsoWorkpaperSheet(sheet)) continue;
    handled.add(sheet.name);

    // Scope each section's column window using the other's banner so
    // a side-by-side DSO + Aging layout doesn't get confused.
    const dsoBanner = findBannerCell(sheet, /^dso\s+computation/i);
    const agingBanner = findBannerCell(sheet, /^aging\s+distribution/i);

    if (trialBalance && dsoBanner) {
      updates += rolloverDsoComputationSection(sheet, trialBalance, {
        banner: dsoBanner,
        colMax: agingBanner ? agingBanner.col - 1 : sheet.columnCount,
      });
    }
    if (arAging && agingBanner) {
      updates += rolloverAgingDistributionSection(sheet, arAging, {
        banner: agingBanner,
        colMax: sheet.columnCount,
      });
    }
  }

  return { handledSheets: handled, updates };
}

type SectionScope = {
  banner: { row: number; col: number };
  colMax: number;
};

// ---------------------------------------------------------------------------
// Sheet detection
// ---------------------------------------------------------------------------

function isDsoWorkpaperSheet(sheet: ExcelJS.Worksheet): boolean {
  let hasDsoComputation = false;
  for (let r = 1; r <= Math.min(50, sheet.rowCount); r++) {
    for (let c = 1; c <= Math.min(12, sheet.columnCount); c++) {
      const text = readCellText(sheet.getRow(r).getCell(c)).toLowerCase();
      if (/^dso\s+computation/.test(text)) hasDsoComputation = true;
    }
  }
  return hasDsoComputation;
}

// ---------------------------------------------------------------------------
// DSO Computation section
// ---------------------------------------------------------------------------

function rolloverDsoComputationSection(
  sheet: ExcelJS.Worksheet,
  tb: TrialBalance,
  scope: SectionScope,
): number {
  const { banner, colMax } = scope;
  const endRow = findNextBannerRow(sheet, banner.row) ?? sheet.rowCount;

  const labelCol = findLabelColumnInRange(
    sheet,
    banner.row + 1,
    endRow,
    banner.col,
    colMax,
  );
  if (labelCol === -1) return 0;
  const valueCol = findValueColumnInRange(
    sheet,
    banner.row + 1,
    endRow,
    labelCol,
    colMax,
  );
  if (valueCol === -1) return 0;

  const tbVals = computeTbValues(tb);
  const rowsByMetric: Record<string, number> = {};

  // First pass: identify which row each metric lives in.
  for (let r = banner.row + 1; r <= endRow; r++) {
    const label = readCellText(sheet.getRow(r).getCell(labelCol))
      .trim()
      .toLowerCase();
    if (!label) continue;
    const metric = classifyDsoLabel(label);
    if (metric && !rowsByMetric[metric]) rowsByMetric[metric] = r;
  }

  const colL = colNumToLetter(valueCol);
  let updates = 0;

  if (rowsByMetric.revenue != null) {
    setCell(sheet, rowsByMetric.revenue, valueCol, tbVals.revenue);
    updates++;
  }
  if (rowsByMetric.grossAr != null) {
    setCell(sheet, rowsByMetric.grossAr, valueCol, tbVals.grossAr);
    updates++;
  }
  if (rowsByMetric.allowance != null) {
    setCell(sheet, rowsByMetric.allowance, valueCol, tbVals.allowance);
    updates++;
  }
  if (
    rowsByMetric.netAr != null &&
    rowsByMetric.grossAr != null &&
    rowsByMetric.allowance != null
  ) {
    setFormulaCell(
      sheet,
      rowsByMetric.netAr,
      valueCol,
      `${colL}${rowsByMetric.grossAr}+${colL}${rowsByMetric.allowance}`,
      tbVals.netAr,
    );
    updates++;
  }
  if (rowsByMetric.days != null) {
    setCell(sheet, rowsByMetric.days, valueCol, DAYS_IN_PERIOD);
    updates++;
  }
  if (
    rowsByMetric.dso != null &&
    rowsByMetric.grossAr != null &&
    rowsByMetric.revenue != null &&
    rowsByMetric.days != null
  ) {
    const dsoVal =
      tbVals.revenue === 0
        ? 0
        : (tbVals.grossAr / tbVals.revenue) * DAYS_IN_PERIOD;
    setFormulaCell(
      sheet,
      rowsByMetric.dso,
      valueCol,
      `ROUND(${colL}${rowsByMetric.grossAr}/${colL}${rowsByMetric.revenue}*${colL}${rowsByMetric.days},1)`,
      Math.round(dsoVal * 10) / 10,
    );
    updates++;
  }
  // industry: intentionally untouched — carries the prior-year benchmark.
  if (
    rowsByMetric.variance != null &&
    rowsByMetric.dso != null &&
    rowsByMetric.industry != null
  ) {
    const industryVal = readNumber(
      sheet.getRow(rowsByMetric.industry).getCell(valueCol).value,
    );
    const dsoVal =
      tbVals.revenue === 0
        ? 0
        : (tbVals.grossAr / tbVals.revenue) * DAYS_IN_PERIOD;
    setFormulaCell(
      sheet,
      rowsByMetric.variance,
      valueCol,
      `${colL}${rowsByMetric.dso}-${colL}${rowsByMetric.industry}`,
      (industryVal !== null
        ? Math.round(dsoVal * 10) / 10 - industryVal
        : 0),
    );
    updates++;
  }

  return updates;
}

function classifyDsoLabel(label: string): keyof Metrics | null {
  if (/^gross\s+(trade\s+receivables?|accounts?\s+receivable|ar|a\/r)/.test(label))
    return "grossAr";
  if (/allowance(\s+for)?\s+doubtful|less:?\s+allowance/.test(label))
    return "allowance";
  if (/^net\s+(trade\s+receivables?|accounts?\s+receivable|ar|a\/r)/.test(label))
    return "netAr";
  if (/^(net\s+|gross\s+)?(revenue|sales)\b/.test(label)) return "revenue";
  if (/^days\s+in\s+period/.test(label)) return "days";
  if (/^dso\b/.test(label)) return "dso";
  if (/^(industry|benchmark)\b/.test(label)) return "industry";
  if (/^variance/.test(label)) return "variance";
  return null;
}

// ---------------------------------------------------------------------------
// Aging Distribution section
// ---------------------------------------------------------------------------

function rolloverAgingDistributionSection(
  sheet: ExcelJS.Worksheet,
  aging: ArAging,
  scope: SectionScope,
): number {
  const { banner, colMax } = scope;
  const endRow = findNextBannerRow(sheet, banner.row) ?? sheet.rowCount;

  const labelCol = findLabelColumnInRange(
    sheet,
    banner.row + 1,
    endRow,
    banner.col,
    colMax,
  );
  if (labelCol === -1) return 0;
  const valueCol = findValueColumnInRange(
    sheet,
    banner.row + 1,
    endRow,
    labelCol,
    colMax,
  );
  if (valueCol === -1) return 0;

  const totals = computeAgingBucketTotals(aging);
  let updates = 0;

  for (let r = banner.row + 1; r <= endRow; r++) {
    const label = readCellText(sheet.getRow(r).getCell(labelCol))
      .trim()
      .toLowerCase();
    if (!label) continue;
    const cell = sheet.getRow(r).getCell(valueCol);
    if (/^current\b/.test(label)) {
      cell.value = totals.current;
      updates++;
    } else if (/^1\s*[-–]\s*30/.test(label)) {
      cell.value = totals.d1_30;
      updates++;
    } else if (/^31\s*[-–]\s*60/.test(label)) {
      cell.value = totals.d31_60;
      updates++;
    } else if (/^61\s*[-–]\s*90/.test(label)) {
      cell.value = totals.d61_90;
      updates++;
    } else if (/^91\s*[-–]\s*120|^91\+/.test(label)) {
      cell.value = totals.d91_120;
      updates++;
    } else if (/^120\s*\+|^over\s*120/.test(label)) {
      cell.value = totals.d120_plus;
      updates++;
    } else if (/^over\s*90|^90\+/.test(label)) {
      // Workpaper that keeps a single 90+ bucket.
      cell.value = totals.d90_plus;
      updates++;
    }
  }

  return updates;
}

function computeAgingBucketTotals(aging: ArAging): {
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  d91_120: number;
  d120_plus: number;
} {
  let current = 0;
  let d1_30 = 0;
  let d31_60 = 0;
  let d61_90 = 0;
  let d90_plus = 0;
  let d91_120 = 0;
  let d120_plus = 0;
  for (const inv of aging.invoices) {
    current += inv.current;
    d1_30 += inv.d1_30;
    d31_60 += inv.d31_60;
    d61_90 += inv.d61_90;
    d90_plus += inv.d90_plus;
    d91_120 += inv.d91_120 ?? 0;
    d120_plus += inv.d120_plus ?? 0;
  }
  return { current, d1_30, d31_60, d61_90, d90_plus, d91_120, d120_plus };
}

// ---------------------------------------------------------------------------
// TB values
// ---------------------------------------------------------------------------

function computeTbValues(tb: TrialBalance): {
  revenue: number;
  grossAr: number;
  allowance: number;
  netAr: number;
} {
  let revenue = 0;
  let grossAr = 0;
  let allowance = 0;
  for (const a of tb.accounts) {
    if (a.section === "Revenue") revenue += a.cyBalance;
    if (/allowance(\s+for)?\s+doubtful/i.test(a.name)) {
      allowance += a.cyBalance;
    } else if (
      /accounts?\s+receivable|trade\s+receivables?|^a\/r$|^ar$/i.test(a.name)
    ) {
      grossAr += a.cyBalance;
    }
  }
  if (revenue < 0) revenue = -revenue;
  const netAr = grossAr + allowance;
  return { revenue, grossAr, allowance, netAr };
}

// ---------------------------------------------------------------------------
// Section / label / value column detection
// ---------------------------------------------------------------------------

function findBannerCell(
  sheet: ExcelJS.Worksheet,
  pattern: RegExp,
): { row: number; col: number } | null {
  const maxRow = Math.min(80, sheet.rowCount);
  const maxCol = Math.min(12, sheet.columnCount);
  for (let r = 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const text = readCellText(sheet.getRow(r).getCell(c)).trim();
      if (pattern.test(text)) return { row: r, col: c };
    }
  }
  return null;
}

function findNextBannerRow(
  sheet: ExcelJS.Worksheet,
  afterRow: number,
): number | null {
  const maxRow = Math.min(80, sheet.rowCount);
  const maxCol = Math.min(12, sheet.columnCount);
  for (let r = afterRow + 1; r <= maxRow; r++) {
    for (let c = 1; c <= maxCol; c++) {
      const text = readCellText(sheet.getRow(r).getCell(c)).trim();
      if (
        /^(dso\s+computation|aging\s+distribution|allowance\s+adequacy|cross[-\s]check|conclusion|past[-\s]due)/i.test(
          text,
        )
      ) {
        return r;
      }
    }
  }
  return null;
}

// The label column is the column that has the most text labels matching
// the metrics we care about within the section.
function findLabelColumnInRange(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  colMin: number,
  colMax: number,
): number {
  const upper = Math.min(colMax, sheet.columnCount);
  let bestCol = -1;
  let bestHits = 0;
  for (let c = colMin; c <= upper; c++) {
    let hits = 0;
    for (let r = startRow; r <= endRow; r++) {
      const text = readCellText(sheet.getRow(r).getCell(c)).trim().toLowerCase();
      if (!text) continue;
      if (
        classifyDsoLabel(text) ||
        /^current\b|^\d+\s*[-–]\s*\d+|^120\s*\+|^total/.test(text)
      ) {
        hits++;
      }
    }
    if (hits > bestHits) {
      bestHits = hits;
      bestCol = c;
    }
  }
  return bestCol;
}

function findValueColumnInRange(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  endRow: number,
  labelCol: number,
  colMax: number,
): number {
  const upper = Math.min(colMax, sheet.columnCount);
  for (let c = labelCol + 1; c <= upper; c++) {
    let numericHits = 0;
    for (let r = startRow; r <= endRow; r++) {
      const v = sheet.getRow(r).getCell(c).value;
      if (typeof v === "number") {
        numericHits++;
      } else if (
        v &&
        typeof v === "object" &&
        "result" in v &&
        typeof (v as { result: unknown }).result === "number"
      ) {
        numericHits++;
      }
    }
    if (numericHits >= 2) return c;
  }
  return -1;
}

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

function setCell(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: number,
): void {
  sheet.getRow(row).getCell(col).value = value;
}

function setFormulaCell(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  formula: string,
  result: number,
): void {
  sheet.getRow(row).getCell(col).value = {
    formula,
    result,
  } as ExcelJS.CellValue;
}

function readCellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
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
      return (v as { richText: { text?: string }[] }).richText
        .map((rt) => rt.text ?? "")
        .join("");
    }
    if ("result" in v) {
      const r = (v as { result: unknown }).result;
      if (typeof r === "string") return r;
    }
  }
  return "";
}

function readNumber(value: ExcelJS.CellValue | undefined): number | null {
  if (typeof value === "number") return value;
  if (value && typeof value === "object" && "result" in value) {
    const r = (value as { result: unknown }).result;
    if (typeof r === "number") return r;
  }
  return null;
}

function colNumToLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const r = (n - 1) % 26;
    s = String.fromCharCode(65 + r) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
