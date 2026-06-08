import ExcelJS from "exceljs";
import type { ArAging, ArInvoice } from "@/lib/ar-aging-parser";
import type { SubsequentCashReceipts } from "@/lib/scr-parser";
import {
  METHODOLOGIES,
  type SampleResult,
} from "@/lib/sampling-methodologies";
import type { AssertionMatrix } from "@/lib/assertion-matrix";
import {
  computeWrappedRowHeight,
  findTitleEndRow,
  hasExistingProcedureBox,
} from "@/lib/procedure-boxes";

// When rolling forward an Alternative-Procedures workpaper, the PY
// selections (specific PY customers/invoices/receipts) are not valid
// evidence for the CY audit — the procedure must be re-performed with
// new selections drawn from the CY population using the defined
// sampling methodology.
//
// Flow (per the audit, not just the rollforward mechanics):
//   - Sample: customer-level selections from the engagement's
//     configured Existence sampling methodology (highCoverageHybrid,
//     MUS, risk-based table). Selection is INDEPENDENT of whether the
//     SCR file will cover the selected customers — otherwise it's not
//     a valid existence test.
//   - Per customer, pick the customer's largest open invoice from the
//     AR Aging as the representative item to test.
//   - Procedure: trace that invoice into the Subsequent Cash Receipts
//     file. A matching receipt collected after YE is positive
//     existence evidence; no match → flag as "no subsequent receipt".
//
// We detect the standard layout (Sel # / Customer / Invoice # / Inv
// Amt / Aging / Alt Procedure / Evidence / Amt Verified / Fully
// Covered / Auditor Conclusion), clear the PY rows, and populate.

