import ExcelJS from "exceljs";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { exportEngagement } from "@/lib/engagement-repo";
import {
  loadArAgingForEngagement,
  loadSubsequentCashReceiptsForEngagement,
  loadTrialBalanceForEngagement,
} from "@/lib/intake/load-canonical";
import type { ArAging } from "@/lib/ar-aging-parser";
import type { TrialBalance } from "@/lib/tb-parser";
import {
  getPyWorkpaper,
  setPyWorkpaperGeneratedCy,
} from "@/lib/py-workpaper-repo";
import { regenerateAltProceduresSelections } from "@/lib/alt-procedures-rollforward";
import { rolloverDsoWorkpaper } from "@/lib/dso-workpaper-rollforward";
import { rolloverLeadSheets } from "@/lib/lead-sheet-rollforward";
import { rolloverMethodologyTabs } from "@/lib/methodology-rollforward";
import {
  writeProcedureBoxes,
  hasExistingProcedureBox,
} from "@/lib/procedure-boxes";
import { generateAssertionMatrix } from "@/lib/assertion-matrix-generator";
import type { AssertionMatrix } from "@/lib/assertion-matrix";
import { rolloverTestingSummaryMemo } from "@/lib/testing-memo-rollforward";
import { loadWorkpaperSettings } from "@/lib/workpaper-settings";
import {
  defaultMethodology,
  runSampling,
  type SampleResult,
} from "@/lib/sampling-methodologies";
import { findFsli } from "@/lib/workpaper-binder";

// Roll a prior-year workpaper forward to a current-year counterpart.
//
// Per header row, we detect which "mode" the workpaper is in:
//
//  - TEMPLATE mode: the row already has a column labelled with the CY
//    year (e.g. the auditor has "FY 2023 $ | FY 2024 $" set up). No
//    label/data shifting is needed — we just fill the CY column with
//    fresh data and leave everything else alone.
//
//  - ROLLFORWARD mode: the row's highest year is CY - 1 (e.g. the file
//    is a true prior-audit workpaper labelled "FY 2022 | FY 2023"). We
//    shift every year-label +1, slide each column's data one slot left
//    (so the column relabeled "FY 2023" now holds what was under the
//    original "FY 2023" column), and fill the new rightmost column
//    (now labelled with CY) with fresh data. Formulas being moved have
//    their column references updated to match.
//
// "Fresh" data:
//   - Aging tables (rows labelled Current / 1-30 / etc.) → canonical CY
//     AR Aging totals.
//   - Trend tables (rows labelled Revenue / AR / DSO / Industry) → CY
//     trial-balance figures (DSO is written as a formula).
//
// Narrative dates (12/31/2023, 1/15/2024, "January 2024") roll +1 year
// only in rollforward mode — in template mode the dates are already
// current.

export type CyGenerationResult = {
  buffer: Buffer;
  filename: string;
  storagePath: string;
  patchCount: number;
};

export async function generateCyWorkpaperById(
  pyWorkpaperId: string,
): Promise<CyGenerationResult> {
  const ref = await getPyWorkpaper(pyWorkpaperId);
  if (!ref) throw new Error(`PY workpaper ${pyWorkpaperId} not found`);
  const { engagementId, wp } = ref;

  const engagement = await exportEngagement(engagementId);
  const trialBalance = await loadTrialBalanceForEngagement(engagementId);
  const arAging = /accounts\s+receivable/i.test(wp.fsli ?? "")
    ? await loadArAgingForEngagement(engagementId)
    : null;
  const scr = /accounts\s+receivable/i.test(wp.fsli ?? "")
    ? await loadSubsequentCashReceiptsForEngagement(engagementId)
    : null;

  // For AR-related workpapers that rely on a sample (alt procedures,
  // confirmations), run the engagement's configured Existence sampling
  // methodology against the CY aging so the rollforward picks the same
  // customers an account-workpaper regeneration would.
  const existenceSample = await loadExistenceSampleForFsli({
    fsli: wp.fsli,
    engagementId,
    aging: arAging,
    trialBalance,
    performanceMateriality:
      engagement.materiality.performanceMateriality,
  });

  const sb = getServerSupabase();
  const dl = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(wp.storagePath);
  if (dl.error || !dl.data) {
    throw new Error(
      `CY generation: PY download failed: ${dl.error?.message ?? "no data"}`,
    );
  }
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(Buffer.from(await dl.data.arrayBuffer()) as any);

  const cyYear = parseInt(engagement.client.fiscalYearEnd.slice(0, 4), 10);

  // Bullet-proof DSO-workpaper rollover. Runs BEFORE the generic
  // year-column engine and claims any DSO sheet by name. The generic
  // engine then skips claimed sheets so it can't wipe the labels or
  // misclassify the DSO computation table as a trend table.
  const dsoResult = rolloverDsoWorkpaper(wb, trialBalance, arAging);

  // Lead-sheet rollover: refresh Per G/L + Per Audit dollar columns
  // from the CY TB and recompute the bold net SUM. Detected by
  // column-header signature (Account / Per G/L / Per Audit /
  // Difference) so it works on any tab named for the FSLI.
  const leadSheetResult = rolloverLeadSheets(wb, trialBalance);

  // Methodology + Results tabs: refresh in-line $ values for the three
  // materiality lines (OM/PM/CTT) and TB-driven population figures.
  const methodologyResult = rolloverMethodologyTabs(wb, {
    engagement,
    trialBalance,
    arAging,
  });

  // Process year-labelled columns. Returns total cell-updates + per-row
  // mode info so we know whether to shift narrative dates afterwards.
  const { count: colShiftCount, anyRollforward } = processYearColumns(wb, {
    cyYear,
    aging: arAging,
    trialBalance,
    skipSheets: dsoResult.handledSheets,
  });

  // Roll narrative dates +1 year. Always run — even template-mode files
  // typically have residual PY-period references ("FY 2023 Audit",
  // "12/31/2023") in their banners and footnotes that need rolling.
  const dateShiftCount = shiftNarrativeDates(wb, cyYear);

  // Rewrite analytic-conclusion paragraphs to reference the table data
  // above them — so the prose stays in sync with the rolled-forward
  // numbers instead of carrying PY values verbatim.
  const rewroteConclusions = rewriteConclusionsAsFormulas(
    wb,
    cyYear,
    dsoResult.handledSheets,
  );

  // Post-pass: now that conclusion cells are formulas, swap any
  // remaining hardcoded year labels (FY22/FY23) for the rolled short-
  // form labels (FY23/FY24) and recompute the YoY% from the new PY/CY
  // values referenced by the formula. Preserves the auditor's narrative
  // and the numeric refs (D9/E9/F9).
  const conclusionFormulaCount = updateConclusionFormulaRefs(
    wb,
    cyYear,
    dsoResult.handledSheets,
  );

  // Rewrite the aging-conclusion paragraph in place — replace the
  // stale PY $/% literals and the wrongly-targeted `&Fnn&` refs with
  // the fresh PY/CY values from each bucket row.
  const agingConclusionCount = updateAgingConclusionRefs(
    wb,
    cyYear,
    dsoResult.handledSheets,
  );

  // Lazy-load the assertion matrix only if this workpaper might need
  // a procedure box added (PY didn't author one). Matrix generation
  // calls Claude, so we skip the cost when the PY already has its own
  // procedure language.
  const matrix = await maybeLoadMatrixForProcedureBoxes(wb, engagementId);

  // Replace PY selections in Alternative-Procedures-style workpapers
  // with fresh CY selections. Selections come from the engagement's
  // configured Existence sampling methodology (independent of SCR
  // availability), then each is traced into SCR for evidence.
  const altProcCount = regenerateAltProceduresSelections(
    wb,
    scr,
    arAging,
    existenceSample,
    matrix,
  );

  // Patch the AR Testing Summary Memo's PY-baked values (CY/PY balance,
  // SCR collected + coverage %, confirmation customer count) using
  // fresh CY data. Other PY-specific text (invoice IDs, allowance
  // figures) is left as-is — those need CY workpapers to drive them.
  const testingMemoPatchCount = rolloverTestingSummaryMemo(
    wb,
    matrix,
    arAging,
    scr,
    existenceSample,
  );

  // Stamp a TESTING PROCEDURE box on workpapers that don't already
  // have one. Procedure text leads with the scoping rationale from the
  // assertion matrix when available, then elaborates with workpaper-
  // type-specific details.
  writeProcedureBoxes(wb, matrix);

  // Final pass: round every numeric cell (and every formula's cached
  // result) to 2 decimal places. Catches the long fractional noise
  // that comes out of formulas like ROUND(C14/C13*365,1) →
  // 51.50281531531532 and percentages like 0.18914604948 →
  // displays as 18.9% but stored with 12 digits of noise.
  roundLongDecimals(wb);

  const conclusionCount =
    rewroteConclusions +
    conclusionFormulaCount +
    agingConclusionCount +
    altProcCount;

  // (No fill manipulation — leaving cell colors as-is. Column A coloring
  // can be cleaned up manually in Excel.)

  const buffer = Buffer.from(await wb.xlsx.writeBuffer());

  const safeBase = wp.originalFilename.replace(/\.[a-z0-9]+$/i, "");
  const cyFilename = `${safeBase}_CY${cyYear}.xlsx`;
  const storagePath = `engagements/${engagementId}/py-workpapers/${wp.id}-cy-${Date.now()}-${cyFilename}`;
  const { error: upErr } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(storagePath, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: false,
    });
  if (upErr) throw new Error(`CY upload failed: ${upErr.message}`);
  await setPyWorkpaperGeneratedCy(wp.id, storagePath);

  // eslint-disable-next-line no-console
  console.log(
    `[CY rollforward] cyYear=${cyYear} file=${wp.originalFilename} ` +
      `colShift=${colShiftCount} dateShift=${dateShiftCount} ` +
      `conclusion=${conclusionCount}`,
  );

  return {
    buffer,
    filename: cyFilename,
    storagePath,
    patchCount: colShiftCount + dateShiftCount + conclusionCount,
  };
}

