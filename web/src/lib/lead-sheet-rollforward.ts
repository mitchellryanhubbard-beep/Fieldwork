import ExcelJS from "exceljs";
import type { TrialBalance } from "@/lib/tb-parser";

// PY workpapers commonly include a lead-sheet tab that reconciles a
// FSLI's GL accounts to the audited net figure. Standard layout:
//
//   Account                                  | Per G/L (TB) | Per Audit | Difference | W/P Ref
//   Accounts Receivable — Trade (acct 1200)  | $14,200,000  | $14,200,000 | -        | B-2 / B-3
//   Allowance for Doubtful Accounts (acct 1290) | ($720,000) | ($720,000)  | -        | B-4
//   Accounts receivable, net                 | $13,480,000  | $13,480,000 | -        | B-1
//
// When rolling forward, every dollar cell in the Per G/L + Per Audit
// columns needs to refresh against the CY TB. Difference becomes a
// formula (Per Audit - Per G/L) so any auditor adjustment to Per Audit
// flows through. The bold "net" row sums the components.
//
// Per Audit defaults to the same value as Per G/L — the auditor edits
// in place after seeing the analytics + testing results. Easier than
// leaving blank, since the PY had it filled.

export type LeadSheetRolloverResult = {
  handledSheets: Set<string>;
  updates: number;
};

export function rolloverLeadSheets(
  wb: ExcelJS.Workbook,
  trialBalance: TrialBalance | null,
): LeadSheetRolloverResult {
  const handled = new Set<string>();
  let updates = 0;
  if (!trialBalance) return { handledSheets: handled, updates };

  const balanceByAcct = new Map<string, number>();
  for (const a of trialBalance.accounts) {
    balanceByAcct.set(a.acctNum, a.cyBalance);
  }

  for (const sheet of wb.worksheets) {
    const layout = detectLeadSheetLayout(sheet);
    if (!layout) continue;
    handled.add(sheet.name);

    // Walk the data rows. Each row either matches an account # (we
    // refresh dollars) or it's the bold net/total row (we sum the
    // components above). Stop when we hit a blank account cell after
    // having processed at least one row.
    const componentRows: number[] = [];
    let netRow: number | null = null;

    for (let r = layout.firstDataRow; r <= layout.maxScanRow; r++) {
      const accountText = readText(sheet.getRow(r).getCell(layout.colAccount))
        .trim();
      if (!accountText) {
        if (componentRows.length > 0) break;
        continue;
      }
      const acctMatch = accountText.match(/\(acct\s*(\d+)\)/i);
      if (acctMatch) {
        const acctNum = acctMatch[1];
        const cyBalance = balanceByAcct.get(acctNum);
        if (cyBalance === undefined) continue;
        setNumber(sheet, r, layout.colPerGl, cyBalance);
        setNumber(sheet, r, layout.colPerAudit, cyBalance);
        setFormula(
          sheet,
          r,
          layout.colDifference,
          `${colLetter(layout.colPerAudit)}${r}-${colLetter(layout.colPerGl)}${r}`,
          0,
        );
        componentRows.push(r);
        updates += 3;
        continue;
      }
      // No (acct XXXX) marker — could be the net row, or a footer line.
      // The net row sits directly after the components, usually bold
      // and contains "net" / "total".
      if (
        /\b(net|total)\b/i.test(accountText) &&
        componentRows.length > 0 &&
        netRow === null
      ) {
        netRow = r;
        break;
      }
    }

    // Net row: SUM the component rows for Per G/L + Per Audit.
    let netCyBalance = 0;
    if (netRow !== null && componentRows.length > 0) {
      const firstC = componentRows[0];
      const lastC = componentRows[componentRows.length - 1];
      const perGlL = colLetter(layout.colPerGl);
      const perAuL = colLetter(layout.colPerAudit);
      const perAuR = colLetter(layout.colPerAudit);
      const perGlR = colLetter(layout.colPerGl);
      // Compute the expected net so cached results match.
      for (const cr of componentRows) {
        const v = balanceByAcct.get(
          (
            readText(sheet.getRow(cr).getCell(layout.colAccount))
              .match(/\(acct\s*(\d+)\)/i)?.[1] ?? ""
          ).trim(),
        );
        netCyBalance += v ?? 0;
      }
      setFormula(
        sheet,
        netRow,
        layout.colPerGl,
        `SUM(${perGlL}${firstC}:${perGlR}${lastC})`,
        netCyBalance,
      );
      setFormula(
        sheet,
        netRow,
        layout.colPerAudit,
        `SUM(${perAuL}${firstC}:${perAuR}${lastC})`,
        netCyBalance,
      );
      setFormula(
        sheet,
        netRow,
        layout.colDifference,
        `${colLetter(layout.colPerAudit)}${netRow}-${colLetter(layout.colPerGl)}${netRow}`,
        0,
      );
      updates += 3;
    }

    // Refresh the in-narrative net-$ figure in the Tie-out paragraph.
    // The PY template has a phrase like "... net AR of $13,480,000
    // agrees to the audited financial statements." Replace the dollar
    // amount with the CY net total wherever it appears below the
    // table.
    if (netRow !== null && netCyBalance !== 0) {
      const newNetText = `$${Math.round(netCyBalance).toLocaleString("en-US")}`;
      for (let r = netRow + 1; r <= layout.maxScanRow; r++) {
        for (let c = 1; c <= sheet.columnCount; c++) {
          const cell = sheet.getRow(r).getCell(c);
          const v = cell.value;
          if (typeof v === "number" && Math.abs(v) > 1) {
            // Standalone net figure in its own cell (right side of the
            // tie-out narrative). Update.
            cell.value = netCyBalance;
            updates += 1;
          } else if (typeof v === "string" && /\$[\d,]+/.test(v)) {
            const next = v.replace(/\$[\d,]+(?:\.\d+)?/g, newNetText);
            if (next !== v) {
              cell.value = next;
              updates += 1;
            }
          }
        }
      }
    }
  }

  return { handledSheets: handled, updates };
}

