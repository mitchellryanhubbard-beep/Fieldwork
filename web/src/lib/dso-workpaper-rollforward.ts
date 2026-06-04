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

// Snapshot of the metric values shown in a DSO computation section at
// a moment in time. We capture one BEFORE overwriting (pyValues) and
// build one from the rolled CY data (cyValues), then use the pair to
// rewrite the conclusion box prose so its numbers match the table.
type Snapshot = {
  revenue?: number;
  grossAr?: number;
  allowance?: number;
  netAr?: number;
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

    let pyValues: Snapshot = {};
    let cyValues: Snapshot = {};

    if (trialBalance && dsoBanner) {
      const result = rolloverDsoComputationSection(sheet, trialBalance, {
        banner: dsoBanner,
        colMax: agingBanner ? agingBanner.col - 1 : sheet.columnCount,
      });
      updates += result.updates;
      pyValues = result.pyValues;
      cyValues = result.cyValues;
    }
    if (arAging && agingBanner) {
      updates += rolloverAgingDistributionSection(sheet, arAging, {
        banner: agingBanner,
        colMax: sheet.columnCount,
      });
    }
    // Always rewrite the conclusion: even if TB / aging weren't
    // provided, resolving the formula refs to plain text is valuable on
    // its own (kills the embedded =formula the auditor sees in the box).
    updates += rolloverDsoConclusionBox(sheet, pyValues, cyValues);
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
  // Sheet name hint: "DSO", "Days Sales Outstanding", etc.
  if (/\bdso\b|days\s+sales\s+outstanding/i.test(sheet.name)) return true;
  // Banner cell anywhere in the top of the sheet. Not anchored to start
  // so prefixed labels like "Hartwell — DSO Computation" still match.
  for (let r = 1; r <= Math.min(50, sheet.rowCount); r++) {
    for (let c = 1; c <= Math.min(12, sheet.columnCount); c++) {
      const text = readCellText(sheet.getRow(r).getCell(c)).toLowerCase();
      if (/dso\s+computation|days\s+sales\s+outstanding/.test(text)) {
        return true;
      }
    }
  }
  return false;
}

// ---------------------------------------------------------------------------
// DSO Computation section
// ---------------------------------------------------------------------------