// ---------------------------------------------------------------------------
// Conclusion paragraph rewrite — replace embedded numbers with formula
// references to the matching cells in the table above.
// ---------------------------------------------------------------------------

function rewriteConclusionsAsFormulas(
  wb: ExcelJS.Workbook,
  cyYear: number,
  skipSheets?: Set<string>,
): number {
  let count = 0;
  for (const sheet of wb.worksheets) {
    if (skipSheets?.has(sheet.name)) continue;
    for (let r = 1; r <= sheet.rowCount; r++) {
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getRow(r).getCell(c);
        const rawText = getCellPlainText(cell);
        if (!rawText || rawText.length < 40) continue;
        if (!/\bconclusion\b/i.test(rawText)) continue;

        // Shift year references in the text BEFORE building the
        // formula — handles rich-text cells that shiftNarrativeDates
        // didn't touch, and ensures the quoted string parts of the
        // formula carry the rolled year labels (FY 2022 → FY 2023,
        // FY 2023 → FY 2024).
        const text = shiftDatesInString(rawText, cyYear);

        const valueIndex = buildValueIndex(sheet, r);
        const formula = numbersInTextToCellRefs(text, valueIndex);
        if (formula) {
          cell.value = { formula, result: text } as ExcelJS.CellValue;
          count += 1;
        }
      }
    }
  }
  return count;
}

// Returns the plain-text content of a cell, including rich-text runs.
function getCellPlainText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (
    v &&
    typeof v === "object" &&
    "richText" in v &&
    Array.isArray((v as { richText: unknown }).richText)
  ) {
    return (v as { richText: { text?: string }[] }).richText
      .map((rt) => rt.text ?? "")
      .join("");
  }
  if (v && typeof v === "object" && "text" in v) {
    const t = (v as { text: unknown }).text;
    if (typeof t === "string") return t;
  }
  return "";
}

// Builds a map of "displayed-number-string → A1 cell address" using all
// cells ABOVE rowLimit on the same sheet. Each numeric cell contributes
// several formatted variations (1247400 / 1,247,400 / $1,247,400 / 74.4
// / 74 / 68.1% / (8,100) etc.) so we can match however the conclusion
// text spells it out. Earlier-row/earlier-col cells win when the same
// string maps to multiple addresses (so the leftmost PY column gets
// priority over CY for ambiguous ties — but in practice the conclusion
// will mention each value only once with distinct formatting).
function buildValueIndex(
  sheet: ExcelJS.Worksheet,
  rowLimit: number,
): Map<string, string> {
  // First scan all rows above rowLimit for year-column headers.
  // For each header row we map column → year and year → column, so we
  // can later shift any reference up by one year (PY auditor's PY value
  // → new PY auditor's CY value).
  const colByYearByHeader = new Map<number, Map<number, number>>();
  const yearByColByHeader = new Map<number, Map<number, number>>();
  for (let r = 1; r < rowLimit; r++) {
    const row = sheet.getRow(r);
    let rowHadAny = false;
    const colToYear = new Map<number, number>();
    const yearToCol = new Map<number, number>();
    for (let c = 1; c <= sheet.columnCount; c++) {
      const text = readCellText(row.getCell(c)).trim();
      if (!text || text.length > 50) continue;
      const yearMatches = [...text.matchAll(/\b(20\d{2})\b/g)];
      if (yearMatches.length !== 1) continue;
      const year = parseInt(yearMatches[0][0], 10);
      const hasYearLabel =
        /(fy|cy|py|fiscal\s+year|prior\s+year|current\s+year|q[1-4])/i.test(
          text,
        );
      const isShortLabel = text.length <= 20;
      if (!hasYearLabel && !isShortLabel) continue;
      colToYear.set(c, year);
      yearToCol.set(year, c);
      rowHadAny = true;
    }
    if (rowHadAny) {
      colByYearByHeader.set(r, yearToCol);
      yearByColByHeader.set(r, colToYear);
    }
  }
  const sortedHeaderRows = [...colByYearByHeader.keys()].sort((a, b) => a - b);

  // Find the year+1 target column for a data cell at (r, c) — used to
  // shift the conclusion's number references forward by one year.
  function shiftedTargetCol(r: number, c: number): number | null {
    let nearest: number | null = null;
    for (const hr of sortedHeaderRows) {
      if (hr < r) nearest = hr;
      else break;
    }
    if (nearest === null) return null;
    const year = yearByColByHeader.get(nearest)?.get(c);
    if (year === undefined) return null;
    return colByYearByHeader.get(nearest)?.get(year + 1) ?? null;
  }

  const map = new Map<string, string>();
  for (let r = 1; r < rowLimit; r++) {
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = sheet.getRow(r).getCell(c);
      const num = readNumberValue(cell.value);
      if (num === null) continue;
      // If this cell lives in a year column with a year+1 column also
      // present in the same header row, point the value at the year+1
      // cell instead. So "74.4" (originally FY 2022 DSO) resolves to
      // the FY 2023 cell, and "77.7" (originally FY 2023 DSO) resolves
      // to the FY 2024 cell — yielding the new PY-vs-CY comparison.
      const target = shiftedTargetCol(r, c) ?? c;
      const addr = `${colNumToLetter(target)}${r}`;
      for (const v of numberDisplayVariations(num)) {
        if (!map.has(v)) map.set(v, addr);
      }
    }
  }
  return map;
}

function numberDisplayVariations(n: number): string[] {
  const out = new Set<string>();
  const abs = Math.abs(n);
  out.add(n.toString());
  out.add(abs.toFixed(0));
  out.add(abs.toFixed(1));
  out.add(abs.toFixed(2));
  out.add(addCommas(abs.toFixed(0)));
  out.add(addCommas(abs.toFixed(1)));
  out.add(addCommas(abs.toFixed(2)));
  out.add(`$${addCommas(abs.toFixed(0))}`);
  out.add(`$${addCommas(abs.toFixed(2))}`);
  if (abs <= 1.0001) {
    // Treat as a fraction → percentage
    out.add(`${(abs * 100).toFixed(0)}%`);
    out.add(`${(abs * 100).toFixed(1)}%`);
    out.add(`${(abs * 100).toFixed(2)}%`);
  }
  // Percent stored as 0-100 (without the *100 step)
  out.add(`${abs.toFixed(0)}%`);
  out.add(`${abs.toFixed(1)}%`);
  if (n < 0) {
    out.add(`(${addCommas(abs.toFixed(0))})`);
    out.add(`(${addCommas(abs.toFixed(2))})`);
    out.add(`-${addCommas(abs.toFixed(0))}`);
  }
  return [...out];
}

function addCommas(numStr: string): string {
  const [intPart, decPart] = numStr.split(".");
  const withCommas = intPart.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return decPart === undefined ? withCommas : `${withCommas}.${decPart}`;
}

function readNumberValue(v: ExcelJS.CellValue): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (v && typeof v === "object" && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "number" && Number.isFinite(r)) return r;
  }
  return null;
}

