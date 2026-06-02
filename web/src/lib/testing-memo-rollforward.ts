import ExcelJS from "exceljs";
import type { ArAging } from "@/lib/ar-aging-parser";
import type { SubsequentCashReceipts } from "@/lib/scr-parser";
import type { AssertionMatrix } from "@/lib/assertion-matrix";
import type { SampleResult } from "@/lib/sampling-methodologies";

// AR Testing Summary Memorandum (WP-AR-04) rollforward.
//
// The memo is auditor-authored narrative with PY-audit-specific values
// (AR balance, SCR coverage, confirmation customer counts) baked into
// the text. After a rollforward we patch these in-place using CY data
// drawn from the canonical sources:
//   - CY / PY AR balance: assertion matrix (AR row's cyBalance / pyBalance)
//   - SCR collected $ + coverage %: subsequent cash receipts file +
//     AR aging (only receipts that hit a pre-YE invoice count toward
//     coverage of the YE AR population)
//   - Customer count for confirmation language: existence sample size
//
// Patches applied (regex against each cell's plain text):
//   (1) "$X (CY)" / "$Y (PY)"          → new CY / PY balance
//   (2) "balance of $X as of" /
//       "grand total $X to TB" /
//       "AR balance/total/recorded $X" → new CY balance
//   (3) "$X of pre-MM/DD AR collected
//        (Y% of balance)"              → recomputed SCR collected + coverage %
//   (4) "N customers" / "N confirmations" / "selected N invoices"
//                                       → existence sample customer count
//
// Other PY-specific text (invoice IDs, allowance numbers, cutoff sample
// counts) is left at PY values because we don't have CY confirmation-
// tracker data yet — they need separate workpapers to drive them.

export function rolloverTestingSummaryMemo(
  wb: ExcelJS.Workbook,
  matrix: AssertionMatrix | null,
  aging: ArAging | null,
  scr: SubsequentCashReceipts | null,
  sample: SampleResult | null,
): number {
  let modified = 0;
  const arRow = arMatrixRow(matrix);
  const newCy = arRow?.cyBalance ?? aging?.total ?? null;
  const newPy = arRow?.pyBalance ?? null;
  const scrAgainstYe = computeScrAgainstYeAr(scr, aging);
  const newScrCollected = scrAgainstYe?.collected ?? null;
  const newScrCoveragePct = scrAgainstYe?.coveragePct ?? null;
  const newCustomerCount = sample?.selections.length ?? null;

  for (const sheet of wb.worksheets) {
    if (!isTestingSummaryMemo(sheet)) continue;
    for (let r = 1; r <= sheet.rowCount; r++) {
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = sheet.getRow(r).getCell(c);
        const original = readPlainText(cell);
        if (!original) continue;
        const next = patch(original, {
          newCy,
          newPy,
          newScrCollected,
          newScrCoveragePct,
          newCustomerCount,
        });
        if (next !== original) {
          cell.value = next;
          modified += 1;
        }
      }
    }
  }
  return modified;
}