function rolloverDsoComputationSection(
  sheet: ExcelJS.Worksheet,
  tb: TrialBalance,
  scope: SectionScope,
): { updates: number; pyValues: Snapshot; cyValues: Snapshot } {
  const { banner, colMax } = scope;
  const endRow = findNextBannerRow(sheet, banner.row) ?? sheet.rowCount;

  const labelCol = findLabelColumnInRange(
    sheet,
    banner.row + 1,
    endRow,
    banner.col,
    colMax,
  );
  if (labelCol === -1) {
    return { updates: 0, pyValues: {}, cyValues: {} };
  }
  const valueCol = findValueColumnInRange(
    sheet,
    banner.row + 1,
    endRow,
    labelCol,
    colMax,
  );
  if (valueCol === -1) {
    return { updates: 0, pyValues: {}, cyValues: {} };
  }

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

  // Capture PY values BEFORE we overwrite anything. These are what the
  // conclusion-box prose currently quotes — we need them to find-and-
  // replace later.
  const pyValues: Snapshot = {};
  const readMetric = (metric: keyof Snapshot) => {
    const row = rowsByMetric[metric];
    if (row == null) return;
    const v = readNumber(sheet.getRow(row).getCell(valueCol).value);
    if (v !== null) pyValues[metric] = v;
  };
  readMetric("revenue");
  readMetric("grossAr");
  readMetric("allowance");
  readMetric("netAr");
  readMetric("dso");
  readMetric("industry");
  readMetric("variance");

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
  const cyDso =
    tbVals.revenue === 0
      ? 0
      : Math.round(((tbVals.grossAr / tbVals.revenue) * DAYS_IN_PERIOD) * 10) /
        10;
  if (
    rowsByMetric.dso != null &&
    rowsByMetric.grossAr != null &&
    rowsByMetric.revenue != null &&
    rowsByMetric.days != null
  ) {
    setFormulaCell(
      sheet,
      rowsByMetric.dso,
      valueCol,
      `ROUND(${colL}${rowsByMetric.grossAr}/${colL}${rowsByMetric.revenue}*${colL}${rowsByMetric.days},1)`,
      cyDso,
    );
    updates++;
  }
  // industry: intentionally untouched — carries the prior-year benchmark.
  const industryVal =
    rowsByMetric.industry != null
      ? readNumber(
          sheet.getRow(rowsByMetric.industry).getCell(valueCol).value,
        )
      : null;
  const cyVariance =
    industryVal !== null ? Math.round((cyDso - industryVal) * 10) / 10 : 0;
  if (
    rowsByMetric.variance != null &&
    rowsByMetric.dso != null &&
    rowsByMetric.industry != null
  ) {
    setFormulaCell(
      sheet,
      rowsByMetric.variance,
      valueCol,
      `${colL}${rowsByMetric.dso}-${colL}${rowsByMetric.industry}`,
      cyVariance,
    );
    updates++;
  }

  const cyValues: Snapshot = {
    revenue: tbVals.revenue,
    grossAr: tbVals.grossAr,
    allowance: tbVals.allowance,
    netAr: tbVals.netAr,
    dso: cyDso,
    industry: industryVal ?? undefined,
    variance: industryVal !== null ? cyVariance : undefined,
  };

  return { updates, pyValues, cyValues };
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
// Conclusion box rewrite — resolve formula refs into plain text
// ---------------------------------------------------------------------------
//
// The PY DSO workpaper authors its conclusion as a string-concat formula
// like  ="DSO of "&B7&" days is modestly above the 48-day industry
//        benchmark (+3.5 days)..."
// Leaving the formula intact means the prose silently recomputes against
// whatever the auditor edits in those reference cells later. We want a
// frozen narrative: resolve every `&Ref&` into the current value of the
// referenced cell (post-rollover) and write the whole paragraph back as
// a plain string. Then patch any baked-in PY numerics (variance) so the
// prose matches the new table values too.
//
function rolloverDsoConclusionBox(
  sheet: ExcelJS.Worksheet,
  pyValues: Snapshot,
  cyValues: Snapshot,
): number {
  let updates = 0;
  // Walk every cell with a value, not just up to rowCount/columnCount —
  // ExcelJS's reported dims can lag behind cells we've touched earlier
  // in this pass.
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      // cell.formula returns the formula text (without leading `=`) for
      // both standalone and shared formulas. cell.text gives the cached
      // display text. We check both for the word "conclusion".
      const formulaText =
        typeof cell.formula === "string" ? cell.formula : "";
      const valueText = readCellText(cell);
      const cellText =
        typeof (cell as { text?: unknown }).text === "string"
          ? ((cell as { text: string }).text)
          : "";
      const haystack = `${formulaText}\n${valueText}\n${cellText}`;
      if (!/conclusion/i.test(haystack)) return;

      // Skip narrative section headers like "CONCLUSION:" by themselves
      // — the body of a conclusion paragraph is always long.
      if (haystack.trim().length < 40) return;

      // Some PY workpapers ship the conclusion as a *plain string*
      // that LOOKS like a formula — starts with `=` and uses `&`
      // concatenation — because someone entered it as text. Excel
      // never evaluates it; it just displays the raw text. Treat any
      // value/text that starts with `=` as something to evaluate too.
      const stringFormula =
        valueText.trimStart().startsWith("=") ? valueText : "";
      const formulaToParse = formulaText || stringFormula;

      let plainText: string | null = null;
      if (formulaToParse) {
        plainText =
          evaluateConcatFormula(formulaToParse, sheet) ??
          valueText ??
          cellText ??
          null;
      } else if (typeof cell.value === "string") {
        plainText = cell.value;
      } else if (valueText) {
        plainText = valueText;
      }
      if (plainText == null || plainText === "") return;

      // Patch any PY numerics that survived inside the literal segments
      // (variance and dollar amounts auditors hardcode into the prose).
      let next = plainText;
      next = substituteDollarMetric(next, pyValues.revenue, cyValues.revenue);
      next = substituteDollarMetric(next, pyValues.grossAr, cyValues.grossAr);
      next = substituteDollarMetric(
        next,
        pyValues.allowance,
        cyValues.allowance,
      );
      next = substituteDollarMetric(next, pyValues.netAr, cyValues.netAr);
      next = substituteDaysMetric(next, pyValues.dso, cyValues.dso);
      next = substituteVarianceMetric(
        next,
        pyValues.variance,
        cyValues.variance,
      );

      cell.value = next;
      updates++;
    });
  });
  return updates;
}

