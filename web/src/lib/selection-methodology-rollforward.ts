import ExcelJS from "exceljs";
import type { EngagementSetup } from "@/lib/engagement-schema";

// Re-authors the three numbered lines under the "SELECTION
// METHODOLOGY" section of a detail-testing workpaper. The PY narrative
// uses prose with embedded numbers (PM amount, key + haphazard counts,
// coverage $, coverage %, below-PM population) that the generic
// label-and-cell rollover can't reach.
//
// Strategy: read the workpaper's OWN values that the auditor sees
// elsewhere in the file —
//   - PM from engagement.materiality.performanceMateriality
//   - Gross AR from the cell labelled "Gross AR per TB" on any tab
//   - Total tested $ from the Selections tab's Total row
//   - Key vs Haphazard split from the Selections tab's Basis column
// then re-author the three lines so the paragraph is internally
// consistent with what the workpaper itself displays.

export type SelectionMethodologyRolloverResult = {
  updates: number;
};

export function rolloverSelectionMethodology(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
  },
): SelectionMethodologyRolloverResult {
  const pm = args.engagement.materiality.performanceMateriality;
  if (pm <= 0) return { updates: 0 };

  // Walk every cell on every sheet, capturing the data points we need
  // from labels: Gross AR per TB, the Selections tab's Total row, and
  // per-row Basis labels for the key/haphazard split.
  let grossAr: number | null = null;
  let totalTested: number | null = null;
  let totalCount = 0;
  let keyCoverage = 0;
  let keyCount = 0;
  let hapCoverage = 0;
  let hapCount = 0;

  for (const sheet of wb.worksheets) {
    const selLayout = detectSelectionsLayout(sheet);
    if (selLayout) {
      // Walk the data rows up to (but not including) the Total row.
      const stopRow =
        selLayout.totalRow !== null ? selLayout.totalRow : sheet.rowCount + 1;
      for (let r = selLayout.firstDataRow; r < stopRow; r++) {
        const amt = readNumber(
          sheet.getRow(r).getCell(selLayout.colAmount).value,
        );
        if (amt === null || amt === 0) continue;
        totalCount += 1;
        const basis = selLayout.colBasis
          ? readText(sheet.getRow(r).getCell(selLayout.colBasis))
              .trim()
              .toLowerCase()
          : "";
        if (isHaphazardBasis(basis)) {
          hapCoverage += Math.abs(amt);
          hapCount += 1;
        } else {
          keyCoverage += Math.abs(amt);
          keyCount += 1;
        }
      }
      // If the Total row carries a number, prefer it for totalTested.
      if (selLayout.totalRow !== null) {
        const n = readNumber(
          sheet.getRow(selLayout.totalRow).getCell(selLayout.colAmount).value,
        );
        if (n !== null && n !== 0) totalTested = n;
      }
    }

    // Look anywhere on any sheet for the "Gross AR per TB" label.
    if (grossAr === null) {
      sheet.eachRow({ includeEmpty: false }, (row) => {
        for (let c = 1; c <= sheet.columnCount; c++) {
          const label = readText(row.getCell(c)).trim();
          if (
            /^gross\s+(trade\s+)?(ar|a\/r|accounts?\s+receivable)\s+per\s+tb/i.test(
              label,
            )
          ) {
            for (let cc = c + 1; cc <= sheet.columnCount; cc++) {
              const n = readNumber(row.getCell(cc).value);
              if (n !== null) {
                grossAr = n;
                return;
              }
            }
          }
        }
      });
    }
  }

  if (totalTested === null) totalTested = keyCoverage + hapCoverage;
  if (totalCount === 0 || grossAr === null) return { updates: 0 };

  const keyCoveragePct =
    Math.abs(grossAr) > 0 ? (keyCoverage / Math.abs(grossAr)) * 100 : 0;
  const totalCoveragePct =
    Math.abs(grossAr) > 0
      ? (Math.abs(totalTested) / Math.abs(grossAr)) * 100
      : 0;

  // Below-PM population is the residual after key items: gross AR
  // minus the key-item coverage, spread across (totalCustomers minus
  // keyCount) accounts. We don't have the total customer count from
  // the workpaper directly, so we approximate from the Gross AR / a
  // typical customer balance. Fall back to "remainder" prose if we
  // can't compute it reliably.
  const belowPmTotal = Math.max(0, Math.abs(grossAr) - keyCoverage);

  const fmt$ = (n: number) =>
    `$${Math.round(n).toLocaleString("en-US")}`;
  const word = numberToWord;

  const lines: { matcher: RegExp; replacement: string }[] = [
    {
      matcher: /^\s*targeted\s*\(?key[-\s]?item\)?/i,
      replacement:
        `Targeted (key-item) selection: all invoices equal to or exceeding performance materiality (${fmt$(pm)}) were selected for testing. ` +
        `${word(keyCount)} (${keyCount}) invoices met this threshold, providing coverage of ${fmt$(keyCoverage)} (${keyCoveragePct.toFixed(1)}% of gross AR).`,
    },
    {
      matcher: /^\s*haphazard\s+sample/i,
      replacement:
        `Haphazard sample: from the remaining population below PM (${fmt$(belowPmTotal)} of residual gross AR), ` +
        `${word(hapCount)} (${hapCount}) accounts were selected on a haphazard basis to obtain coverage over the residual population and address the risk of material misstatement in the aggregate.`,
    },
    {
      matcher: /^\s*total\s+items?\s+selected/i,
      replacement:
        `Total items selected: ${totalCount} invoices; aggregate coverage of ${fmt$(Math.abs(totalTested))} (${totalCoveragePct.toFixed(1)}% of gross AR).`,
    },
  ];

  let updates = 0;
  for (const sheet of wb.worksheets) {
    if (!hasSelectionMethodologyHeader(sheet)) continue;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = readText(cell);
        if (!text) return;
        for (const { matcher, replacement } of lines) {
          if (matcher.test(text)) {
            cell.value = replacement;
            updates += 1;
            break;
          }
        }
      });
    });
  }

  return { updates };
}

