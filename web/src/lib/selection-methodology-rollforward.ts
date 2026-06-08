import ExcelJS from "exceljs";
import type { EngagementSetup } from "@/lib/engagement-schema";
import type { ArAging } from "@/lib/ar-aging-parser";
import type { TrialBalance } from "@/lib/tb-parser";
import type { SampleResult } from "@/lib/sampling-methodologies";

// Re-authors the three numbered lines under the "SELECTION
// METHODOLOGY" section of a detail-testing workpaper. The PY narrative
// uses prose with embedded numbers ("$401,000", "Twelve (12)
// balances", "$10,750,000", "75.7% of gross AR", etc.) that the
// generic label-and-cell rollover can't reach. Instead we detect the
// section by phrase signature, compute the new figures from the CY
// sample + aging + materiality, and overwrite each line's text in
// place with the same template the auditor wrote — just with current
// numbers.

export type SelectionMethodologyRolloverResult = {
  updates: number;
};

export function rolloverSelectionMethodology(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
    aging: ArAging | null;
    sample: SampleResult | null;
    trialBalance: TrialBalance | null;
  },
): SelectionMethodologyRolloverResult {
  const { engagement, aging, sample, trialBalance } = args;
  if (!aging || !sample || sample.selections.length === 0) {
    return { updates: 0 };
  }
  const pm = engagement.materiality.performanceMateriality;
  if (pm <= 0) return { updates: 0 };

  // Split the selections by reason:
  //   key  = methodology auto-included (top-tier / risk-table-top /
  //          mus-auto / aged-past-due)
  //   hap  = random/haphazard fill (random / risk-table-random /
  //          mus-hit)
  const autoReasons = new Set([
    "top-tier",
    "risk-table-top",
    "mus-auto",
    "aged-past-due",
  ]);
  const keyItems = sample.selections.filter((s) => autoReasons.has(s.reason));
  const hapItems = sample.selections.filter((s) => !autoReasons.has(s.reason));

  const keyCount = keyItems.length;
  const keyCoverage = keyItems.reduce((s, i) => s + Math.abs(i.balance), 0);
  const hapCount = hapItems.length;
  const hapCoverage = hapItems.reduce((s, i) => s + Math.abs(i.balance), 0);
  const totalCount = keyCount + hapCount;
  const totalCoverage = keyCoverage + hapCoverage;

  const grossAr =
    sumTradeAr(trialBalance) ??
    (aging.total > 0 ? aging.total : sample.populationTotal);
  const keyCoveragePct = grossAr > 0 ? (keyCoverage / grossAr) * 100 : 0;
  const totalCoveragePct =
    grossAr > 0 ? (totalCoverage / grossAr) * 100 : 0;

  // Below-PM population excludes the customers we picked for key
  // items (they're at or above PM by definition).
  const selectedCustNums = new Set(
    sample.selections.map((s) => s.custNum),
  );
  const belowPmCustomers = aging.customers.filter(
    (c) =>
      Math.abs(c.total) < pm &&
      !selectedCustNums.has(c.custNum) &&
      Math.abs(c.total) > 0,
  );
  const belowPmTotal = belowPmCustomers.reduce(
    (s, c) => s + Math.abs(c.total),
    0,
  );
  const belowPmCount = belowPmCustomers.length;

  const fmt$ = (n: number) =>
    `$${Math.round(n).toLocaleString("en-US")}`;
  const word = numberToWord;

  const lines: { matcher: RegExp; replacement: string }[] = [
    {
      matcher: /^\s*targeted\s*\(?key[-\s]?item\)?/i,
      replacement:
        `Targeted (key-item) selection: all customer balances equal to or exceeding performance materiality (${fmt$(pm)}) were selected for testing. ` +
        `${word(keyCount)} (${keyCount}) balances met this threshold, providing coverage of ${fmt$(keyCoverage)} (${keyCoveragePct.toFixed(1)}% of gross AR).`,
    },
    {
      matcher: /^\s*haphazard\s+sample/i,
      replacement:
        `Haphazard sample: from the remaining population below PM (${fmt$(belowPmTotal)} across ${belowPmCount} accounts), ` +
        `${word(hapCount)} (${hapCount}) accounts were selected on a haphazard basis to obtain coverage over the residual population and address the risk of material misstatement in the aggregate.`,
    },
    {
      matcher: /^\s*total\s+items?\s+selected/i,
      replacement:
        `Total items selected: ${totalCount} customer balances; aggregate coverage of ${fmt$(totalCoverage)} (${totalCoveragePct.toFixed(1)}% of gross AR).`,
    },
  ];

  let updates = 0;
  for (const sheet of wb.worksheets) {
    // Only act on sheets that carry the "SELECTION METHODOLOGY"
    // header somewhere — keeps us from accidentally rewriting an
    // unrelated paragraph that happens to start with "Targeted".
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

// Number-to-word for small whole numbers. Falls back to the digit
// string for anything outside the table.
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

// Pick the trade-AR account balance from the TB for coverage %
// denominator. Prefers an explicitly-Trade account, falls back to
// any AR account, returns null if the TB has none.
function sumTradeAr(tb: TrialBalance | null): number | null {
  if (!tb) return null;
  const ars = tb.accounts.filter(
    (a) =>
      /accounts?\s+receivable|trade\s+receivables?|^a\/r$|^ar$/i.test(a.name) &&
      !/allowance/i.test(a.name),
  );
  const trade = ars.find((a) => /\btrade\b|\bcontrol\b/i.test(a.name));
  const pick = trade ?? ars[0];
  return pick ? Math.abs(pick.cyBalance) : null;
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