export function regenerateAltProceduresSelections(
  wb: ExcelJS.Workbook,
  scr: SubsequentCashReceipts | null,
  aging: ArAging | null,
  sample: SampleResult | null,
  matrix: AssertionMatrix | null,
): number {
  if (!aging || aging.invoices.length === 0) return 0;
  if (!sample || sample.selections.length === 0) return 0;

  // Index SCR receipts by invoice # — one invoice may collect via
  // multiple receipts (partials), so keep the list.
  const receiptsByInvoice = new Map<string, ScrReceiptLike[]>();
  if (scr) {
    for (const r of scr.receipts) {
      const list = receiptsByInvoice.get(r.invoiceNum) ?? [];
      list.push(r);
      receiptsByInvoice.set(r.invoiceNum, list);
    }
  }

  // Index aging invoices by custNum so we can find each sampled
  // customer's largest invoice.
  const invoicesByCust = new Map<string, ArInvoice[]>();
  for (const inv of aging.invoices) {
    if (inv.total <= 0) continue;
    const list = invoicesByCust.get(inv.custNum) ?? [];
    list.push(inv);
    invoicesByCust.set(inv.custNum, list);
  }

  let modified = 0;
  for (const sheet of wb.worksheets) {
    const layout = detectLayout(sheet);
    if (!layout) continue;

    // Procedure box is written AFTER selections are picked so the
    // description can honestly note when the workpaper template can't
    // fit the full sample.

    // Take the methodology's full selection list in its natural order
    // (top-tier first, then random fill). Drop sampled customers we
    // can't find invoices for — they'd require manual handling. For
    // each kept customer, the representative test item is their
    // largest open invoice.
    type Pick = { invoice: ArInvoice; reason: string };
    const picks: Pick[] = [];
    for (const sel of sample.selections) {
      const candidates = invoicesByCust.get(sel.custNum);
      if (!candidates || candidates.length === 0) continue;
      const largest = [...candidates].sort((a, b) => b.total - a.total)[0];
      picks.push({ invoice: largest, reason: sel.reason });
    }

    // Resize the data section to fit the sample exactly. Expanding
    // inserts empty rows just before the Total row (so Total +
    // Conclusion shift down with their formatting intact), then copies
    // styling from the last existing data row onto the inserted rows.
    // Shrinking removes trailing data rows.
    const templateRowCount = layout.lastDataRow - layout.firstDataRow + 1;
    const sampleRowCount = picks.length;
    const rowDelta = sampleRowCount - templateRowCount;
    if (rowDelta > 0) {
      // Capture style from the last data row before inserting.
      const styleRow = layout.lastDataRow;
      const styleCells = new Map<number, Partial<ExcelJS.Style>>();
      for (let c = 1; c <= layout.maxCol; c++) {
        styleCells.set(
          c,
          { ...sheet.getRow(styleRow).getCell(c).style },
        );
      }
      const emptyRows: ExcelJS.CellValue[][] = [];
      for (let i = 0; i < rowDelta; i++) emptyRows.push([]);
      sheet.spliceRows(layout.lastDataRow + 1, 0, ...emptyRows);
      // ExcelJS spliceRows doesn't auto-shift formula refs that point
      // to rows past the insertion point — so a "=D8/D11" formula
      // sitting below the table would still reference D8/D11 after
      // rows were inserted above it, even though those cells now
      // point to different content. Walk all formula cells and shift
      // any row ref >= the insertion point.
      shiftFormulaRowRefs(sheet, layout.lastDataRow + 1, rowDelta);
      // Apply the captured style to each inserted row's cells.
      for (
        let r = layout.lastDataRow + 1;
        r <= layout.lastDataRow + rowDelta;
        r++
      ) {
        for (let c = 1; c <= layout.maxCol; c++) {
          const style = styleCells.get(c);
          if (style) {
            sheet.getRow(r).getCell(c).style = style as ExcelJS.Style;
          }
        }
      }
    } else if (rowDelta < 0) {
      sheet.spliceRows(layout.firstDataRow + sampleRowCount, -rowDelta);
      // Same formula-ref shift after a delete — refs pointing to
      // rows past the removed range need to come UP by |rowDelta|.
      shiftFormulaRowRefs(
        sheet,
        layout.firstDataRow + sampleRowCount,
        rowDelta,
      );
    }
    const effectiveFirstDataRow = layout.firstDataRow;
    const effectiveLastDataRow = layout.firstDataRow + sampleRowCount - 1;
    const effectiveTotalRow =
      layout.totalRow !== null ? layout.totalRow + rowDelta : null;

    // Clear all data rows (incl. any we just duplicated).
    for (let r = effectiveFirstDataRow; r <= effectiveLastDataRow; r++) {
      for (let c = 1; c <= sheet.columnCount; c++) {
        sheet.getRow(r).getCell(c).value = null;
      }
    }

    // Populate fresh CY selection rows.
    let totalVerified = 0;
    let totalSelected = 0;
    let countFull = 0;
    let countPartial = 0;
    let countUncovered = 0;
    for (let i = 0; i < picks.length; i++) {
      const { invoice } = picks[i];
      const receipts = receiptsByInvoice.get(invoice.invoiceNum) ?? [];
      const amountVerified = receipts.reduce(
        (acc, r) => acc + (r.amountReceived > 0 ? r.amountReceived : 0),
        0,
      );
      const outstanding = invoice.total - amountVerified;
      const hasReceipt = receipts.length > 0;
      const fullyCovered = !hasReceipt
        ? "No"
        : outstanding <= 0.01
          ? "Yes"
          : "Partial";

      const evidence = hasReceipt
        ? receipts
            .map(
              (r) =>
                `${r.receiptNum} — $${r.amountReceived.toLocaleString("en-US")} rcvd ${formatShortDate(r.receiptDate)}`,
            )
            .join("; ")
        : "No subsequent receipt traced";

      const conclusion = !hasReceipt
        ? "✗ No subsequent collection — escalate (alternative evidence required)"
        : outstanding <= 0.01
          ? `✓ Fully collected post-YE — existence confirmed`
          : `Partial collection — $${outstanding.toLocaleString("en-US")} remaining; consider additional procedures`;

      totalVerified += amountVerified;
      totalSelected += invoice.total;
      if (!hasReceipt) countUncovered += 1;
      else if (outstanding <= 0.01) countFull += 1;
      else countPartial += 1;

      const row = sheet.getRow(effectiveFirstDataRow + i);
      setCell(row, layout.colSelNum, i + 1);
      setCell(row, layout.colCustomer, invoice.custName);
      setCell(row, layout.colInvoiceNum, invoice.invoiceNum);
      setCell(row, layout.colInvAmt, invoice.total);
      setCell(row, layout.colAging, agingBucketLabel(invoice));
      setCell(row, layout.colAltProc, "Subsequent Cash Receipt");
      setCell(row, layout.colEvidence, evidence);
      setCell(row, layout.colVerified, amountVerified);
      setCell(row, layout.colFullyCovered, fullyCovered);
      setCell(row, layout.colConclusion, conclusion);
    }
    modified += picks.length;

    // Refresh the Total row's SUM formulas so the range covers exactly
    // the populated rows. Sum both the Invoice Amount column (always
    // present on these layouts — drives the lead-sheet tie-out) and
    // the Verified column (when present — alt-procedure layouts only).
    if (effectiveTotalRow !== null && picks.length > 0) {
      if (layout.colInvAmt > 0) {
        const colL = colNumToLetter(layout.colInvAmt);
        sheet.getRow(effectiveTotalRow).getCell(layout.colInvAmt).value = {
          formula: `SUM(${colL}${effectiveFirstDataRow}:${colL}${effectiveLastDataRow})`,
          result: totalSelected,
        };
      }
      if (layout.colVerified > 0) {
        const colL = colNumToLetter(layout.colVerified);
        sheet.getRow(effectiveTotalRow).getCell(layout.colVerified).value = {
          formula: `SUM(${colL}${effectiveFirstDataRow}:${colL}${effectiveLastDataRow})`,
          result: totalVerified,
        };
      }
    }

    // Replace the overall conclusion with one that reflects the actual
    // results — covered / partial / uncovered counts and verified $.
    updateOverallConclusion(sheet, {
      total: picks.length,
      countFull,
      countPartial,
      countUncovered,
      totalVerified,
      totalSelected,
    });

    // Only stamp our auto-generated procedure box if the PY auditor
    // didn't already author one. Otherwise leave the existing text
    // intact so their language flows through verbatim.
    if (!hasExistingProcedureBox(sheet)) {
      writeTestingProcedureBox(sheet, layout, sample, picks.length, matrix);
    }
  }
  return modified;
}