// Scans the conclusion text for numeric patterns, looks each one up in
// the value index, and rebuilds the cell as a CONCAT formula with the
// matching cell references spliced in. Returns null if no replacements
// were found (cell stays as plain text).
function numbersInTextToCellRefs(
  text: string,
  valueIndex: Map<string, string>,
): string | null {
  // Patterns ordered most-specific first so longer matches win.
  const numberRe = new RegExp(
    [
      "\\$\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?", // $1,247,400 (with commas)
      "\\$\\d+(?:\\.\\d+)?", // $74.40
      "\\(\\d{1,3}(?:,\\d{3})*(?:\\.\\d+)?\\)", // (8,100) negative
      "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?%", // 1,247.5%
      "\\d{1,3}(?:,\\d{3})+(?:\\.\\d+)?", // 1,247,400
      "\\d+\\.\\d+%", // 68.1%
      "\\d+\\.\\d+", // 74.4
      "\\d+%", // 72%
    ].join("|"),
    "g",
  );

  type Hit = { idx: number; len: number; addr: string; src: string };
  const hits: Hit[] = [];
  let m: RegExpExecArray | null;
  while ((m = numberRe.exec(text)) !== null) {
    const raw = m[0];
    // Skip year-like 4-digit numbers (e.g. "2024" in "FY 2024") so we
    // don't try to point them at random cells.
    if (/^(?:19|20)\d{2}$/.test(raw)) continue;
    // Skip dates (M/D/YYYY would be caught earlier but be safe)
    const addr = valueIndex.get(raw);
    if (!addr) continue;
    hits.push({ idx: m.index, len: raw.length, addr, src: raw });
  }
  if (hits.length === 0) return null;

  // Build the formula by stitching text fragments and cell refs.
  const parts: string[] = [];
  let cursor = 0;
  for (const hit of hits) {
    if (hit.idx > cursor) {
      parts.push(quoteForFormula(text.slice(cursor, hit.idx)));
    }
    parts.push(hit.addr);
    cursor = hit.idx + hit.len;
  }
  if (cursor < text.length) {
    parts.push(quoteForFormula(text.slice(cursor)));
  }
  return parts.filter((p) => p !== `""`).join("&");
}

function quoteForFormula(s: string): string {
  return `"${s.replace(/"/g, '""')}"`;
}

// ---------------------------------------------------------------------------
// Year-column processing — template vs. rollforward mode per header row.
// ---------------------------------------------------------------------------

type YearCellInfo = {
  row: number;
  col: number;
  year: number;
  type: string;
  originalText: string;
};

type ProcessOptions = {
  cyYear: number;
  aging: ArAging | null;
  trialBalance: TrialBalance | null;
  skipSheets?: Set<string>;
};

function processYearColumns(
  wb: ExcelJS.Workbook,
  opts: ProcessOptions,
): { count: number; anyRollforward: boolean } {
  let count = 0;
  let anyRollforward = false;

  for (const sheet of wb.worksheets) {
    if (opts.skipSheets?.has(sheet.name)) continue;
    const yearCells = findYearHeaderCells(sheet);
    if (yearCells.length === 0) continue;

    // Group by row → each header row is processed independently.
    const cellsByRow = new Map<number, YearCellInfo[]>();
    for (const cell of yearCells) {
      const arr = cellsByRow.get(cell.row) ?? [];
      arr.push(cell);
      cellsByRow.set(cell.row, arr);
    }
    const headerRowsAsc = [...cellsByRow.keys()].sort((a, b) => a - b);

    for (const headerRow of headerRowsAsc) {
      const rowCells = cellsByRow.get(headerRow)!;

      // Data rows: from row after this header to row before next header
      // (or end of sheet). Only rows whose year-column cells hold a
      // numeric (or formula-with-numeric-result) value count.
      const nextHeaderRow =
        headerRowsAsc.find((r) => r > headerRow) ?? sheet.rowCount + 1;
      const dataRows: number[] = [];
      for (let r = headerRow + 1; r < nextHeaderRow; r++) {
        if (rowHasNumericCell(sheet, r, rowCells)) {
          dataRows.push(r);
        }
      }

      // Decide mode for this row.
      const hasCyCol = rowCells.some((c) => c.year === opts.cyYear);
      if (hasCyCol) {
        // TEMPLATE mode — fill CY column(s) with fresh data, nothing else.
        const cyCells = rowCells.filter((c) => c.year === opts.cyYear);
        count += fillFreshData(sheet, cyCells, dataRows, opts);
      } else {
        anyRollforward = true;
        count += rollforwardRow(sheet, rowCells, dataRows, opts);
      }

      // After value-fills, write every aging-table % cell as a formula
      // tied to its matching $ column (same year). Both PY and CY %
      // cells get formulas so they always foot to the $ column.
      count += applyPercentageFormulas(sheet, headerRow, dataRows);

      // Make the DSO row formula-driven across EVERY year column —
      // not just the fresh CY column — so PY year columns also show
      // =ROUND(AR/Revenue*365, 1).
      count += applyDsoRowFormulas(sheet, headerRow, dataRows);
    }
  }

  return { count, anyRollforward };
}

function findYearHeaderCells(sheet: ExcelJS.Worksheet): YearCellInfo[] {
  const cells: YearCellInfo[] = [];
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= sheet.columnCount; c++) {
      const text = readCellText(row.getCell(c)).trim();
      if (!text || text.length > 50) continue;
      const yearMatches = [...text.matchAll(/\b(20\d{2})\b/g)];
      if (yearMatches.length !== 1) continue;
      const year = parseInt(yearMatches[0][0], 10);
      const hasYearLabel =
        /(fy|cy|py|fiscal\s+year|prior\s+year|current\s+year|q[1-4])/i.test(
          text,
        );
      const isShortLabel = text.length <= 20;
      if (!hasYearLabel && !isShortLabel) continue;
      const type = text.replace(/\b20\d{2}\b/, "").replace(/\s+/g, " ").trim();
      cells.push({ row: r, col: c, year, type, originalText: text });
    }
  }
  return cells;
}

function rowHasNumericCell(
  sheet: ExcelJS.Worksheet,
  r: number,
  yearCells: YearCellInfo[],
): boolean {
  for (const yc of yearCells) {
    const v = sheet.getRow(r).getCell(yc.col).value;
    if (typeof v === "number") return true;
    if (v && typeof v === "object" && "result" in v) {
      const result = (v as { result: unknown }).result;
      if (typeof result === "number") return true;
    }
    // A cell holding a formula but no cached result is still a data cell.
    if (v && typeof v === "object" && "formula" in v) return true;
  }
  return false;
}

// ---------------------------------------------------------------------------
// ROLLFORWARD mode: shift labels +1, slide data left, fill new CY col.
// ---------------------------------------------------------------------------

function rollforwardRow(
  sheet: ExcelJS.Worksheet,
  rowCells: YearCellInfo[],
  dataRows: number[],
  opts: ProcessOptions,
): number {
  let count = 0;

  // Capture each year column's values + formulas BEFORE any rewrite.
  const captured = new Map<number, Map<number, ExcelJS.CellValue>>();
  for (const yc of rowCells) {
    const rowMap = new Map<number, ExcelJS.CellValue>();
    for (const r of dataRows) {
      rowMap.set(r, sheet.getRow(r).getCell(yc.col).value);
    }
    captured.set(yc.col, rowMap);
  }

  // Build the formula-letter-shift map. Each year-col letter remaps to
  // the same column letter (since columns themselves don't move; only
  // their *data* slides left, and the new home of each column's data
  // is the column whose letter is one less in the alpha-by-col sense).
  // For formulas being copied from src→dst, source-letter→dst-letter is
  // the substitution we need.
  // We'll build this per source col below.

  // Group cells by type → sort each type by year ascending.
  const cellsByType = new Map<string, YearCellInfo[]>();
  for (const cell of rowCells) {
    const arr = cellsByType.get(cell.type) ?? [];
    arr.push(cell);
    cellsByType.set(cell.type, arr);
  }
  for (const arr of cellsByType.values()) {
    arr.sort((a, b) => a.year - b.year);
  }

  const cellsNeedingFresh: YearCellInfo[] = [];

  for (const [, cellsOfType] of cellsByType) {
    const maxYear = cellsOfType[cellsOfType.length - 1].year;
    for (const cell of cellsOfType) {
      // Shift the header label +1 year.
      const newLabel = cell.originalText.replace(
        /\b20\d{2}\b/,
        String(cell.year + 1),
      );
      sheet.getRow(cell.row).getCell(cell.col).value = newLabel;
      count += 1;

      // Find the same-type cell with year N+1.
      const nextCell = cellsOfType.find((c) => c.year === cell.year + 1);
      if (nextCell) {
        const sourceData = captured.get(nextCell.col);
        if (sourceData) {
          const letterMap = new Map<string, string>([
            [colNumToLetter(nextCell.col), colNumToLetter(cell.col)],
          ]);
          for (const [r, v] of sourceData) {
            sheet.getRow(r).getCell(cell.col).value = remapCellValue(
              v,
              letterMap,
            );
            count += 1;
          }
        }
      } else if (cell.year === maxYear) {
        // Clear the cell range so stale data doesn't carry into the
        // new CY column. Fresh data is filled below.
        for (const r of dataRows) {
          sheet.getRow(r).getCell(cell.col).value = null;
        }
        // After label shift, this cell now represents (maxYear + 1).
        // If that equals the engagement CY, it's the new CY column.
        cellsNeedingFresh.push({
          ...cell,
          year: cell.year + 1,
          originalText: newLabel,
        });
      }
    }
  }

  count += fillFreshData(sheet, cellsNeedingFresh, dataRows, opts);
  return count;
}

