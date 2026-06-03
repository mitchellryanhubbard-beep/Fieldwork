import ExcelJS from "exceljs";
import type { AssertionMatrix } from "@/lib/assertion-matrix";

// Stamps a "TESTING PROCEDURE: ..." box into the empty row immediately
// above a workpaper's first section banner. The box is a merged-cell
// wrap-text block that describes what the auditor did.
//
// If the PY workpaper already contains a procedure box / paragraph
// (we look for a "PROCEDURE" header in plain text), we leave it alone
// and let the auditor's existing language flow through. Only freshly
// add a box when the PY didn't have one.
//
// When inserting, the box leads with the scoping rationale (pulled
// from the engagement's assertion matrix, AR row) and elaborates with
// workpaper-type-specific procedure details.

export function writeProcedureBoxes(
  wb: ExcelJS.Workbook,
  matrix: AssertionMatrix | null,
): number {
  let modified = 0;
  const arRationale = arApproachRationale(matrix);
  for (const sheet of wb.worksheets) {
    const layout = detectSheetLayout(sheet);
    if (!layout) continue;
    if (hasExistingProcedureBox(sheet)) continue;

    const description = describeProcedureForLayout(layout, arRationale);
    if (!description) continue;

    // Place the box DIRECTLY UNDER the workpaper title line — the row
    // containing "WP Reference: …" — so it lands in the same spot on
    // every workpaper. Falls back to "row above first section" only
    // when no title-marker row exists.
    const titleEndRow = findTitleEndRow(sheet);
    const targetRow = titleEndRow
      ? titleEndRow + 1
      : layout.firstSectionRow - 1;
    if (targetRow < 1) continue;

    // Never overwrite an existing row. If the target row already has
    // any content in the box's column range (labels, headers, data
    // — anything the auditor put there), skip placement on this sheet
    // rather than wipe their work.
    if (rowHasContent(sheet, targetRow, layout.firstSectionCol, layout.maxCol)) {
      continue;
    }

    if (
      writeBoxedText(
        sheet,
        targetRow,
        description,
        layout.firstSectionCol,
        layout.maxCol,
      )
    ) {
      modified += 1;
    }
  }
  return modified;
}

function rowHasContent(
  sheet: ExcelJS.Worksheet,
  row: number,
  startCol: number,
  endCol: number,
): boolean {
  const r = sheet.getRow(row);
  for (let c = startCol; c <= endCol; c++) {
    if (readText(r.getCell(c)).trim()) return true;
  }
  return false;
}

// Finds the row that holds the workpaper-title line — identified by
// a "WP Reference: …", "WP: …", or "Workpaper Reference: …" token in
// any of the first few columns. Returns null if no title marker is
// found.
export function findTitleEndRow(sheet: ExcelJS.Worksheet): number | null {
  for (let r = 1; r <= Math.min(sheet.rowCount, 15); r++) {
    for (let c = 1; c <= Math.min(sheet.columnCount, 6); c++) {
      const text = readText(sheet.getRow(r).getCell(c)).trim();
      if (!text) continue;
      if (
        /(?:^|\|)\s*(?:wp|workpaper)(?:\s*reference)?\s*:\s*[A-Za-z0-9_\-]/i.test(
          text,
        )
      ) {
        return r;
      }
    }
  }
  return null;
}

// Looks anywhere in the sheet for an existing procedure header. We
// treat a cell whose text starts with "PROCEDURE" / "TESTING
// PROCEDURE" / "AUDIT PROCEDURE" as proof the PY auditor authored one.
export function hasExistingProcedureBox(sheet: ExcelJS.Worksheet): boolean {
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= Math.min(sheet.columnCount, 4); c++) {
      const text = readText(row.getCell(c)).trim();
      if (!text) continue;
      if (/^(testing\s+procedure|audit\s+procedure|procedure)\s*[:\-]/i.test(text)) {
        return true;
      }
    }
  }
  return false;
}

function arApproachRationale(matrix: AssertionMatrix | null): string | null {
  if (!matrix) return null;
  const row =
    matrix.rows.find((r) => /accounts\s+receivable/i.test(r.account)) ??
    matrix.rows.find((r) => /\bar\b/i.test(r.account));
  if (!row) return null;
  const rat = row.approachRationale?.trim();
  return rat && rat.length > 0 ? rat : null;
}

type WorkpaperKind =
  | "dso-aging-analytics"
  | "sampling-methodology"
  | "confirmation-tracker"
  | "testing-summary-memo"
  | "other";

type SheetLayout = {
  kind: WorkpaperKind;
  firstSectionRow: number;
  firstSectionCol: number;
  maxCol: number;
};

