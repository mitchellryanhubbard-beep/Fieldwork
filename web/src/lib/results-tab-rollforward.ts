import ExcelJS from "exceljs";

// Refreshes summary cells on the "Results" tab after the Selections
// tab has been rolled forward with CY customers. The Selections-tab
// values (Total tested, customer count) feed the Results-tab summary
// rows ("Dollar coverage of selections", "Total items selected",
// "Coverage % of gross AR", etc.).
//
// Standalone pass that runs AFTER both the alt-procedures-rollforward
// (which writes CY customers + amounts into the Selections table) AND
// the methodology-rollforward (which writes Gross AR per TB). It
// reads the now-CY data from the Selections tab and propagates the
// totals downstream so the Results tab matches.

export type ResultsTabRolloverResult = {
  updates: number;
};

export function rolloverResultsTab(
  wb: ExcelJS.Workbook,
): ResultsTabRolloverResult {
  // 1) Find the Selections tab + sum the amount column.
  const sel = findSelectionsTab(wb);
  if (!sel) return { updates: 0 };
  const { sheet: selSheet, layout: selLayout } = sel;

  let totalSelected = 0;
  let selectionCount = 0;
  let keyCount = 0;
  let hapCount = 0;
  const stopRow =
    selLayout.totalRow !== null ? selLayout.totalRow : selSheet.rowCount + 1;
  for (let r = selLayout.firstDataRow; r < stopRow; r++) {
    const cell = selSheet.getRow(r).getCell(selLayout.colAmount);
    const n = readNumber(cell.value);
    if (n === null || n === 0) continue;
    totalSelected += n;
    selectionCount += 1;
    // Bucket by the row's Basis column (Key / Haphazard / etc.) so
    // the Results tab's Key/Haphazard count cells match the Total.
    // When no Basis column exists, default everything to key items.
    if (selLayout.colBasis > 0) {
      const basis = readText(selSheet.getRow(r).getCell(selLayout.colBasis))
        .trim()
        .toLowerCase();
      if (/haphazard|random/.test(basis)) hapCount += 1;
      else keyCount += 1;
    } else {
      keyCount += 1;
    }
  }
  // If the workpaper's own Total row carries a number, prefer it — it
  // reflects whatever formula the auditor authored (including special
  // handling like "key items only"). Falls back to the sum above.
  if (selLayout.totalRow !== null) {
    const totalCell = selSheet
      .getRow(selLayout.totalRow)
      .getCell(selLayout.colAmount);
    const n = readNumber(totalCell.value);
    if (n !== null && n !== 0) totalSelected = n;
  }
  if (selectionCount === 0) return { updates: 0 };

  // 2) Capture the Gross AR per TB value if it's labelled anywhere on
  // any sheet — needed for the Coverage % computation. Walk every cell
  // and grab the first numeric to the right of the matching label.
  let grossArPerTb: number | null = null;
  for (const sheet of wb.worksheets) {
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
              grossArPerTb = n;
              return;
            }
          }
        }
      }
    });
    if (grossArPerTb !== null) break;
  }

  // 3) Walk every sheet looking for the Results-tab summary labels.
  // For each, write the computed value into the first numeric (or
  // empty) cell to the right.
  let updates = 0;
  for (const sheet of wb.worksheets) {
    sheet.eachRow({ includeEmpty: false }, (row) => {
      for (let c = 1; c <= sheet.columnCount; c++) {
        const label = readText(row.getCell(c)).trim();
        if (!label) continue;
        const replacement = computeReplacement(label, {
          totalSelected,
          selectionCount,
          keyCount,
          hapCount,
          grossArPerTb,
        });
        if (replacement === null) continue;
        // Find the first numeric / formula / empty cell to the right
        // of the label cell. Prefer preserving an existing formula —
        // just update its cached result so the display is right until
        // Excel recomputes on open. Only overwrite with a static value
        // when the cell is plain numeric or empty.
        for (let cc = c + 1; cc <= sheet.columnCount; cc++) {
          const target = row.getCell(cc);
          const tv = target.value;
          const hasFormula =
            tv != null &&
            typeof tv === "object" &&
            "formula" in tv &&
            typeof (tv as { formula: unknown }).formula === "string";
          if (hasFormula) {
            target.value = {
              ...(tv as object),
              result: replacement,
            } as ExcelJS.CellValue;
            updates += 1;
            break;
          }
          const isNumeric = typeof tv === "number";
          if (isNumeric || tv == null) {
            target.value = replacement;
            updates += 1;
            break;
          }
        }
      }
    });
  }
  return { updates };
}

function computeReplacement(
  label: string,
  ctx: {
    totalSelected: number;
    selectionCount: number;
    keyCount: number;
    hapCount: number;
    grossArPerTb: number | null;
  },
): number | null {
  if (/^dollar\s+coverage\s+of\s+selections/i.test(label)) {
    return ctx.totalSelected;
  }
  if (/^total\s+items?\s+selected/i.test(label)) {
    return ctx.selectionCount;
  }
  // "Key items selected (> PM)" — count of rows whose Basis isn't
  // haphazard/random. Anchored to "key" at the start so it doesn't
  // catch e.g. "Critical items reviewed".
  if (/^key\s+items?\s+selected/i.test(label)) {
    return ctx.keyCount;
  }
  // "Haphazard items selected (< PM)" — count of rows whose Basis
  // reads haphazard or random.
  if (/^haphazard\s+items?\s+selected/i.test(label)) {
    return ctx.hapCount;
  }
  if (
    /^coverage\s+%?\s+of\s+gross\s+(trade\s+)?(ar|a\/r|accounts?\s+receivable)/i.test(
      label,
    ) &&
    ctx.grossArPerTb !== null &&
    Math.abs(ctx.grossArPerTb) > 0
  ) {
    return Math.abs(ctx.totalSelected) / Math.abs(ctx.grossArPerTb);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Selections tab detection (matches the alt-procedures-rollforward
// shape — Sel # + Customer + Amount column).
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

function findSelectionsTab(wb: ExcelJS.Workbook): {
  sheet: ExcelJS.Worksheet;
  layout: SelectionsLayout;
} | null {
  for (const sheet of wb.worksheets) {
    const layout = detectSelectionsLayout(sheet);
    if (layout) return { sheet, layout };
  }
  return null;
}

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
      ) {
        hasSel = true;
      }
      if (/^customer/i.test(text)) hasCustomer = true;
      if (
        /inv\s*amt|invoice\s*amount|^amount|^balance|^bal\s|^total\s*\$?|^value$/i.test(
          text,
        )
      ) {
        hasAmount = true;
      }
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
    // Scan ALL columns for a "Total" / "Total tested" label. The label
    // commonly sits in column A or B, but some templates put it in
    // column C (e.g. when columns A and B are #/Customer respectively).
    outer: for (let rr = firstDataRow; rr <= sheet.rowCount; rr++) {
      for (let cc = 1; cc <= sheet.columnCount; cc++) {
        const text = readText(sheet.getRow(rr).getCell(cc)).trim();
        if (/^total\b/i.test(text)) {
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

// ---------------------------------------------------------------------------
// Cell helpers
// ---------------------------------------------------------------------------

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