// ---------------------------------------------------------------------------
// Fresh-data fill — used by both TEMPLATE and ROLLFORWARD modes.
// ---------------------------------------------------------------------------

function fillFreshData(
  sheet: ExcelJS.Worksheet,
  freshCells: YearCellInfo[],
  dataRows: number[],
  opts: ProcessOptions,
): number {
  if (dataRows.length === 0 || freshCells.length === 0) return 0;

  // Identify the label column for this table (where the row labels
  // live). Take the leftmost column whose values produce the most
  // recognized row-type matches.
  const labelCol = findLabelColumn(sheet, dataRows);
  if (labelCol === -1) return 0;

  // For each data row, classify its label.
  type RowKind =
    | { kind: "aging"; bucket: AgingBucketKey }
    | { kind: "trend"; metric: TrendMetric };
  const rowKinds = new Map<number, RowKind>();
  for (const r of dataRows) {
    const label = readCellText(sheet.getRow(r).getCell(labelCol)).trim();
    const bucket = matchAgingBucket(label);
    if (bucket) {
      rowKinds.set(r, { kind: "aging", bucket });
      continue;
    }
    const metric = matchTrendMetric(label);
    if (metric) {
      rowKinds.set(r, { kind: "trend", metric });
    }
  }
  if (rowKinds.size === 0) return 0;

  // Pre-compute the values we might need.
  const agingTotals = opts.aging ? computeAgingTotals(opts.aging) : null;
  const trendValues = opts.trialBalance
    ? computeTrendValues(opts.trialBalance)
    : null;

  // Bucket data rows (non-Total) — used to build the $ Total SUM formula.
  const bucketDataRows = [...rowKinds.entries()]
    .filter(
      ([, k]) =>
        k.kind === "aging" && k.bucket !== "total" && k.bucket !== "credits",
    )
    .map(([r]) => r);
  // Include "credits" in SUM range so net AR ties to TB (credits is negative).
  const creditsRows = [...rowKinds.entries()]
    .filter(([, k]) => k.kind === "aging" && k.bucket === "credits")
    .map(([r]) => r);
  const sumRangeRows = [...bucketDataRows, ...creditsRows];

  let count = 0;
  for (const fresh of freshCells) {
    const isPct = /(%|percent)/i.test(fresh.type);
    // % cells are handled by applyPercentageFormulas; skip here.
    if (isPct) continue;
    for (const [r, kind] of rowKinds) {
      const cell = sheet.getRow(r).getCell(fresh.col);
      if (kind.kind === "aging" && agingTotals) {
        if (kind.bucket === "total") {
          // SUM formula over the bucket rows (incl. credits) so the
          // total foots to net AR.
          if (sumRangeRows.length > 0) {
            const colL = colNumToLetter(fresh.col);
            const minR = Math.min(...sumRangeRows);
            const maxR = Math.max(...sumRangeRows);
            cell.value = {
              formula: `SUM(${colL}${minR}:${colL}${maxR})`,
              result: agingTotals.byBucket.total,
            };
            count += 1;
          } else {
            cell.value = agingTotals.byBucket.total;
            count += 1;
          }
        } else {
          cell.value = agingTotals.byBucket[kind.bucket];
          count += 1;
        }
      } else if (kind.kind === "trend" && trendValues) {
        if (kind.metric === "dso") {
          // Prefer gross AR row → net AR → plain AR for the numerator
          // so the DSO formula matches whatever the workpaper labels.
          const grossArRow = findMetricRow(rowKinds, "grossAr");
          const netArRow = findMetricRow(rowKinds, "netAr");
          const plainArRow = findMetricRow(rowKinds, "ar");
          const arRow = grossArRow ?? netArRow ?? plainArRow;
          const arVal =
            grossArRow != null
              ? trendValues.grossAr
              : netArRow != null
                ? trendValues.netAr
                : trendValues.ar;
          const revRow = findMetricRow(rowKinds, "revenue");
          if (arRow && revRow) {
            const colL = colNumToLetter(fresh.col);
            const rawDso =
              trendValues.revenue === 0
                ? 0
                : (arVal / trendValues.revenue) * 365;
            cell.value = {
              formula: `ROUND(${colL}${arRow}/${colL}${revRow}*365,1)`,
              result: Math.round(rawDso * 10) / 10,
            };
            count += 1;
          }
        } else if (kind.metric === "revenue") {
          cell.value = trendValues.revenue;
          count += 1;
        } else if (kind.metric === "grossAr") {
          cell.value = trendValues.grossAr;
          count += 1;
        } else if (kind.metric === "allowance") {
          cell.value = trendValues.allowance;
          count += 1;
        } else if (kind.metric === "netAr") {
          // Write as gross + allowance formula when both rows are
          // present so the math stays auditable in the cell.
          const grossArRow = findMetricRow(rowKinds, "grossAr");
          const allowanceRow = findMetricRow(rowKinds, "allowance");
          if (grossArRow != null && allowanceRow != null) {
            const colL = colNumToLetter(fresh.col);
            cell.value = {
              formula: `${colL}${grossArRow}+${colL}${allowanceRow}`,
              result: trendValues.netAr,
            };
          } else {
            cell.value = trendValues.netAr;
          }
          count += 1;
        } else if (kind.metric === "ar") {
          cell.value = trendValues.ar;
          count += 1;
        } else if (kind.metric === "industry") {
          // Industry benchmarks are typically static year-over-year —
          // carry forward by copying the nearest numeric value from a
          // column to the left of the fresh cell in this same row.
          for (let c = fresh.col - 1; c >= 1; c--) {
            const v = sheet.getRow(r).getCell(c).value;
            if (typeof v === "number") {
              cell.value = v;
              count += 1;
              break;
            }
            if (v && typeof v === "object" && "result" in v) {
              const result = (v as { result: unknown }).result;
              if (typeof result === "number") {
                cell.value = result;
                count += 1;
                break;
              }
            }
          }
        }
      }
    }
  }
  return count;
}