function detectSheetLayout(sheet: ExcelJS.Worksheet): SheetLayout | null {
  // Find the first section banner row (text matching a known pattern).
  // Scan all columns since some workpapers indent content one column
  // in (column B as the visual start, A used as a margin).
  let firstSectionRow = -1;
  let firstSectionCol = 1;
  let kind: WorkpaperKind = "other";
  outer: for (let r = 1; r <= sheet.rowCount; r++) {
    for (let c = 1; c <= Math.min(sheet.columnCount, 4); c++) {
      const text = readText(sheet.getRow(r).getCell(c)).trim();
      if (!text) continue;
      const detected = classifySectionBanner(text);
      if (detected) {
        firstSectionRow = r;
        firstSectionCol = c;
        kind = detected;
        break outer;
      }
    }
  }
  if (firstSectionRow === -1) return null;

  // Find the workpaper's effective column width. Walk down a bit and
  // take the max non-empty column index — this avoids merging into
  // truly empty cells far to the right.
  let maxCol = 1;
  for (let r = firstSectionRow; r <= Math.min(firstSectionRow + 8, sheet.rowCount); r++) {
    for (let c = sheet.columnCount; c >= 1; c--) {
      const v = sheet.getRow(r).getCell(c).value;
      if (v !== null && v !== undefined && v !== "") {
        if (c > maxCol) maxCol = c;
        break;
      }
    }
  }

  return { kind, firstSectionRow, firstSectionCol, maxCol };
}

function classifySectionBanner(text: string): WorkpaperKind | null {
  if (
    /days\s+sales\s+outstanding/i.test(text) ||
    /dso.*trend\s+analysis/i.test(text) ||
    /aging\s+distribution.*year\s+over\s+year/i.test(text)
  ) {
    return "dso-aging-analytics";
  }
  if (
    /sampling\s+methodology/i.test(text) ||
    /sampling\s+approach\s+&\s+rationale/i.test(text) ||
    /sample\s+design/i.test(text)
  ) {
    return "sampling-methodology";
  }
  if (
    /confirmation\s+response\s+tracker/i.test(text) ||
    /confirmation\s+(request|response)\s+log/i.test(text) ||
    /external\s+confirmations\s+—\s+population/i.test(text)
  ) {
    return "confirmation-tracker";
  }
  if (
    /testing\s+summary\s+memo/i.test(text) ||
    /summary\s+memo/i.test(text) ||
    /(account|wp)\s+conclusion\s+memo/i.test(text) ||
    /workpaper\s+summary/i.test(text)
  ) {
    return "testing-summary-memo";
  }
  return null;
}

function describeProcedureForLayout(
  layout: SheetLayout,
  arRationale: string | null,
): string | null {
  const prefix = arRationale
    ? `SCOPING RATIONALE (AR): ${arRationale}\n\n`
    : "";
  if (layout.kind === "dso-aging-analytics") {
    return (
      prefix +
      "TESTING PROCEDURE: Performed substantive analytical procedures " +
      "over Accounts Receivable in two parts. (1) DSO trend — computed " +
      "Days Sales Outstanding (AR ÷ Revenue × 365) for the prior and " +
      "current fiscal year and compared the year-over-year change to " +
      "the industry benchmark (~72 days). Obtained explanations from " +
      "management for material variances and corroborated with revenue " +
      "and collection-pattern data. (2) Aging mix — compared CY vs. PY " +
      "aging distribution by bucket ($ and % of total). Identified " +
      "shifts toward older buckets and obtained explanations for any " +
      "material movement. Tied opening figures to the PY audited " +
      "balances and CY figures to the CY trial balance and aged AR " +
      "detail (PBC-AR-01)."
    );
  }
  if (layout.kind === "sampling-methodology") {
    return (
      prefix +
      "TESTING PROCEDURE: Defined the AR existence sampling approach in " +
      "accordance with the engagement's risk assessment and applicable " +
      "auditing standards (AU-C 530 / AS 2315 — Audit Sampling). " +
      "Documented (a) the population (open AR balances at year-end per " +
      "the aged AR detail), (b) the sampling unit (customer-level " +
      "balance), (c) the methodology (recorded on this sheet — high-" +
      "coverage hybrid / MUS / risk-based table), (d) parameters " +
      "(performance materiality, top-tier threshold, target coverage " +
      "or sampling interval), and (e) a deterministic seed for " +
      "reproducibility. The selections produced by this methodology " +
      "drive WP-AR-01 (confirmations) and WP-AR-02 (alternative " +
      "procedures)."
    );
  }
  if (layout.kind === "confirmation-tracker") {
    return (
      prefix +
      "TESTING PROCEDURE: For each customer balance selected per the " +
      "existence sampling methodology (WP-AR-00), prepared and mailed " +
      "positive confirmation requests on the engagement's confirmation " +
      "date. Tracked responses across the request window and " +
      "classified each as: Confirmed (agreed), Confirmed with " +
      "Exceptions (response received with reconciling differences), or " +
      "Non-Response. For Confirmed-with-Exceptions, investigated each " +
      "reconciling item to source documentation and concluded on its " +
      "validity. Non-Responses were forwarded to WP-AR-02 for " +
      "alternative-procedure testing. Reconciled the total $ confirmed " +
      "and $ tested via alt procedures to the sampling-methodology " +
      "coverage figure documented in WP-AR-00."
    );
  }
  if (layout.kind === "testing-summary-memo") {
    return (
      prefix +
      "TESTING PROCEDURE: Summarized the results of AR testing across " +
      "Existence, Valuation, Rights & Obligations, and Presentation. " +
      "Tied (a) confirmation responses (WP-AR-01), (b) alternative " +
      "procedure results (WP-AR-02), and (c) substantive analytical " +
      "procedures (WP-AR-03) to the population $ and to the trial " +
      "balance. Documented all exceptions identified, their disposition " +
      "(corrected / passed adjustment / waived), and the auditor's " +
      "overall conclusion on each assertion. Cross-referenced the " +
      "summary to the AR lead sheet and to relevant procedures in the " +
      "assertion matrix."
    );
  }
  return null;
}

