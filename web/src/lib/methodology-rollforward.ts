import ExcelJS from "exceljs";
import type { EngagementSetup } from "@/lib/engagement-schema";
import type { TrialBalance } from "@/lib/tb-parser";
import type { ArAging } from "@/lib/ar-aging-parser";

// Refreshes in-text $ values + counts on the two "side-band" tabs that
// PY detail-testing workpapers include:
//
//   Methodology & Scope:
//     - "Overall materiality (OM): $617,000 (≈0.8% of net revenue of $77.1M)."
//     - "Performance materiality (PM): $401,000 (65% of OM)."
//     - "Clearly-trivial threshold: $31,000 (5% of OM). ..."
//     - "Population: customer-level trade AR subledger at 12/31/25
//        totaling $14,200,000 across 109 customer accounts."
//
//   Results (summary):
//     - "Gross trade AR per TB (acct 1200)   $14,200,000"
//     - "Performance materiality              $401,000"
//
// Strategy: walk every cell on every sheet, look for the labeled
// phrases (case-insensitive), then update the $ amounts and bracketed
// % to match the current engagement.materiality and the CY TB. The
// number rendering matches what the auditor put in originally (round
// to whole dollars, en-US grouping).

export type MethodologyRolloverResult = {
  handledSheets: Set<string>;
  updates: number;
};

export function rolloverMethodologyTabs(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
    trialBalance: TrialBalance | null;
    arAging: ArAging | null;
  },
): MethodologyRolloverResult {
  const handled = new Set<string>();
  let updates = 0;
  const { engagement, trialBalance, arAging } = args;
  const om = engagement.materiality.overallMateriality;
  const pm = engagement.materiality.performanceMateriality;
  const ctt = engagement.materiality.clearlyTrivialThreshold;
  const pmPctOfOm = om === 0 ? 0 : pm / om;
  const cttPctOfOm = om === 0 ? 0 : ctt / om;
  const revenue = trialBalance
    ? sumRevenue(trialBalance)
    : null;
  const omPctOfRevenue =
    revenue !== null && revenue > 0 ? om / revenue : null;
  const tradeArAcctNum = pickTradeArAcctNum(trialBalance);
  const tradeArBalance =
    trialBalance && tradeArAcctNum
      ? trialBalance.accounts.find((a) => a.acctNum === tradeArAcctNum)
          ?.cyBalance ?? null
      : null;
  const customerCount = arAging?.customers.length ?? null;

  for (const sheet of wb.worksheets) {
    let sheetUpdates = 0;
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = readText(cell);
        if (!text) return;

        let next = text;

        // Materiality lines.
        next = replaceMoneyAfter(
          next,
          /(overall\s+materiality\s*\(?om\)?\s*:?\s*)\$[\d,]+(?:\.\d+)?/i,
          om,
        );
        next = replaceMoneyAfter(
          next,
          /(performance\s+materiality\s*\(?pm\)?\s*:?\s*)\$[\d,]+(?:\.\d+)?/i,
          pm,
        );
        next = replaceMoneyAfter(
          next,
          /(clearly[-\s]trivial\s+threshold\s*:?\s*)\$[\d,]+(?:\.\d+)?/i,
          ctt,
        );

        // Inline % qualifiers — "(65% of OM)", "(5% of OM)",
        // "(≈0.8% of net revenue of $77.1M)" — refresh against new
        // materiality + revenue values.
        next = next.replace(
          /\((\d+(?:\.\d+)?)%\s+of\s+om\)/gi,
          (_m, _p1, offset: number) => {
            // Decide whether this % applies to PM or CTT based on what
            // label was BEFORE it in the same string.
            const head = next.slice(0, offset).toLowerCase();
            const pmIdx = head.lastIndexOf("performance materiality");
            const cttIdx = head.lastIndexOf("clearly");
            const target = cttIdx > pmIdx ? cttPctOfOm : pmPctOfOm;
            return `(${(target * 100).toFixed(0)}% of OM)`;
          },
        );
        if (omPctOfRevenue !== null && revenue !== null) {
          // Function-form replacement so the "$" in fmtMoney/formatMillions
          // doesn't get parsed as a backreference. Also tolerate prior
          // bad output that may have lost the "$" sign.
          const newPct = (omPctOfRevenue * 100).toFixed(1);
          const newRev = formatMillions(revenue);
          next = next.replace(
            /\(\s*≈?\s*\d+(?:\.\d+)?\s*%\s+of\s+net\s+revenue\s+of\s+\$?[\d.,]+M?\s*\)/gi,
            () => `(≈${newPct}% of net revenue of ${newRev})`,
          );
        }

        // Population dollar + customer count: "$14,200,000 across 109
        // customer accounts" (Methodology) or "Gross trade AR per TB"
        // amount in its own cell (Results). Match 1+ consecutive
        // "totaling" so duplicate-"totaling totaling" from a prior
        // buggy run gets cleaned up too.
        if (tradeArBalance !== null) {
          const newMoney = fmtMoney(tradeArBalance);
          next = next.replace(
            /(?:totaling\s+)+\$?[\d,]+(?:\.\d+)?/gi,
            () => `totaling ${newMoney}`,
          );
        }
        if (customerCount !== null) {
          next = next.replace(
            /(across\s+)\d+(\s+customer\s+accounts?)/gi,
            (_m, pre: string, suf: string) => `${pre}${customerCount}${suf}`,
          );
        }

        if (next !== text) {
          cell.value = next;
          sheetUpdates += 1;
        }
      });
    });

    // Results tab "label : amount" patterns where the $ value sits in
    // a separate cell to the right of the label. Walk row-by-row,
    // looking for known label texts in any cell, then update the
    // first numeric cell to its right.
    sheet.eachRow({ includeEmpty: false }, (row) => {
      for (let c = 1; c <= sheet.columnCount; c++) {
        const cell = row.getCell(c);
        const label = readText(cell).trim();
        if (!label) continue;
        const replacement = matchResultsLabel(label, {
          tradeArBalance,
          performanceMateriality: pm,
        });
        if (replacement === null) continue;
        for (let cc = c + 1; cc <= sheet.columnCount; cc++) {
          const target = row.getCell(cc);
          const tv = target.value;
          const hasFormula =
            tv != null &&
            typeof tv === "object" &&
            "formula" in tv &&
            typeof (tv as { formula: unknown }).formula === "string";
          if (hasFormula) {
            // Preserve the formula — only refresh the cached result.
            target.value = {
              ...(tv as object),
              result: replacement,
            } as ExcelJS.CellValue;
            sheetUpdates += 1;
            break;
          }
          if (typeof tv === "number") {
            target.value = replacement;
            sheetUpdates += 1;
            break;
          }
        }
      }
    });

    if (sheetUpdates > 0) {
      handled.add(sheet.name);
      updates += sheetUpdates;
    }
  }

  return { handledSheets: handled, updates };
}

