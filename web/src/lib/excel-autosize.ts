import type ExcelJS from "exceljs";

// Widens every column on a worksheet so its widest cell value fits without
// truncation. Never shrinks — respects intentional widths set by each
// sheet builder. Cells that are merged with another cell as their
// non-master half are skipped so a centered banner doesn't force a single
// column to absorb the full banner's width.
//
// Apply this as the LAST step before serializing the workbook. Once cells
// are written, this is purely a column-width adjustment — fast and safe.

const MAX_WIDTH = 70;
const PADDING = 2;

export function autosizeColumns(sheet: ExcelJS.Worksheet): void {
  const { covered, multiColMasters } = collectMergeInfo(sheet);

  const maxLengths = new Map<number, number>();
  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    for (let c = 1; c <= sheet.columnCount; c++) {
      // Skip cells covered by another cell's merge (non-master halves).
      if (covered.has(addr(r, c))) continue;
      // Skip cells that are the master of a merge spanning more than one
      // column — Excel visually distributes their content across the merge,
      // so they shouldn't dictate a single column's width.
      if (multiColMasters.has(addr(r, c))) continue;
      const cell = row.getCell(c);
      const text = cellText(cell);
      // Number-formatted cells render wider than their raw string (e.g. a
      // raw 1234 renders as "$1,234"). Approximate by adding 25% headroom
      // for numbers — close enough without re-implementing Excel's
      // formatter.
      const renderLen =
        typeof cell.value === "number" ? Math.ceil(text.length * 1.25) : text.length;
      const prev = maxLengths.get(c) ?? 0;
      if (renderLen > prev) maxLengths.set(c, renderLen);
    }
  }

  for (const [col, max] of maxLengths) {
    const column = sheet.getColumn(col);
    const desired = Math.min(MAX_WIDTH, max + PADDING);
    if ((column.width ?? 0) < desired) column.width = desired;
  }
}

// Per-line vertical space at the default Calibri 11pt. Excel's actual
// line height varies a bit by font, but 15pt is a safe lower bound that
// keeps wrapped lines readable.
const LINE_HEIGHT_POINTS = 15;
// Headroom on top of (lines * line-height) so the last line isn't pinned
// against the bottom border.
const HEIGHT_PADDING = 4;
// Hard ceiling so a paragraph the auditor pasted in doesn't blow up the
// row to several thousand points.
const MAX_HEIGHT = 400;
// Heuristic: how many Calibri 11 characters fit in one Excel
// column-width unit. Empirically a column of width N fits ~1.15 × N
// characters before Excel wraps — column widths in Excel are
// approximations of "0" characters, and most prose has narrower
// average glyphs. Slight over-estimate of capacity keeps row heights
// honest (fewer wrapped lines → shorter rows) without pinning the last
// character to the column edge.
const CHARS_PER_WIDTH_UNIT = 1.15;

// Sets each row's height to fit its tallest wrapped cell. Never shrinks —
// preserves explicit minimums set by sheet builders. Call this AFTER
// autosizeColumns since wrap math depends on final column widths.
export function autofitRows(sheet: ExcelJS.Worksheet): void {
  const { covered, multiColMasters, ranges } = collectMergeInfo(sheet);

  for (let r = 1; r <= sheet.rowCount; r++) {
    const row = sheet.getRow(r);
    let maxLines = 1;

    for (let c = 1; c <= sheet.columnCount; c++) {
      if (covered.has(addr(r, c))) continue;
      const cell = row.getCell(c);
      const text = cellText(cell);
      if (!text) continue;

      // Available width for wrapping = sum of the merged columns' widths
      // (when this cell is the master of a multi-col merge), else just
      // this column's width.
      const colSpan = multiColMasters.has(addr(r, c))
        ? ranges.get(addr(r, c))!.right - ranges.get(addr(r, c))!.left + 1
        : 1;
      let availableWidth = 0;
      for (let cc = c; cc < c + colSpan; cc++) {
        availableWidth += sheet.getColumn(cc).width ?? 10;
      }
      const charsPerLine = Math.max(
        4,
        Math.floor(availableWidth * CHARS_PER_WIDTH_UNIT),
      );

      const wrapsOn = cellWrapsText(cell);
      const lines = countLines(text, charsPerLine, wrapsOn);
      if (lines > maxLines) maxLines = lines;
    }

    const desired = Math.min(
      MAX_HEIGHT,
      maxLines * LINE_HEIGHT_POINTS + HEIGHT_PADDING,
    );
    if ((row.height ?? 0) < desired) row.height = desired;
  }
}

export function autosizeAllSheets(wb: ExcelJS.Workbook): void {
  for (const sheet of wb.worksheets) {
    autosizeColumns(sheet);
    autofitRows(sheet);
  }
}

function cellWrapsText(cell: ExcelJS.Cell): boolean {
  // ExcelJS cell alignment is optional; default behavior depends on the
  // sheet/row defaults. Treat undefined wrapText as "not wrapping" — the
  // builders explicitly opt in via `row.alignment = { wrapText: true }`.
  return cell.alignment?.wrapText === true;
}

function countLines(
  text: string,
  charsPerLine: number,
  wrapsOn: boolean,
): number {
  const explicit = text.split("\n");
  if (!wrapsOn) return explicit.length;
  let total = 0;
  for (const segment of explicit) {
    if (segment.length === 0) {
      total += 1;
      continue;
    }
    total += Math.max(1, Math.ceil(segment.length / charsPerLine));
  }
  return total;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function collectMergeInfo(sheet: ExcelJS.Worksheet): {
  covered: Set<string>;
  multiColMasters: Set<string>;
  ranges: Map<string, ExcelJS.Range>;
} {
  const covered = new Set<string>();
  const multiColMasters = new Set<string>();
  const ranges = new Map<string, ExcelJS.Range>();
  // ExcelJS doesn't expose merge ranges publicly; the internal `_merges`
  // map is the only way to enumerate them. Each value is a Range with
  // top/bottom/left/right numeric bounds. The cast is intentional.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const merges = (sheet as any)._merges as
    | Record<string, ExcelJS.Range>
    | undefined;
  if (!merges) return { covered, multiColMasters, ranges };
  for (const range of Object.values(merges)) {
    const masterAddr = addr(range.top, range.left);
    ranges.set(masterAddr, range);
    if (range.right > range.left) {
      multiColMasters.add(masterAddr);
    }
    for (let r = range.top; r <= range.bottom; r++) {
      for (let c = range.left; c <= range.right; c++) {
        if (r === range.top && c === range.left) continue; // master — keep
        covered.add(addr(r, c));
      }
    }
  }
  return { covered, multiColMasters, ranges };
}

function addr(row: number, col: number): string {
  return `${row}:${col}`;
}

function cellText(cell: ExcelJS.Cell): string {
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
      return (v as { richText: { text: string }[] }).richText
        .map((rt) => rt.text)
        .join("");
    }
    if ("result" in v) {
      const r = (v as { result: unknown }).result;
      if (typeof r === "string" || typeof r === "number") return String(r);
    }
  }
  return "";
}