type LeadSheetLayout = {
  headerRow: number;
  firstDataRow: number;
  maxScanRow: number;
  colAccount: number;
  colPerGl: number;
  colPerAudit: number;
  colDifference: number;
};

function detectLeadSheetLayout(
  sheet: ExcelJS.Worksheet,
): LeadSheetLayout | null {
  const maxRow = Math.min(60, sheet.rowCount);
  const maxCol = Math.min(20, sheet.columnCount);
  for (let r = 1; r <= maxRow; r++) {
    let colAccount = 0;
    let colPerGl = 0;
    let colPerAudit = 0;
    let colDifference = 0;
    for (let c = 1; c <= maxCol; c++) {
      const text = readText(sheet.getRow(r).getCell(c)).trim();
      if (/^account$/i.test(text)) colAccount = c;
      else if (/^per\s+g\/?l|^per\s+tb|^per\s+books/i.test(text)) colPerGl = c;
      else if (/^per\s+audit|^audit(?:ed)?\s+balance/i.test(text))
        colPerAudit = c;
      else if (/^difference|^diff\b|^variance/i.test(text)) colDifference = c;
    }
    if (colAccount && colPerGl && colPerAudit && colDifference) {
      return {
        headerRow: r,
        firstDataRow: r + 1,
        maxScanRow: sheet.rowCount,
        colAccount,
        colPerGl,
        colPerAudit,
        colDifference,
      };
    }
  }
  return null;
}

function setNumber(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  value: number,
): void {
  if (col <= 0) return;
  sheet.getRow(row).getCell(col).value = value;
}

function setFormula(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
  formula: string,
  result: number,
): void {
  if (col <= 0) return;
  sheet.getRow(row).getCell(col).value = {
    formula,
    result,
  } as ExcelJS.CellValue;
}

function readText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("richText" in v && Array.isArray((v as { richText: unknown[] }).richText)) {
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

function colLetter(col: number): string {
  let s = "";
  let n = col;
  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(65 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }
  return s;
}