// Resolves a string-concat formula like  ="lit"&A1&"lit"&B7&"lit"  into
// a single plain string by reading the current value of each referenced
// cell and formatting it the way Excel would have displayed it. Returns
// null if the formula contains anything beyond literals + cell refs +
// `&` operators (we don't try to be a full Excel evaluator).
function evaluateConcatFormula(
  formula: string,
  sheet: ExcelJS.Worksheet,
): string | null {
  // ExcelJS strips the leading `=` from formula strings; tolerate either
  // form so we work whether the source is parsed or hand-built.
  let body = formula.startsWith("=")
    ? formula.slice(1).trim()
    : formula.trim();
  let out = "";
  while (body.length > 0) {
    if (body.startsWith("&")) {
      body = body.slice(1).trimStart();
      continue;
    }
    if (body.startsWith('"')) {
      // String literal — "" is the escape for a literal ".
      let end = 1;
      while (end < body.length) {
        if (body[end] === '"') {
          if (body[end + 1] === '"') {
            end += 2;
            continue;
          }
          break;
        }
        end++;
      }
      if (end >= body.length) return null;
      out += body.slice(1, end).replace(/""/g, '"');
      body = body.slice(end + 1).trimStart();
      continue;
    }
    const m = /^\$?([A-Z]+)\$?(\d+)/.exec(body);
    if (!m) return null;
    const col = colLettersToNum(m[1]);
    const row = parseInt(m[2], 10);
    out += formatCellForConcat(sheet.getRow(row).getCell(col));
    body = body.slice(m[0].length).trimStart();
  }
  return out;
}

function formatCellForConcat(cell: ExcelJS.Cell): string {
  const v = cell.value;
  let n: number | null = null;
  let s: string | null = null;
  if (typeof v === "number") n = v;
  else if (typeof v === "string") s = v;
  else if (v && typeof v === "object" && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "number") n = r;
    else if (typeof r === "string") s = r;
  }
  if (s !== null) return s;
  if (n === null) return "";

  const fmt = String(cell.numFmt ?? "").toLowerCase();
  if (fmt.includes("%")) {
    return `${(n * 100).toFixed(1)}%`;
  }
  if (fmt.includes("$") || fmt.includes("currency") || fmt.includes("[$")) {
    const sign = n < 0 ? "-" : "";
    const abs = Math.round(Math.abs(n));
    return `${sign}$${abs.toLocaleString("en-US")}`;
  }
  if (fmt.includes("0.00")) return (Math.round(n * 100) / 100).toFixed(2);
  if (fmt.includes("0.0")) return (Math.round(n * 10) / 10).toFixed(1);
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return (Math.round(n * 10) / 10).toFixed(1);
}

function colLettersToNum(letters: string): number {
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n;
}