type ScrReceiptLike = SubsequentCashReceipts["receipts"][number];

type Layout = {
  colSelNum: number;
  colCustomer: number;
  colInvoiceNum: number;
  colInvAmt: number;
  colAging: number;
  colAltProc: number;
  colEvidence: number;
  colVerified: number;
  colFullyCovered: number;
  colConclusion: number;
  colBasis: number;
  colException: number;
  firstDataRow: number;
  lastDataRow: number;
  totalRow: number | null;
  // Row holding the section banner ("NON-RESPONSES — ALTERNATIVE
  // PROCEDURE DETAIL") — used to place the Testing Procedure box just
  // above it.
  sectionHeaderRow: number | null;
  // Last column the workpaper actually uses — for merging the
  // procedure-box cell to span the full width.
  maxCol: number;
};

function detectLayout(sheet: ExcelJS.Worksheet): Layout | null {
  for (let r = 1; r <= sheet.rowCount; r++) {
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
    // Sel # + Customer + Amount is enough to detect a testing table.
    // Invoice # and Alt-Procedure / Evidence / etc. all become optional
    // so customer-level multi-assertion detail-testing layouts match
    // alongside the invoice-level alt-procedure layouts.
    if (!(hasSel && hasCustomer && hasAmount)) continue;

    let colSelNum = 0;
    let colCustomer = 0;
    let colInvoiceNum = 0;
    let colInvAmt = 0;
    let colAging = 0;
    let colAltProc = 0;
    let colEvidence = 0;
    let colVerified = 0;
    let colFullyCovered = 0;
    let colConclusion = 0;
    let colBasis = 0;
    let colException = 0;
    for (const [c, text] of cellTexts) {
      if (
        /^sel\s*#|^selection\s*#|^item\s*#|^sample\s*#|^#\s*$/i.test(text)
      )
        colSelNum = c;
      else if (/^customer/i.test(text)) colCustomer = c;
      else if (/^invoice\s*#/i.test(text)) colInvoiceNum = c;
      else if (
        /inv\s*amt|invoice\s*amount|^amount|^balance|^bal\s|^total\s*\$?|^value$/i.test(
          text,
        )
      )
        colInvAmt = c;
      else if (/^aging/i.test(text)) colAging = c;
      else if (/^alt(ernative)?\s+procedure/i.test(text)) colAltProc = c;
      else if (/^evidence/i.test(text)) colEvidence = c;
      else if (/amt\s*verified|verified\s*\$/i.test(text)) colVerified = c;
      else if (/fully\s*covered|^covered\??$/i.test(text)) colFullyCovered = c;
      else if (/conclusion/i.test(text)) colConclusion = c;
      else if (/^basis|^rationale|^reason\b/i.test(text)) colBasis = c;
      else if (/^exception\??/i.test(text)) colException = c;
    }

    const firstDataRow = r + 1;
    let lastDataRow = firstDataRow;
    let totalRow: number | null = null;
    for (let rr = firstDataRow; rr <= sheet.rowCount; rr++) {
      for (let cc = 1; cc <= sheet.columnCount; cc++) {
        const text = readText(sheet.getRow(rr).getCell(cc)).trim();
        if (/^total\b/i.test(text)) {
          totalRow = rr;
          break;
        }
      }
      if (totalRow !== null) {
        lastDataRow = totalRow - 1;
        break;
      }
    }
    if (totalRow === null) lastDataRow = sheet.rowCount;

    // Walk back from the column header to find the section banner row
    // (e.g. "NON-RESPONSES — ALTERNATIVE PROCEDURE DETAIL"). It's the
    // last non-empty row above the column headers.
    let sectionHeaderRow: number | null = null;
    for (let rr = r - 1; rr >= 1; rr--) {
      const text = readText(sheet.getRow(rr).getCell(1)).trim();
      if (text) {
        sectionHeaderRow = rr;
        break;
      }
    }

    const maxCol = Math.max(
      colSelNum,
      colCustomer,
      colInvoiceNum,
      colInvAmt,
      colAging,
      colAltProc,
      colEvidence,
      colVerified,
      colFullyCovered,
      colConclusion,
      colBasis,
      colException,
    );

    return {
      colSelNum,
      colCustomer,
      colInvoiceNum,
      colInvAmt,
      colAging,
      colAltProc,
      colEvidence,
      colVerified,
      colFullyCovered,
      colConclusion,
      colBasis,
      colException,
      firstDataRow,
      lastDataRow,
      totalRow,
      sectionHeaderRow,
      maxCol,
    };
  }
  return null;
}

// Writes a "TESTING PROCEDURE" box into the empty row just above the
// section banner. Uses a merged cell so the description spans the full
// table width, with wrap-text on and an enlarged row height. Idempotent:
// re-running overwrites the existing box. Falls back gracefully if the
// expected empty row is missing.
function writeTestingProcedureBox(
  sheet: ExcelJS.Worksheet,
  layout: Layout,
  sample: SampleResult | null,
  documentedCount: number,
  matrix: AssertionMatrix | null,
): void {
  // Place directly under the "WP Reference: …" title line so the box
  // lands in the same visual spot across every workpaper. Fall back to
  // the row above the section banner when the title line isn't found.
  const titleEndRow = findTitleEndRow(sheet);
  const targetRow = titleEndRow
    ? titleEndRow + 1
    : layout.sectionHeaderRow
      ? layout.sectionHeaderRow - 1
      : -1;
  if (targetRow < 1) return;

  const description = buildProcedureDescription(
    sample,
    documentedCount,
    matrix,
  );
  const colA = "A";
  const colMax = colNumToLetter(layout.maxCol);
  const range = `${colA}${targetRow}:${colMax}${targetRow}`;

  // If the row was previously merged (e.g. from a prior regeneration),
  // unmerge so we can safely re-set the value, then merge again.
  try {
    sheet.unMergeCells(range);
  } catch {
    // already unmerged — ignore
  }
  // Clear all cells in the target row first so stray values don't show
  // through after the merge collapses.
  for (let c = 1; c <= layout.maxCol; c++) {
    sheet.getRow(targetRow).getCell(c).value = null;
  }
  const cell = sheet.getRow(targetRow).getCell(1);
  cell.value = description;
  try {
    sheet.mergeCells(range);
  } catch {
    // merge can fail if range overlaps an existing merge that wasn't
    // ours — write the value without merging in that case.
  }
  cell.alignment = {
    wrapText: true,
    vertical: "top",
    horizontal: "left",
  };
  sheet.getRow(targetRow).height = computeWrappedRowHeight(
    sheet,
    1,
    layout.maxCol,
    description,
  );
}

function buildProcedureDescription(
  sample: SampleResult | null,
  documentedCount: number,
  matrix: AssertionMatrix | null,
): string {
  const rationale = arApproachRationale(matrix);
  const ratPrefix = rationale ? `SCOPING RATIONALE (AR): ${rationale}\n\n` : "";
  if (!sample) {
    return (
      ratPrefix +
      "TESTING PROCEDURE: For the existence assertion on Accounts " +
      "Receivable, identified customer balances for alternative " +
      "procedures, then traced each into the engagement's Subsequent " +
      "Cash Receipts file. Documented the receipt as evidence where " +
      "subsequent collection occurred; flagged uncovered items for " +
      "additional procedures (shipping documents, signed BOL, or " +
      "direct customer credit confirmation)."
    );
  }
  const methLabel =
    METHODOLOGIES[sample.methodology]?.label ?? sample.methodology;
  const seedFrag = `seed ${sample.seed}`;
  let paramsFrag = "";
  if (sample.methodology === "highCoverageHybrid") {
    const p = sample.params;
    paramsFrag =
      ` (top-tier > ${Math.round(p.topTierPmPct * 100)}% of PM, ` +
      `target coverage ${Math.round(p.targetCoveragePct * 100)}%)`;
  } else if (sample.methodology === "musStatistical") {
    const p = sample.params;
    paramsFrag =
      ` (sampling interval $${Math.round(p.samplingInterval).toLocaleString("en-US")}, ` +
      `confidence factor ${p.confidenceFactor})`;
  } else if (sample.methodology === "riskBasedTable") {
    const p = sample.params;
    paramsFrag = ` (${p.riskLevel} risk, target size ${p.targetSize})`;
  }
  const coverage = Math.round(sample.coveragePct * 1000) / 10;
  const sampleSize = sample.selections.length;
  const capacityNote =
    documentedCount < sampleSize
      ? ` Workpaper template documents the top ${documentedCount} selections (by methodology order); remaining ${sampleSize - documentedCount} require an expanded sample table or follow-up sheet.`
      : "";
  return (
    ratPrefix +
    `TESTING PROCEDURE: For the existence assertion on Accounts ` +
    `Receivable, drew a sample of ${sampleSize} customer balances from ` +
    `the CY AR aging (population ${sample.populationCount} customers, ` +
    `$${Math.round(sample.populationTotal).toLocaleString("en-US")}) ` +
    `using ${methLabel}${paramsFrag}, ${seedFrag}. Coverage = ` +
    `${coverage}% of population $. For each selected customer, ` +
    `identified the largest open invoice from the AR Aging detail and ` +
    `traced it into the Subsequent Cash Receipts file to verify ` +
    `existence post-YE. Documented the matched receipt(s) as evidence ` +
    `where coverage exists; flagged uncovered items for additional ` +
    `alternative procedures (shipping documents, signed BOL, or direct ` +
    `customer credit confirmation).${capacityNote}`
  );
}

function arApproachRationale(matrix: AssertionMatrix | null): string | null {
  if (!matrix) return null;
  const row =
    matrix.rows.find((r) => /accounts\s+receivable/i.test(r.account)) ??
    matrix.rows.find((r) => /\bar\b/i.test(r.account));
  const rat = row?.approachRationale?.trim();
  return rat && rat.length > 0 ? rat : null;
}

function agingBucketLabel(invoice: ArInvoice | null): string {
  if (!invoice) return "Unknown";
  if (invoice.credits < 0) return "Credits";
  if (invoice.d90_plus > 0) return "90+ Days";
  if (invoice.d61_90 > 0) return "61-90 Days";
  if (invoice.d31_60 > 0) return "31-60 Days";
  if (invoice.d1_30 > 0) return "1-30 Days";
  return "Current";
}

function updateOverallConclusion(
  sheet: ExcelJS.Worksheet,
  stats: {
    total: number;
    countFull: number;
    countPartial: number;
    countUncovered: number;
    totalVerified: number;
    totalSelected: number;
  },
): void {
  const text = buildOverallConclusion(stats);
  const seen = new Set<number>();
  for (let r = 1; r <= sheet.rowCount; r++) {
    for (let c = 1; c <= sheet.columnCount; c++) {
      const cell = sheet.getRow(r).getCell(c);
      const existing = readText(cell);
      if (!existing) continue;
      if (!/overall conclusion.*alternative\s+procedures/i.test(existing)) {
        continue;
      }
      // The conclusion cell is typically merged across the row — set
      // every cell that carries the same banner so the rendered text
      // updates regardless of which one Excel reads on open.
      if (!seen.has(r)) seen.add(r);
      cell.value = text;
    }
  }
}

function buildOverallConclusion(stats: {
  total: number;
  countFull: number;
  countPartial: number;
  countUncovered: number;
  totalVerified: number;
  totalSelected: number;
}): string {
  const {
    total,
    countFull,
    countPartial,
    countUncovered,
    totalVerified,
    totalSelected,
  } = stats;
  const fmt$ = (n: number) =>
    `$${Math.round(n).toLocaleString("en-US")}`;
  const coveragePct =
    totalSelected === 0
      ? 0
      : Math.round((totalVerified / totalSelected) * 1000) / 10;

  if (total === 0) {
    return "OVERALL CONCLUSION — ALTERNATIVE PROCEDURES: No selections drawn — sampling produced no items for alternative procedures.";
  }

  if (countUncovered === 0 && countPartial === 0) {
    return (
      `OVERALL CONCLUSION — ALTERNATIVE PROCEDURES: All ${total} ` +
      `selections fully covered by subsequent cash receipts ` +
      `(${fmt$(totalVerified)} of ${fmt$(totalSelected)}, ${coveragePct}% coverage). ` +
      `No exceptions identified — existence assertion supported for ` +
      `the alt-procedures population.`
    );
  }

  if (countFull === 0 && countPartial === 0) {
    return (
      `OVERALL CONCLUSION — ALTERNATIVE PROCEDURES: 0 of ${total} ` +
      `selections traced into subsequent cash receipts ` +
      `(${fmt$(totalSelected)} selected, $0 verified). ` +
      `Existence is NOT supported via SCR alone — perform alternative ` +
      `evidence procedures (shipping documents, signed BOL, or direct ` +
      `customer credit confirmation) on all ${total} items before ` +
      `concluding on the assertion.`
    );
  }

  const parts: string[] = [];
  parts.push(`${countFull} of ${total} selections fully collected post-YE`);
  if (countPartial > 0) {
    parts.push(`${countPartial} partial`);
  }
  if (countUncovered > 0) {
    parts.push(`${countUncovered} not yet collected`);
  }
  const summary = parts.join(", ");
  const followUp =
    countUncovered > 0 || countPartial > 0
      ? ` The ${countUncovered + countPartial} uncovered/partial items require additional alternative evidence (shipping documents, BOL, or direct customer credit confirmation) before existence can be concluded for those items.`
      : "";

  return (
    `OVERALL CONCLUSION — ALTERNATIVE PROCEDURES: ${summary} ` +
    `(${fmt$(totalVerified)} of ${fmt$(totalSelected)} verified, ${coveragePct}% coverage).${followUp}`
  );
}

function formatShortDate(iso: string | null): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return iso;
  const yy = m[1].slice(2);
  return `${parseInt(m[2], 10)}/${parseInt(m[3], 10)}/${yy}`;
}