function writeBoxedText(
  sheet: ExcelJS.Worksheet,
  row: number,
  text: string,
  startCol: number,
  endCol: number,
): boolean {
  const colStart = colNumToLetter(startCol);
  const colEnd = colNumToLetter(endCol);
  const range = `${colStart}${row}:${colEnd}${row}`;
  try {
    sheet.unMergeCells(range);
  } catch {
    // already unmerged — ignore
  }
  for (let c = startCol; c <= endCol; c++) {
    sheet.getRow(row).getCell(c).value = null;
  }
  const cell = sheet.getRow(row).getCell(startCol);
  cell.value = text;
  try {
    sheet.mergeCells(range);
  } catch {
    return false;
  }
  cell.alignment = {
    wrapText: true,
    vertical: "top",
    horizontal: "left",
  };
  sheet.getRow(row).height = computeWrappedRowHeight(
    sheet,
    startCol,
    endCol,
    text,
  );
  return true;
}

// Estimates the row height needed to fit wrap-text content in a merged
// cell. Sums the merged columns' widths (chars), divides text length by
// the per-line capacity, accounts for explicit \n breaks, and converts
// to row-height points. Caps to avoid runaway rows.
export function computeWrappedRowHeight(
  sheet: ExcelJS.Worksheet,
  startCol: number,
  endCol: number,
  text: string,
): number {
  // Excel's default column width is 8.43 "characters" — use as fallback
  // when a column hasn't had a width explicitly set.
  let totalCharsWidth = 0;
  for (let c = startCol; c <= endCol; c++) {
    const col = sheet.getColumn(c);
    const w = typeof col.width === "number" ? col.width : 8.43;
    totalCharsWidth += w;
  }
  // Effective chars per wrapped line — leave a small margin so we don't
  // under-estimate when characters are wider than the average glyph.
  const charsPerLine = Math.max(20, Math.floor(totalCharsWidth * 0.9));

  // Account for explicit \n breaks AND auto-wrap inside each segment.
  let totalLines = 0;
  const segments = text.split("\n");
  for (const seg of segments) {
    if (seg.length === 0) {
      totalLines += 1;
      continue;
    }
    totalLines += Math.ceil(seg.length / charsPerLine);
  }
  totalLines = Math.max(2, totalLines);

  // Row height is in points; ~15 pt per wrapped line + ~6 pt padding.
  const heightPt = totalLines * 15 + 6;
  // Cap so a runaway text doesn't produce a 1000-pt row.
  return Math.min(Math.max(heightPt, 30), 600);
}

function readText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("formula" in v && "result" in v) {
      const r = (v as { result: unknown }).result;
      if (typeof r === "string") return r;
      if (typeof r === "number") return String(r);
    }
    if (
      "richText" in v &&
      Array.isArray((v as { richText: unknown }).richText)
    ) {
      return (v as { richText: { text?: string }[] }).richText
        .map((rt) => rt.text ?? "")
        .join("");
    }
    if ("text" in v) {
      const t = (v as { text: unknown }).text;
      if (typeof t === "string") return t;
    }
  }
  return "";
}

function colNumToLetter(n: number): string {
  let s = "";
  let num = n;
  while (num > 0) {
    const rem = (num - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    num = Math.floor((num - 1) / 26);
  }
  return s;
}