// Build every plausible string representation of a dollar value so we
// can find whichever format the auditor used in the conclusion prose.
function dollarFormats(n: number): string[] {
  const abs = Math.abs(n);
  const rounded = Math.round(abs);
  const sign = n < 0 ? "-" : "";
  const withCommas = rounded.toLocaleString("en-US");
  const withCommasOneDec = (Math.round(abs * 10) / 10).toLocaleString("en-US", {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
  const withCommasTwoDec = (Math.round(abs * 100) / 100).toLocaleString(
    "en-US",
    { minimumFractionDigits: 2, maximumFractionDigits: 2 },
  );
  // Order matters — longer/more specific forms come first so a regex
  // alternation doesn't gobble a shorter prefix.
  return [
    `${sign}$${withCommasTwoDec}`,
    `${sign}$${withCommasOneDec}`,
    `${sign}$${withCommas}`,
  ];
}

function substituteDollarMetric(
  text: string,
  pyVal: number | undefined,
  cyVal: number | undefined,
): string {
  if (pyVal == null || cyVal == null) return text;
  if (Math.round(pyVal) === Math.round(cyVal)) return text;
  const cyText = `$${Math.round(Math.abs(cyVal)).toLocaleString("en-US")}`;
  const cyOut = cyVal < 0 ? `-${cyText}` : cyText;
  let out = text;
  for (const form of dollarFormats(pyVal)) {
    if (out.includes(form)) {
      out = out.split(form).join(cyOut);
    }
  }
  return out;
}

function substituteDaysMetric(
  text: string,
  pyVal: number | undefined,
  cyVal: number | undefined,
): string {
  if (pyVal == null || cyVal == null) return text;
  const cyFormatted = (Math.round(cyVal * 10) / 10).toFixed(1);
  const pyOneDec = (Math.round(pyVal * 10) / 10).toFixed(1);
  const pyInt = String(Math.round(pyVal));
  let out = text;
  // "XX.X days" or "XX days" forms.
  const oneDecRe = new RegExp(`\\b${escapeRe(pyOneDec)}\\s*days\\b`, "g");
  out = out.replace(oneDecRe, `${cyFormatted} days`);
  if (pyOneDec !== `${pyInt}.0`) {
    const intRe = new RegExp(`\\b${escapeRe(pyInt)}\\s*days\\b`, "g");
    out = out.replace(intRe, `${cyFormatted} days`);
  }
  return out;
}

function substituteVarianceMetric(
  text: string,
  pyVal: number | undefined,
  cyVal: number | undefined,
): string {
  if (pyVal == null || cyVal == null) return text;
  const cyFormatted = (Math.round(cyVal * 10) / 10).toFixed(1);
  const pyOneDec = (Math.round(pyVal * 10) / 10).toFixed(1);
  // Variances appear with a leading sign: "+4.4 days" or "-2.1 days".
  const signs = ["+", "-", "±", ""];
  let out = text;
  for (const s of signs) {
    const pat = new RegExp(
      `${escapeRe(s)}${escapeRe(pyOneDec.replace(/^-/, ""))}\\s*days?\\b`,
      "g",
    );
    const cyAbs = Math.abs(cyVal);
    const cyAbsFormatted = (Math.round(cyAbs * 10) / 10).toFixed(1);
    const cySign = cyVal < 0 ? "-" : s === "" ? "" : "+";
    out = out.replace(pat, `${cySign}${cyAbsFormatted} days`);
    if (out !== text) return out;
  }
  // Fallback: bare number replacement, no sign.
  return out.replace(
    new RegExp(`\\b${escapeRe(pyOneDec)}\\b`, "g"),
    cyFormatted,
  );
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
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
  let allowance = 0;
  // DSO workpapers test Trade AR specifically. Bucket the AR-family
  // accounts as we go and prefer the explicitly-Trade ones; fall back
  // to whatever other AR exists only when no Trade/control account is
  // present (engagements that have a single "Accounts Receivable"
  // line).
  const tradeAccounts: typeof tb.accounts = [];
  const otherArAccounts: typeof tb.accounts = [];
  for (const a of tb.accounts) {
    if (a.section === "Revenue") revenue += a.cyBalance;
    if (/allowance(\s+for)?\s+doubtful/i.test(a.name)) {
      allowance += a.cyBalance;
      continue;
    }
    if (
      !/accounts?\s+receivable|trade\s+receivables?|^a\/r$|^ar$/i.test(a.name)
    ) {
      continue;
    }
    if (/\btrade\b|\bcontrol\b/i.test(a.name)) {
      tradeAccounts.push(a);
    } else {
      otherArAccounts.push(a);
    }
  }
  const arSource =
    tradeAccounts.length > 0 ? tradeAccounts : otherArAccounts;
  const grossAr = arSource.reduce((s, a) => s + a.cyBalance, 0);
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