// ---------------------------------------------------------------------------
// Selections-tab detection (same signature as alt-procedures-rollforward).
// ---------------------------------------------------------------------------

type SelectionsLayout = {
  headerRow: number;
  firstDataRow: number;
  totalRow: number | null;
  colSelNum: number;
  colCustomer: number;
  colAmount: number;
  colBasis: number;
};

function detectSelectionsLayout(
  sheet: ExcelJS.Worksheet,
): SelectionsLayout | null {
  const maxRow = Math.min(60, sheet.rowCount);
  for (let r = 1; r <= maxRow; r++) {
    const row = sheet.getRow(r);
    const cellTexts = new Map<number, string>();
    let hasSel = false;
    let hasCustomer = false;
    let hasAmount = false;
    for (let c = 1; c <= sheet.columnCount; c++) {
      const text = readText(row.getCell(c)).trim();
      cellTexts.set(c, text);
      if (
        /^sel\s*#|^selection\s*#|^item\s*#|^sample\s*#|^#\s*$/i.test(text)
      )
        hasSel = true;
      if (/^customer/i.test(text)) hasCustomer = true;
      if (
        /inv\s*amt|invoice\s*amount|^amount|^balance|^bal\s|^total\s*\$?|^value$/i.test(
          text,
        )
      )
        hasAmount = true;
    }
    if (!(hasSel && hasCustomer && hasAmount)) continue;

    let colSelNum = 0;
    let colCustomer = 0;
    let colAmount = 0;
    let colBasis = 0;
    for (const [c, text] of cellTexts) {
      if (
        /^sel\s*#|^selection\s*#|^item\s*#|^sample\s*#|^#\s*$/i.test(text)
      )
        colSelNum = c;
      else if (/^customer/i.test(text)) colCustomer = c;
      else if (
        /inv\s*amt|invoice\s*amount|^amount|^balance|^bal\s|^total\s*\$?|^value$/i.test(
          text,
        )
      )
        colAmount = c;
      else if (/^basis|^rationale|^reason\b/i.test(text)) colBasis = c;
    }

    const firstDataRow = r + 1;
    let totalRow: number | null = null;
    outer: for (let rr = firstDataRow; rr <= sheet.rowCount; rr++) {
      for (let cc = 1; cc <= sheet.columnCount; cc++) {
        const t = readText(sheet.getRow(rr).getCell(cc)).trim();
        if (/^total\b/i.test(t)) {
          totalRow = rr;
          break outer;
        }
      }
    }

    return {
      headerRow: r,
      firstDataRow,
      totalRow,
      colSelNum,
      colCustomer,
      colAmount,
      colBasis,
    };
  }
  return null;
}

// Detect whether a Basis cell text reads "haphazard" (vs. the
// auto-included key-item variants like "Key >PM", "Top-tier", etc.).
function isHaphazardBasis(basis: string): boolean {
  return /haphazard|random/i.test(basis);
}

function hasSelectionMethodologyHeader(sheet: ExcelJS.Worksheet): boolean {
  let found = false;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      if (found) return;
      const text = readText(cell).toLowerCase();
      if (/\bselection\s+methodology\b/.test(text)) found = true;
    });
  });
  return found;
}

function numberToWord(n: number): string {
  const words = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
    "eleven",
    "twelve",
    "thirteen",
    "fourteen",
    "fifteen",
    "sixteen",
    "seventeen",
    "eighteen",
    "nineteen",
    "twenty",
  ];
  if (Number.isInteger(n) && n >= 0 && n < words.length) {
    return words[n][0].toUpperCase() + words[n].slice(1);
  }
  return String(n);
}

function readNumber(v: ExcelJS.CellValue | undefined): number | null {
  if (typeof v === "number") return v;
  if (v != null && typeof v === "object" && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "number") return r;
  }
  return null;
}

function readText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (
      "richText" in v &&
      Array.isArray((v as { richText: unknown[] }).richText)
    ) {
      return (v as { richText: { text?: string }[] }).richText
        .map((rt) => rt.text ?? "")
        .join("");
    }
    if ("text" in v && typeof (v as { text: unknown }).text === "string") {
      return (v as { text: string }).text;
    }
    if ("result" in v) {
      const r = (v as { result: unknown }).result;
      if (typeof r === "string") return r;
    }
  }
  return "";
}