function setCell(
  row: ExcelJS.Row,
  col: number,
  value: string | number,
): void {
  if (col <= 0) return;
  row.getCell(col).value = value;
}

function readText(cell: ExcelJS.Cell): string {
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if (
      "richText" in v &&
      Array.isArray((v as { richText: unknown }).richText)
    ) {
      return (v as { richText: { text?: string }[] }).richText
        .map((rt) => rt.text ?? "")
        .join("");
    }
    if ("formula" in v && "result" in v) {
      const r = (v as { result: unknown }).result;
      if (typeof r === "string") return r;
      if (typeof r === "number") return String(r);
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

// Walks every formula cell on the sheet. For each cell reference in
// the formula (e.g. "D11", "$D$11", "Sheet1!D11"), if the row number
// is >= startRow, shift it by +delta. Skips row refs in absolute-
// reference form ONLY when the row is locked AND the ref points
// inside the inserted range (in which case auditor intent is
// ambiguous — but we still shift to keep math correct).
//
// Limits:
//   - Only handles row-shift on the SAME sheet. Cross-sheet refs
//     (Sheet2!A1) are also shifted, but if the splice happened on
//     Sheet2, the formula on Sheet1 wouldn't know about it. Out of
//     scope for now.
//   - Does NOT handle range refs like A1:B10 — those would need
//     each end of the range shifted independently. Add if needed.
function shiftFormulaRowRefs(
  sheet: ExcelJS.Worksheet,
  startRow: number,
  delta: number,
): void {
  if (delta === 0) return;
  sheet.eachRow({ includeEmpty: false }, (row) => {
    row.eachCell({ includeEmpty: false }, (cell) => {
      const v = cell.value;
      if (v == null || typeof v !== "object") return;
      if (!("formula" in v)) return;
      const formula = (v as { formula: unknown }).formula;
      if (typeof formula !== "string") return;
      const updated = formula.replace(
        /(\$?)([A-Z]+)(\$?)(\d+)/g,
        (_full, absCol: string, col: string, absRow: string, rowStr: string) => {
          const r = parseInt(rowStr, 10);
          if (r < startRow) return `${absCol}${col}${absRow}${rowStr}`;
          const nr = r + delta;
          if (nr < 1) return `${absCol}${col}${absRow}${rowStr}`;
          return `${absCol}${col}${absRow}${nr}`;
        },
      );
      if (updated !== formula) {
        cell.value = {
          ...(v as object),
          formula: updated,
        } as ExcelJS.CellValue;
      }
    });
  });
}
