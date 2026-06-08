import ExcelJS from "exceljs";
import type { TrialBalance } from "@/lib/tb-parser";

// Walks every cell in the workbook. Any cell whose numeric value
// matches a PY TB balance (exact, to 2 decimal places) gets replaced
// with that account's CY balance — regardless of whether the cell is
// labeled "PY", embedded in a narrative, or sitting alone next to an
// auditor-written reference like "Gross AR per TB (acct 1200)".
//
// Rationale: PY workpapers paste TB-balance figures all over the place
// (lead sheet, methodology population row, results gross-AR row,
// narrative tie-outs, etc.). Labeled-cell logic catches the most
// common spots but misses the long tail. A value-only sweep catches
// the long tail without writing case-by-case detection for every
// template variant.
//
// Safety guards to keep false-positive rate low:
//   - Skip PY balances whose absolute value is < $1,000 (too common
//     to coincide with unrelated cells like row indices).
//   - Skip zero PY balances.
//   - Exact equality (after rounding to 2 decimals); no fuzzy match.
//
// For formula cells, we overwrite the formula too — the auditor would
// have to re-author the formula if they want one, but the alternative
// (leaving a stale PY-driven formula) is worse.
export function rolloverPyBalances(
  wb: ExcelJS.Workbook,
  trialBalance: TrialBalance | null,
): { updates: number } {
  if (!trialBalance) return { updates: 0 };

  const pyToCy = new Map<number, number>();
  for (const a of trialBalance.accounts) {
    const py = roundTo2(a.pyBalance);
    if (py === 0 || Math.abs(py) < 1000) continue;
    // If two accounts happen to share a PY balance, the later one
    // wins. Vanishingly rare and not worth the complexity to handle.
    pyToCy.set(py, roundTo2(a.cyBalance));
  }
  if (pyToCy.size === 0) return { updates: 0 };

  let updates = 0;
  for (const sheet of wb.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const v = cell.value;
        let n: number | null = null;
        if (typeof v === "number") n = v;
        else if (
          v &&
          typeof v === "object" &&
          "result" in v &&
          typeof (v as { result: unknown }).result === "number"
        ) {
          n = (v as { result: number }).result;
        }
        if (n === null) return;
        const rounded = roundTo2(n);
        const cy = pyToCy.get(rounded);
        if (cy === undefined) return;
        if (cy === rounded) return;
        // Preserve any existing formula — just refresh the cached
        // result. Excel recomputes on open, so if the formula
        // references TB-driven cells we've also updated, the final
        // result will be correct.
        if (
          v != null &&
          typeof v === "object" &&
          "formula" in v &&
          typeof (v as { formula: unknown }).formula === "string"
        ) {
          cell.value = {
            ...(v as object),
            result: cy,
          } as ExcelJS.CellValue;
        } else {
          cell.value = cy;
        }
        updates++;
      });
    });
  }
  return { updates };
}

function roundTo2(n: number): number {
  return Math.round(n * 100) / 100;
}