// For each aging-table % column in the header row, write a formula
// `=$col[row]/$col[totalRow]` referencing the matching $ column (same
// year). Runs AFTER fillFreshData / rollforwardRow so it sees the
// current (post-shift) header labels. Handles both PY and CY years.
function applyPercentageFormulas(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  dataRows: number[],
): number {
  // Re-scan year cells in this header row using their CURRENT labels.
  const yearCellsNow: YearCellInfo[] = [];
  const row = sheet.getRow(headerRow);
  for (let c = 1; c <= sheet.columnCount; c++) {
    const text = readCellText(row.getCell(c)).trim();
    if (!text || text.length > 50) continue;
    const yearMatches = [...text.matchAll(/\b(20\d{2})\b/g)];
    if (yearMatches.length !== 1) continue;
    const year = parseInt(yearMatches[0][0], 10);
    const hasYearLabel =
      /(fy|cy|py|fiscal\s+year|prior\s+year|current\s+year|q[1-4])/i.test(text);
    const isShortLabel = text.length <= 20;
    if (!hasYearLabel && !isShortLabel) continue;
    const type = text.replace(/\b20\d{2}\b/, "").replace(/\s+/g, " ").trim();
    yearCellsNow.push({ row: headerRow, col: c, year, type, originalText: text });
  }
  if (yearCellsNow.length === 0) return 0;

  // Group by year, picking the $ and % cell within each year.
  const groups = new Map<
    number,
    { dollarCol?: number; pctCol?: number }
  >();
  for (const cell of yearCellsNow) {
    const flavor = /(%|percent)/i.test(cell.type) ? "pct" : "dollar";
    const g = groups.get(cell.year) ?? {};
    if (flavor === "pct") g.pctCol = cell.col;
    else g.dollarCol = cell.col;
    groups.set(cell.year, g);
  }

  // Need the aging-table structure: a label column with bucket rows + a
  // total row.
  const labelCol = findLabelColumn(sheet, dataRows);
  if (labelCol === -1) return 0;

  let totalRow: number | null = null;
  const bucketRows: number[] = [];
  for (const r of dataRows) {
    const label = readCellText(sheet.getRow(r).getCell(labelCol)).trim();
    const bucket = matchAgingBucket(label);
    if (bucket === "total") totalRow = r;
    else if (bucket) bucketRows.push(r);
  }
  if (totalRow === null || bucketRows.length === 0) return 0;

  let count = 0;
  for (const [, group] of groups) {
    if (group.dollarCol === undefined || group.pctCol === undefined) continue;
    const dollarL = colNumToLetter(group.dollarCol);
    const pctL = colNumToLetter(group.pctCol);
    // % for each bucket row.
    for (const r of bucketRows) {
      sheet.getRow(r).getCell(group.pctCol).value = {
        formula: `${dollarL}${r}/${dollarL}${totalRow}`,
      };
      count += 1;
    }
    // % for the Total row: SUM of the bucket-row pct formulas (= 100%).
    const minR = Math.min(...bucketRows);
    const maxR = Math.max(...bucketRows);
    sheet.getRow(totalRow).getCell(group.pctCol).value = {
      formula: `SUM(${pctL}${minR}:${pctL}${maxR})`,
      result: 1,
    };
    count += 1;
  }
  return count;
}

function findLabelColumn(
  sheet: ExcelJS.Worksheet,
  dataRows: number[],
): number {
  let best = -1;
  let bestHits = 0;
  for (let c = 1; c <= sheet.columnCount; c++) {
    let hits = 0;
    for (const r of dataRows) {
      const label = readCellText(sheet.getRow(r).getCell(c)).trim();
      if (matchAgingBucket(label) || matchTrendMetric(label)) hits += 1;
    }
    if (hits > bestHits) {
      best = c;
      bestHits = hits;
    }
  }
  return best;
}

// In the DSO trend table, rewrite the DSO row in EVERY year column as
// =ROUND(AR_cell/Revenue_cell*365, 1) — so the DSO calc is uniform
// across PY and CY years, not hardcoded.
function applyDsoRowFormulas(
  sheet: ExcelJS.Worksheet,
  headerRow: number,
  dataRows: number[],
): number {
  // Re-scan year cells in this header row using current labels.
  const yearCellsNow: { col: number }[] = [];
  const row = sheet.getRow(headerRow);
  for (let c = 1; c <= sheet.columnCount; c++) {
    const text = readCellText(row.getCell(c)).trim();
    if (!text || text.length > 50) continue;
    const yearMatches = [...text.matchAll(/\b(20\d{2})\b/g)];
    if (yearMatches.length !== 1) continue;
    const hasYearLabel =
      /(fy|cy|py|fiscal\s+year|prior\s+year|current\s+year|q[1-4])/i.test(text);
    const isShortLabel = text.length <= 20;
    if (!hasYearLabel && !isShortLabel) continue;
    yearCellsNow.push({ col: c });
  }
  if (yearCellsNow.length === 0) return 0;

  // Find DSO / AR / Revenue rows.
  const labelCol = findLabelColumn(sheet, dataRows);
  if (labelCol === -1) return 0;
  let dsoRow: number | null = null;
  let arRow: number | null = null;
  let revRow: number | null = null;
  for (const r of dataRows) {
    const label = readCellText(sheet.getRow(r).getCell(labelCol)).trim();
    const metric = matchTrendMetric(label);
    if (metric === "dso") dsoRow = r;
    else if (metric === "ar") arRow = r;
    else if (metric === "revenue") revRow = r;
  }
  if (dsoRow === null || arRow === null || revRow === null) return 0;

  let count = 0;
  for (const yc of yearCellsNow) {
    const colL = colNumToLetter(yc.col);
    // Compute the cached result from the AR and Revenue values in this
    // column so downstream passes (e.g. conclusion text rewrite) can
    // see the DSO number via readNumberValue.
    const arVal =
      readNumberValue(sheet.getRow(arRow).getCell(yc.col).value) ?? 0;
    const revVal =
      readNumberValue(sheet.getRow(revRow).getCell(yc.col).value) ?? 0;
    const rawDso = revVal === 0 ? 0 : (arVal / revVal) * 365;
    sheet.getRow(dsoRow).getCell(yc.col).value = {
      formula: `ROUND(${colL}${arRow}/${colL}${revRow}*365,1)`,
      result: Math.round(rawDso * 10) / 10,
    };
    count += 1;
  }
  return count;
}

// ---------------------------------------------------------------------------
// Aging bucket helpers
// ---------------------------------------------------------------------------

type AgingBucketKey =
  | "current"
  | "d1_30"
  | "d31_60"
  | "d61_90"
  | "d90_plus"
  | "credits"
  | "total";

function matchAgingBucket(label: string): AgingBucketKey | null {
  const l = label.toLowerCase().trim();
  if (!l) return null;
  if (/^current\b/.test(l)) return "current";
  if (/^(0|1)\s*[-–to ]\s*30\b/.test(l)) return "d1_30";
  if (/^31\s*[-–to ]\s*60\b/.test(l)) return "d31_60";
  if (/^61\s*[-–to ]\s*90\b/.test(l)) return "d61_90";
  if (/^(90\s*\+|over\s*90|>\s*90|91\s*\+)/.test(l)) return "d90_plus";
  if (/^credit/.test(l)) return "credits";
  if (/^total\b/.test(l) && !/total\s+ar\s+by/.test(l)) return "total";
  return null;
}

function computeAgingTotals(aging: ArAging): {
  byBucket: Record<AgingBucketKey, number>;
  pctByBucket: Record<AgingBucketKey, number>;
} {
  const byBucket: Record<AgingBucketKey, number> = {
    current: 0,
    d1_30: 0,
    d31_60: 0,
    d61_90: 0,
    d90_plus: 0,
    credits: 0,
    total: aging.total,
  };
  for (const c of aging.customers) {
    byBucket.current += c.current;
    byBucket.d1_30 += c.d1_30;
    byBucket.d31_60 += c.d31_60;
    byBucket.d61_90 += c.d61_90;
    byBucket.d90_plus += c.d90_plus;
    byBucket.credits -= Math.abs(c.credits);
  }
  const pct = (n: number) => (aging.total === 0 ? 0 : n / aging.total);
  return {
    byBucket,
    pctByBucket: {
      current: pct(byBucket.current),
      d1_30: pct(byBucket.d1_30),
      d31_60: pct(byBucket.d31_60),
      d61_90: pct(byBucket.d61_90),
      d90_plus: pct(byBucket.d90_plus),
      credits: pct(byBucket.credits),
      total: 1,
    },
  };
}

// ---------------------------------------------------------------------------
// Trend metric helpers (Revenue, AR, DSO, Industry)
// ---------------------------------------------------------------------------

type TrendMetric =
  | "revenue"
  | "ar"
  | "grossAr"
  | "allowance"
  | "netAr"
  | "dso"
  | "industry";

function matchTrendMetric(label: string): TrendMetric | null {
  const l = label.toLowerCase().trim();
  if (!l) return null;
  // Order matters: more-specific patterns first.
  if (/^gross\s+(trade\s+receivables?|accounts?\s+receivable|ar|a\/r)\b/.test(l))
    return "grossAr";
  if (/allowance(\s+for)?\s+doubtful|less:?\s+allowance/.test(l))
    return "allowance";
  if (/^net\s+(trade\s+receivables?|accounts?\s+receivable|ar|a\/r)\b/.test(l))
    return "netAr";
  if (/^(net\s+|gross\s+)?(revenue|sales)\b/.test(l)) return "revenue";
  if (/^(ar|a\/r|accounts?\s+receivable|trade\s+receivables?)\b/.test(l))
    return "ar";
  if (/^dso\b/.test(l)) return "dso";
  if (/^(industry|benchmark)\b/.test(l)) return "industry";
  return null;
}