// Returns the new numeric value to write into the rightmost cell of
// the row, or null if the label doesn't match any known Results row.
function matchResultsLabel(
  label: string,
  args: {
    tradeArBalance: number | null;
    performanceMateriality: number;
  },
): number | null {
  if (
    /^gross\s+(trade\s+)?(ar|a\/r|accounts?\s+receivable)\s+per\s+tb/i.test(
      label,
    ) &&
    args.tradeArBalance !== null
  ) {
    return args.tradeArBalance;
  }
  if (/^performance\s+materiality\s*$/i.test(label)) {
    return args.performanceMateriality;
  }
  return null;
}

function replaceMoneyAfter(
  text: string,
  pattern: RegExp,
  value: number,
): string {
  return text.replace(pattern, (_m, prefix: string) => {
    return `${prefix}${fmtMoney(value)}`;
  });
}

function fmtMoney(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
}

function formatMillions(n: number): string {
  const m = n / 1_000_000;
  if (Math.abs(m) >= 100) return `$${m.toFixed(0)}M`;
  if (Math.abs(m) >= 10) return `$${m.toFixed(1)}M`;
  return `$${m.toFixed(2)}M`;
}

function sumRevenue(tb: TrialBalance): number {
  let revenue = 0;
  for (const a of tb.accounts) {
    if (a.section === "Revenue") revenue += a.cyBalance;
  }
  return Math.abs(revenue);
}

// Pick the TB account number that drives the "Gross trade AR per TB"
// row — prefer a Trade-named account, then any unscoped AR account,
// fall back to the first account containing "receivable".
function pickTradeArAcctNum(tb: TrialBalance | null): string | null {
  if (!tb) return null;
  const arAccts = tb.accounts.filter(
    (a) =>
      /accounts?\s+receivable|trade\s+receivables?|^a\/r$|^ar$/i.test(a.name) &&
      !/allowance/i.test(a.name),
  );
  const trade = arAccts.find((a) => /trade/i.test(a.name));
  return (trade ?? arAccts[0])?.acctNum ?? null;
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