function patch(
  text: string,
  ctx: {
    newCy: number | null;
    newPy: number | null;
    newScrCollected: number | null;
    newScrCoveragePct: number | null;
    newCustomerCount: number | null;
  },
): string {
  let out = text;

  // (1) Explicit "(CY)" / "(PY)" labels.
  if (ctx.newCy !== null) {
    const cyLabel = `${fmtDollar(ctx.newCy)} (CY)`;
    out = out.replace(
      /\$\s*[\d,]+(?:\.\d+)?\s*\(\s*CY\s*\)/g,
      () => cyLabel,
    );
  }
  if (ctx.newPy !== null) {
    const pyLabel = `${fmtDollar(ctx.newPy)} (PY)`;
    out = out.replace(
      /\$\s*[\d,]+(?:\.\d+)?\s*\(\s*PY\s*\)/g,
      () => pyLabel,
    );
  }

  // (1b) PY→CY YoY change line: "increase of $Z / W.W%" computed from
  // the new CY/PY balances. Updates the delta + %.
  if (ctx.newCy !== null && ctx.newPy !== null && ctx.newPy !== 0) {
    const delta = ctx.newCy - ctx.newPy;
    const pct = (delta / Math.abs(ctx.newPy)) * 100;
    const sign = delta >= 0 ? "increase" : "decrease";
    const replacement = `${sign} of ${fmtDollar(Math.abs(delta))} / ${pct.toFixed(1)}%`;
    out = out.replace(
      /(?:increase|decrease)\s+of\s+\$[\d,]+(?:\.\d+)?\s*\/\s*[\d.]+%/gi,
      () => replacement,
    );
  }

  // (2) Bare references to the CY AR amount: "balance of $X",
  // "grand total $X to TB", "Accounts Receivable, net — $X",
  // "AR ... of $X".
  if (ctx.newCy !== null) {
    const cyDollar = fmtDollar(ctx.newCy);
    out = out.replace(
      /(balance\s+of\s+)\$[\d,]+(?:\.\d+)?/gi,
      (_m, p1: string) => `${p1}${cyDollar}`,
    );
    out = out.replace(
      /(grand\s+total\s+)\$[\d,]+(?:\.\d+)?(\s+to\s+TB)/gi,
      (_m, p1: string, p2: string) => `${p1}${cyDollar}${p2}`,
    );
    out = out.replace(
      /(accounts\s+receivable[^|.\n]{0,40}?[—\-–]\s*)\$[\d,]+(?:\.\d+)?/gi,
      (_m, p1: string) => `${p1}${cyDollar}`,
    );
    out = out.replace(
      /(accounts\s+receivable[^|.\n]{0,40}?\bof\s+)\$[\d,]+(?:\.\d+)?/gi,
      (_m, p1: string) => `${p1}${cyDollar}`,
    );
  }

  // (3) SCR coverage line:
  // "$X of pre-MM/DD AR collected (Y% of balance)"
  if (ctx.newScrCollected !== null && ctx.newScrCoveragePct !== null) {
    const cov = (ctx.newScrCoveragePct * 100).toFixed(1);
    const replacement = `${fmtDollar(ctx.newScrCollected)} of pre-12/31 AR collected (${cov}% of balance)`;
    out = out.replace(
      /\$[\d,]+(?:\.\d+)?\s+of\s+pre-\d+\/\d+\s+AR\s+collected\s+\(\s*[\d.]+%\s+of\s+balance\s*\)/gi,
      () => replacement,
    );
  }

  // (4) Confirmation customer count.
  // "N customers" / "N confirmations sent/received/mailed" /
  // "all N customers" — match the existence sample size.
  if (ctx.newCustomerCount !== null) {
    const n = ctx.newCustomerCount;
    out = out.replace(
      /\b\d+\s+customers\b/g,
      () => `${n} customers`,
    );
    out = out.replace(
      /\b\d+(\s+confirmations\s+(?:sent|received|mailed))\b/gi,
      (_m, tail: string) => `${n}${tail}`,
    );
    out = out.replace(
      /\ball\s+\d+\s+customers\b/gi,
      () => `all ${n} customers`,
    );
  }

  return out;
}

function isTestingSummaryMemo(sheet: ExcelJS.Worksheet): boolean {
  for (let r = 1; r <= Math.min(sheet.rowCount, 10); r++) {
    for (let c = 1; c <= Math.min(sheet.columnCount, 4); c++) {
      const text = readPlainText(sheet.getRow(r).getCell(c));
      if (!text) continue;
      if (
        /ar\s+testing\s+summary\s+memo/i.test(text) ||
        /testing\s+summary\s+memorandum/i.test(text) ||
        /accounts\s+receivable[^|]*testing\s+summary/i.test(text)
      ) {
        return true;
      }
    }
  }
  return false;
}

function arMatrixRow(matrix: AssertionMatrix | null) {
  if (!matrix) return null;
  return (
    matrix.rows.find((r) => /accounts\s+receivable/i.test(r.account)) ??
    matrix.rows.find((r) => /\bar\b/i.test(r.account)) ??
    null
  );
}

// Sum receipts in the SCR that hit an invoice listed in the YE AR aging
// (i.e. that count toward collecting the YE AR balance). Returns null
// when either source is missing.
function computeScrAgainstYeAr(
  scr: SubsequentCashReceipts | null,
  aging: ArAging | null,
): { collected: number; coveragePct: number } | null {
  if (!scr || !aging) return null;
  const invSet = new Set(aging.invoices.map((inv) => inv.invoiceNum));
  let collected = 0;
  for (const r of scr.receipts) {
    if (!invSet.has(r.invoiceNum)) continue;
    if (r.amountReceived <= 0) continue;
    collected += r.amountReceived;
  }
  const coveragePct = aging.total === 0 ? 0 : collected / aging.total;
  return { collected, coveragePct };
}

function fmtDollar(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

function readPlainText(cell: ExcelJS.Cell): string {
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