function computeTrendValues(tb: TrialBalance): {
  revenue: number;
  ar: number;
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
      allowance += a.cyBalance; // stored negative in TB
    } else if (
      /accounts?\s+receivable|trade\s+receivables?|^a\/r$|^ar$/i.test(a.name)
    ) {
      grossAr += a.cyBalance;
    }
  }
  // Revenue convention: TB stores revenue as negative (credit). Flip to
  // positive for display.
  if (revenue < 0) revenue = -revenue;
  const netAr = grossAr + allowance; // allowance is negative → subtraction
  return { revenue, ar: grossAr, grossAr, allowance, netAr };
}

function findMetricRow(
  rowKinds: Map<number, { kind: "aging" } | { kind: "trend"; metric: TrendMetric }>,
  metric: TrendMetric,
): number | null {
  for (const [r, k] of rowKinds) {
    if (k.kind === "trend" && k.metric === metric) return r;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Formula reference remapping — used when sliding column data left.
// ---------------------------------------------------------------------------

function remapCellValue(
  value: ExcelJS.CellValue,
  letterMap: Map<string, string>,
): ExcelJS.CellValue {
  if (
    value &&
    typeof value === "object" &&
    "formula" in value &&
    typeof (value as { formula: unknown }).formula === "string"
  ) {
    const original = (value as { formula: string }).formula;
    const updated = remapFormulaColumns(original, letterMap);
    return { ...value, formula: updated } as ExcelJS.CellValue;
  }
  return value;
}

function remapFormulaColumns(
  formula: string,
  letterMap: Map<string, string>,
): string {
  // Rewrite A1-style cell references whose column letter is in the map.
  return formula.replace(
    /(\$?)([A-Z]+)(\$?)(\d+)/g,
    (full, absCol: string, letter: string, absRow: string, digits: string) => {
      const newL = letterMap.get(letter);
      if (!newL) return full;
      return `${absCol}${newL}${absRow}${digits}`;
    },
  );
}

function colLettersToNum(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

function colNumToLetter(n: number): string {
  let letter = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    letter = String.fromCharCode(65 + rem) + letter;
    num = Math.floor((num - 1) / 26);
  }
  return letter;
}

// ---------------------------------------------------------------------------
// Lazy matrix loader for procedure boxes
// ---------------------------------------------------------------------------
//
// Only fetches the assertion matrix (which calls Claude) if at least
// one sheet in the workbook lacks a procedure box. Otherwise returns
// null and the procedure-box code degrades gracefully (skips the
// scoping-rationale prefix).

async function maybeLoadMatrixForProcedureBoxes(
  wb: ExcelJS.Workbook,
  engagementId: string,
): Promise<AssertionMatrix | null> {
  let anyMissing = false;
  for (const sheet of wb.worksheets) {
    if (!hasExistingProcedureBox(sheet)) {
      anyMissing = true;
      break;
    }
  }
  if (!anyMissing) return null;
  try {
    const { matrix } = await generateAssertionMatrix(engagementId);
    return matrix;
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------------------
// Existence sample loader
// ---------------------------------------------------------------------------
//
// Look up the engagement's configured Existence methodology + seed for
// the AR account that owns this workpaper, then run it against the CY
// aging. Returns null if the workpaper isn't AR-related, the AR
// account can't be located, no sampling settings exist, or the
// methodology is manual (auditor populates by hand).

async function loadExistenceSampleForFsli(args: {
  fsli: string | null;
  engagementId: string;
  aging: ArAging | null;
  trialBalance: TrialBalance | null;
  performanceMateriality: number;
}): Promise<SampleResult | null> {
  if (!args.fsli || !args.aging || !args.trialBalance) return null;
  if (!/accounts\s+receivable/i.test(args.fsli)) return null;

  // Find the AR account in the CY TB by FSLI match.
  const arAccount = args.trialBalance.accounts.find(
    (a) => findFsli(a.acctNum, a.name) === args.fsli,
  );
  if (!arAccount) return null;

  const settings = await loadWorkpaperSettings(
    args.engagementId,
    arAccount.acctNum,
  );
  const stored = settings.perAssertion["Existence"];
  const methodology =
    stored?.methodology ?? defaultMethodology(args.fsli, "Existence");
  if (
    methodology !== "highCoverageHybrid" &&
    methodology !== "musStatistical" &&
    methodology !== "riskBasedTable"
  ) {
    return null;
  }

  return runSampling({
    methodology,
    aging: args.aging,
    performanceMateriality: args.performanceMateriality,
    engagementId: args.engagementId,
    acctNum: arAccount.acctNum,
    assertion: "Existence",
    seed: stored?.seed,
    params: stored?.params,
  });
}

// ---------------------------------------------------------------------------
// Conclusion-formula in-place refresh (auditor-authored formulas)
// ---------------------------------------------------------------------------
//
// When the PY workpaper's conclusion cell is ALREADY a formula like
//   ="DSO CONCLUSION: DSO increased from "&D9&" days ("&D6&") to "&E9&
//   " days ("&E6&"), a "&F9&"-day increase (+4.5%). …"
// we want to preserve the auditor's narrative and the numeric refs
// (D9/E9/F9 — those now hold the new PY/CY/delta values after data
// rolled forward) but replace:
//   - year-label refs that sit inside `" days (…)"` patterns with
//     literal short-form year strings (FY23 / FY24) derived from cyYear
//   - the hardcoded YoY% inside `-day increase (X.X%)` with a freshly
//     computed value from the cells the formula references.
//
function updateConclusionFormulaRefs(
  wb: ExcelJS.Workbook,
  cyYear: number,
  skipSheets?: Set<string>,
): number {
  let count = 0;
  for (const sheet of wb.worksheets) {
    if (skipSheets?.has(sheet.name)) continue;
    for (let r = 1; r <= sheet.rowCount; r++) {
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getRow(r).getCell(c);
        const v = cell.value;
        if (!v || typeof v !== "object" || !("formula" in v)) continue;
        const formulaRaw = (v as { formula: unknown }).formula;
        if (typeof formulaRaw !== "string") continue;
        const resultRaw = (v as { result?: unknown }).result;
        const resultText = typeof resultRaw === "string" ? resultRaw : "";
        if (
          !/conclusion/i.test(formulaRaw) &&
          !/conclusion/i.test(resultText)
        ) {
          continue;
        }

        // Find the value cell refs that drive the conclusion: each
        // ref that sits immediately before `" days ("` is a DSO value
        // (the "from" and the "to"). Use them to compute YoY%.
        const dsoRefs: { col: string; row: number }[] = [];
        const dsoRe = /&\$?([A-Z]+)\$?(\d+)&" days \(/g;
        let mDso: RegExpExecArray | null;
        while ((mDso = dsoRe.exec(formulaRaw)) !== null) {
          dsoRefs.push({ col: mDso[1], row: parseInt(mDso[2], 10) });
        }
        let yoyPct: string | null = null;
        if (dsoRefs.length >= 2) {
          const fromVal = readNumberValue(
            sheet
              .getRow(dsoRefs[0].row)
              .getCell(colLettersToNum(dsoRefs[0].col)).value,
          );
          const toVal = readNumberValue(
            sheet
              .getRow(dsoRefs[1].row)
              .getCell(colLettersToNum(dsoRefs[1].col)).value,
          );
          if (
            fromVal !== null &&
            toVal !== null &&
            fromVal !== 0 &&
            Number.isFinite(fromVal) &&
            Number.isFinite(toVal)
          ) {
            yoyPct = (((toVal - fromVal) / fromVal) * 100).toFixed(1);
          }
        }

        const pyYr = String((cyYear - 1) % 100).padStart(2, "0");
        const cyYr = String(cyYear % 100).padStart(2, "0");

        let formula = formulaRaw;

        // Replace year labels inside `" days (…)"`. Handles both ref
        // form (`"&D6&"`) and literal forms (`FY22`, `FY 2022`). First
        // occurrence becomes the PY year, second the CY year.
        let yrIdx = 0;
        formula = formula.replace(
          /(" days \()(?:"&\$?[A-Z]+\$?\d+&"|FY\s*20\d{2}|FY\d{2})(\))/g,
          (_m, p: string, s: string) => {
            yrIdx += 1;
            return `${p}FY${yrIdx === 1 ? pyYr : cyYr}${s}`;
          },
        );

        // Replace hardcoded percentage in `-day increase (…)` with the
        // freshly computed YoY%. Drops any +/- sign so we emit a clean
        // value. Only act if we have a value.
        if (yoyPct !== null) {
          formula = formula.replace(
            /(-day increase \()[+\-]?\d+(?:\.\d+)?%(\))/,
            `$1${yoyPct}%$2`,
          );
        }

        if (formula !== formulaRaw) {
          cell.value = { ...v, formula } as ExcelJS.CellValue;
          count += 1;
        }
      }
    }
  }
  return count;
}

// ---------------------------------------------------------------------------
// Aging-conclusion in-place refresh
// ---------------------------------------------------------------------------
//
// The PY workpaper's aging conclusion looks like:
//   ="AGING ANALYTICS CONCLUSION: Current bucket moved from $1,090,000
//   (78.4%) to "&F16&" (77.0%), … 1–30 day bucket … from $210,000
//   (15.1%) to "&F17&" (17.0%), …"
//
// Two problems after a basic rollforward:
//   1. The hardcoded PY $ + % literals are still from the original PY
//      audit and don't reflect the new PY values now living in the table.
//   2. The `&Fnn&` refs were chosen by valueIndex year-shift logic and
//      target the % column instead of the $ amount column (because the
//      aging header has both an Amt and a % cell at the same year).
//
// We fix both by detecting each `from $X (Y%) to "&col{row}&" (Z%)`
// pattern, looking up the bucket row's actual PY $, PY %, CY $, CY %
// values, and splicing in literals. Preserves the auditor narrative.
//
function updateAgingConclusionRefs(
  wb: ExcelJS.Workbook,
  cyYear: number,
  skipSheets?: Set<string>,
): number {
  let count = 0;
  for (const sheet of wb.worksheets) {
    if (skipSheets?.has(sheet.name)) continue;
    const layout = findAgingTableLayout(sheet, cyYear);
    if (!layout) continue;
    const pyTotal = readNumberValue(
      sheet
        .getRow(layout.totalRow)
        .getCell(colLettersToNum(layout.pyDollarCol)).value,
    );
    const cyTotal = readNumberValue(
      sheet
        .getRow(layout.totalRow)
        .getCell(colLettersToNum(layout.cyDollarCol)).value,
    );
    if (pyTotal === null || cyTotal === null) continue;

    for (let r = 1; r <= sheet.rowCount; r++) {
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getRow(r).getCell(c);
        const v = cell.value;
        if (!v || typeof v !== "object" || !("formula" in v)) continue;
        const formulaRaw = (v as { formula: unknown }).formula;
        if (typeof formulaRaw !== "string") continue;
        const resultRaw = (v as { result?: unknown }).result;
        const resultText = typeof resultRaw === "string" ? resultRaw : "";
        if (
          !/aging[^"]*conclusion/i.test(formulaRaw) &&
          !/aging[^"]*conclusion/i.test(resultText)
        ) {
          continue;
        }

        // Each transformation matches the surrounding `from $X (Y%) to
        // "&col{row}&" (Z%)` pattern. The row number embedded in the
        // existing (wrong) ref tells us which aging-bucket row's values
        // to splice in.
        const fmtDollar = (n: number) =>
          `$${Math.round(n).toLocaleString("en-US")}`;
        const fmtPct = (n: number) => `${(n * 100).toFixed(1)}%`;

        let next = formulaRaw.replace(
          /from \$[\d,]+(?:\.\d+)? \([\d.]+%\) to "&\$?[A-Z]+\$?(\d+)&" \([\d.]+%\)/g,
          (m, rowStr: string) => {
            const row = parseInt(rowStr, 10);
            const pyDollar = readNumberValue(
              sheet
                .getRow(row)
                .getCell(colLettersToNum(layout.pyDollarCol)).value,
            );
            const cyDollar = readNumberValue(
              sheet
                .getRow(row)
                .getCell(colLettersToNum(layout.cyDollarCol)).value,
            );
            if (
              pyDollar === null ||
              cyDollar === null ||
              pyTotal === 0 ||
              cyTotal === 0
            ) {
              return m;
            }
            const pyPct = pyDollar / pyTotal;
            const cyPct = cyDollar / cyTotal;
            return `from ${fmtDollar(pyDollar)} (${fmtPct(pyPct)}) to ${fmtDollar(cyDollar)} (${fmtPct(cyPct)})`;
          },
        );

        // Rebuild the "immaterial buckets" sentence using the actual CY
        // amounts for the named buckets. Matches "The X and Y buckets
        // are immaterial ($Z combined, W% of total)".
        const bucketRowByKey = new Map<string, number>();
        for (let rr = layout.headerRow + 1; rr < layout.totalRow; rr++) {
          for (let cc = 1; cc <= sheet.columnCount; cc++) {
            const text = readCellText(sheet.getRow(rr).getCell(cc)).trim();
            if (!text) continue;
            const key = text
              .toLowerCase()
              .replace(/[–—]/g, "-")
              .replace(/\s*days?\s*$/i, "")
              .replace(/\s+/g, "");
            if (key) bucketRowByKey.set(key, rr);
          }
        }
        const normalizeBucketKey = (s: string) =>
          s
            .toLowerCase()
            .replace(/[–—]/g, "-")
            .replace(/\s+/g, "")
            .trim();

        next = next.replace(
          /(The )([\d\-+]+) and ([\d\-+]+)( buckets are immaterial \()\$[\d,]+ combined, [\d.]+% of total(\))/g,
          (m, pre: string, b1: string, b2: string, mid: string, post: string) => {
            const r1 = bucketRowByKey.get(normalizeBucketKey(b1));
            const r2 = bucketRowByKey.get(normalizeBucketKey(b2));
            if (!r1 || !r2 || cyTotal === 0) return m;
            const v1 = readNumberValue(
              sheet.getRow(r1).getCell(colLettersToNum(layout.cyDollarCol))
                .value,
            );
            const v2 = readNumberValue(
              sheet.getRow(r2).getCell(colLettersToNum(layout.cyDollarCol))
                .value,
            );
            if (v1 === null || v2 === null) return m;
            const combined = v1 + v2;
            const pct = combined / cyTotal;
            return `${pre}${b1} and ${b2}${mid}${fmtDollar(combined)} combined, ${fmtPct(pct)} of total${post}`;
          },
        );

        if (next !== formulaRaw) {
          cell.value = { ...v, formula: next } as ExcelJS.CellValue;
          count += 1;
        }
      }
    }
  }
  return count;
}

// Locates the PY $, PY %, CY $, CY % columns and the Total row of the
// aging table. Scans rows for a header that has both "$ Amt" cells and
// "%" cells tagged with cyYear-1 and cyYear; finds Total by scanning
// the leftmost label column for a "Total" row below the header.
function findAgingTableLayout(
  sheet: ExcelJS.Worksheet,
  cyYear: number,
): {
  pyDollarCol: string;
  pyPctCol: string;
  cyDollarCol: string;
  cyPctCol: string;
  headerRow: number;
  totalRow: number;
} | null {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    let pyDollar: string | null = null;
    let pyPct: string | null = null;
    let cyDollar: string | null = null;
    let cyPct: string | null = null;
    for (let c = 1; c <= sheet.columnCount; c++) {
      const text = readCellText(row.getCell(c)).trim();
      if (!text || text.length > 30) continue;
      const yearM = text.match(/\b(20\d{2})\b/);
      if (!yearM) continue;
      const year = parseInt(yearM[1], 10);
      const isDollar = /(amt|\$)/i.test(text);
      const isPct = /%/.test(text) && !isDollar;
      const letter = colNumToLetter(c);
      if (year === cyYear - 1) {
        if (isDollar && !pyDollar) pyDollar = letter;
        if (isPct && !pyPct) pyPct = letter;
      } else if (year === cyYear) {
        if (isDollar && !cyDollar) cyDollar = letter;
        if (isPct && !cyPct) cyPct = letter;
      }
    }
    if (pyDollar && pyPct && cyDollar && cyPct) {
      // Find the Total row beneath this header.
      let totalRow = -1;
      for (let rr = r + 1; rr <= sheet.rowCount; rr++) {
        for (let cc = 1; cc <= sheet.columnCount; cc++) {
          const text = readCellText(sheet.getRow(rr).getCell(cc)).trim();
          if (/^total$/i.test(text)) {
            totalRow = rr;
            break;
          }
        }
        if (totalRow !== -1) break;
      }
      if (totalRow === -1) continue;
      return {
        pyDollarCol: pyDollar,
        pyPctCol: pyPct,
        cyDollarCol: cyDollar,
        cyPctCol: cyPct,
        headerRow: r,
        totalRow,
      };
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// Narrative date shift (rollforward mode only)
// ---------------------------------------------------------------------------

function shiftNarrativeDates(wb: ExcelJS.Workbook, cyYear: number): number {
  let count = 0;
  // shiftDatesInString itself only shifts years strictly below cyYear,
  // so cells like "FY 2024 Amt ($)" or "FY 2024" stay put. Year-
  // reference cells holding "FY 2022" or "FY 2023" get rolled forward.
  // Handles plain strings, rich-text (array of runs), formulas with
  // string cached results, and hyperlink-style {text} objects.
  for (const sheet of wb.worksheets) {
    const newSheetName = shiftDatesInString(sheet.name, cyYear);
    if (newSheetName !== sheet.name) {
      sheet.name = newSheetName;
      count += 1;
    }
    // Pre-pass: find "template-mode" year-header rows — rows that
    // already contain a cell labelled with cyYear (e.g. a header row
    // "FY 2022 | FY 2023 | FY 2024" when cyYear=2024). In those rows we
    // must NOT shift the older year labels, or we'd produce duplicate
    // headers like "FY 2023 | FY 2024 | FY 2024".
    const templateHeaderRows = new Set<number>();
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      let yearLabelCount = 0;
      let hasCyYear = false;
      for (let c = 1; c <= sheet.columnCount; c++) {
        const text = readCellText(row.getCell(c)).trim();
        if (!text || text.length > 30) continue;
        const m = text.match(/\b(20\d{2})\b/);
        if (!m) continue;
        yearLabelCount += 1;
        if (parseInt(m[1], 10) === cyYear) hasCyYear = true;
      }
      if (yearLabelCount >= 2 && hasCyYear) templateHeaderRows.add(r);
    }

    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      const inTemplateHeaderRow = templateHeaderRows.has(r);
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c);
        const v = cell.value;

        if (typeof v === "string") {
          // In template-mode header rows, leave short year-label cells
          // alone so we don't create duplicate column headers.
          if (
            inTemplateHeaderRow &&
            v.trim().length <= 30 &&
            /\b20\d{2}\b/.test(v)
          ) {
            continue;
          }
          const next = shiftDatesInString(v, cyYear);
          if (next !== v) {
            cell.value = next;
            count += 1;
          }
          continue;
        }

        if (v && typeof v === "object") {
          // Rich text: { richText: [{ text, font? }, ...] } — shift
          // each run's text independently.
          if (
            "richText" in v &&
            Array.isArray((v as { richText: unknown }).richText)
          ) {
            const runs = (v as { richText: { text?: string }[] }).richText;
            let changed = false;
            const nextRuns = runs.map((run) => {
              const t = typeof run.text === "string" ? run.text : "";
              const nt = shiftDatesInString(t, cyYear);
              if (nt !== t) {
                changed = true;
                return { ...run, text: nt };
              }
              return run;
            });
            if (changed) {
              cell.value = {
                ...(v as object),
                richText: nextRuns,
              } as ExcelJS.CellValue;
              count += 1;
            }
            continue;
          }

          // Formula with a cached string result — shift the result so
          // the cell displays the rolled text until Excel recalcs.
          if ("formula" in v && "result" in v) {
            const result = (v as { result: unknown }).result;
            if (typeof result === "string") {
              const nextResult = shiftDatesInString(result, cyYear);
              if (nextResult !== result) {
                cell.value = {
                  ...(v as object),
                  result: nextResult,
                } as ExcelJS.CellValue;
                count += 1;
              }
            }
            continue;
          }

          // Hyperlink / general object with a `text` property.
          if (
            "text" in v &&
            typeof (v as { text: unknown }).text === "string"
          ) {
            const text = (v as { text: string }).text;
            const next = shiftDatesInString(text, cyYear);
            if (next !== text) {
              cell.value = {
                ...(v as object),
                text: next,
              } as ExcelJS.CellValue;
              count += 1;
            }
            continue;
          }
        }
      }
    }
  }
  return count;
}

// Shifts year tokens by +1, but only for years strictly less than
// cyYear — so a chain of PY-era references ("FY 2022 to FY 2023") all
// roll forward together while CY-and-later references stay put.
// Bulletproof date shifter. Only PY-year dates (yyyy === cyYear-1 or
// "yy" === last-two-digits of cyYear-1) roll forward to CY. Older
// comparative years (FY 2022, FY 2023, …) roll +1 because comparative
// columns also shift one slot left. Years that are already CY or
// future stay put — preventing the previous "+1 unconditionally"
// behavior that turned a stray 2030 deadline into 2031 every time
// the workpaper was regenerated.
function shiftDatesInString(text: string, cyYear: number): string {
  const pyYear = cyYear - 1;
  const pyYy = String(pyYear).slice(-2);
  const cyYy = String(cyYear).slice(-2);
  let out = text;

  // FY/CY/PY/Q1-4 year refs — comparative-friendly: shift any year
  // strictly below cyYear by +1 so a 3-column comparative
  // (FY 2022, FY 2023, FY 2024) rolls to (FY 2023, FY 2024, FY 2025).
  out = out.replace(
    /\b(FY|CY|PY|Fiscal\s+Year|Q[1-4])\s+(20\d{2})\b/gi,
    (full, prefix: string, y: string) => {
      const yearNum = parseInt(y, 10);
      if (yearNum >= cyYear) return full;
      return `${prefix} ${yearNum + 1}`;
    },
  );

  // ISO date YYYY-MM-DD — only shift when the year IS pyYear, so
  // future-dated deadlines / forecasts don't tick on every rollforward.
  out = out.replace(
    /\b(20\d{2})-(\d{2})-(\d{2})\b/g,
    (full, y: string, m: string, d: string) => {
      if (parseInt(y, 10) !== pyYear) return full;
      return `${cyYear}-${m}-${d}`;
    },
  );

  // US date M/D/YYYY — same pyYear-only guard.
  out = out.replace(
    /\b(\d{1,2})\/(\d{1,2})\/(20\d{2})\b/g,
    (full, m: string, d: string, y: string) => {
      if (parseInt(y, 10) !== pyYear) return full;
      return `${m}/${d}/${cyYear}`;
    },
  );

  // US date M/D/YY (2-digit year, common on schedule banners like
  // "Gross trade receivables, 12/31/24"). Match the last two digits
  // of pyYear; preserve 2-digit format on output.
  out = out.replace(
    /\b(\d{1,2})\/(\d{1,2})\/(\d{2})\b/g,
    (full, m: string, d: string, yy: string) => {
      if (yy !== pyYy) return full;
      return `${m}/${d}/${cyYy}`;
    },
  );

  // "Month D, YYYY" — pyYear-only.
  out = out.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\s+(\d{1,2}),?\s+(20\d{2})\b/g,
    (full, month: string, day: string, y: string) => {
      if (parseInt(y, 10) !== pyYear) return full;
      return `${month} ${day}, ${cyYear}`;
    },
  );

  // "Month YYYY" — pyYear-only.
  out = out.replace(
    /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\s+(20\d{2})\b/g,
    (full, month: string, y: string) => {
      if (parseInt(y, 10) !== pyYear) return full;
      return `${month} ${cyYear}`;
    },
  );

  return out;
}

// ---------------------------------------------------------------------------
// Cell text helper
// ---------------------------------------------------------------------------

function readCellText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (v instanceof Date) return v.toISOString();
  if (typeof v === "object" && "text" in v) {
    const t = (v as { text: unknown }).text;
    if (typeof t === "string") return t;
  }
  return "";
}

// Walk every cell once and round long decimals to 2 places. Skips
// values that already fit in 2 decimals.
function roundLongDecimals(wb: ExcelJS.Workbook): number {
  let updates = 0;
  for (const sheet of wb.worksheets) {
    for (let r = 1; r <= sheet.rowCount; r++) {
      const row = sheet.getRow(r);
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c);
        const v = cell.value;
        if (typeof v === "number") {
          if (hasMoreThanTwoDecimals(v)) {
            cell.value = round2(v);
            updates += 1;
          }
        } else if (
          v &&
          typeof v === "object" &&
          "formula" in v &&
          "result" in v
        ) {
          const result = (v as { result: unknown }).result;
          if (typeof result === "number" && hasMoreThanTwoDecimals(result)) {
            cell.value = {
              ...v,
              result: round2(result),
            } as ExcelJS.CellValue;
            updates += 1;
          }
        }
      }
    }
  }
  return updates;
}

function hasMoreThanTwoDecimals(n: number): boolean {
  if (!Number.isFinite(n)) return false;
  // Floating-point safe: compare the value rounded to 2 places against
  // the original to within a tiny epsilon. Anything that differs by
  // more than 1e-9 (well below "two decimal places") gets rounded.
  return Math.abs(Math.round(n * 100) / 100 - n) > 1e-9;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
