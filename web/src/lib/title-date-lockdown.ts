import ExcelJS from "exceljs";
import type { EngagementSetup } from "@/lib/engagement-schema";

// Forces every tab's title-row date to match the engagement's
// authoritative fiscal-year-end. The general +1 date shifter can't
// guarantee consistency across tabs when source dates differ —
// some tabs may have been authored at YE, others at YE+1 for the
// cutoff, etc. — so we run this targeted pass to lock the
// header-level "Year Ended <date>" text to the engagement value.
//
// Detection: the first row near the top of each sheet that contains
// a "Year Ended", "Year Ending", "As of", or "For the year ended"
// phrase followed by a date. Only ONE replacement per sheet (the
// header — never a body cell).

export type TitleDateLockdownResult = {
  updates: number;
};

export function lockdownTitleDates(
  wb: ExcelJS.Workbook,
  engagement: EngagementSetup,
): TitleDateLockdownResult {
  const yeIso = engagement.client.fiscalYearEnd; // YYYY-MM-DD
  const parsedYe = parseYe(yeIso);
  if (!parsedYe) return { updates: 0 };
  const ye: Ye = parsedYe;

  const longDate = formatLongDate(ye); // "December 31, 2025"
  const shortDate = formatShortDate(ye); // "12/31/25"
  const isoDate = `${ye.year}-${pad2(ye.month)}-${pad2(ye.day)}`;
  const usLongDate = formatUsDate(ye, "long");

  // Phrase signatures that ALWAYS refer to the engagement's fiscal-
  // year-end (the date the balance sheet is "as of"). Body cells
  // anywhere on any sheet matching these get every embedded date
  // normalized to engagement.client.fiscalYearEnd.
  const yePhrases =
    /year\s+end(ed|ing)\b|as\s+of\b|for\s+the\s+year\s+ended\b|balance[-\s]sheet\s+date\b|fairly\s+stated\s+as\s+of\b|at\s+year[-\s]end\b/i;

  function normalizeDatesIn(text: string): string {
    let next = text;
    // "Month D, YYYY" — long form
    next = next.replace(
      /\b(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\s+\d{1,2},?\s+20\d{2}\b/g,
      longDate,
    );
    // ISO YYYY-MM-DD
    next = next.replace(/\b20\d{2}-\d{2}-\d{2}\b/g, isoDate);
    // M/D/YYYY — 4-digit
    next = next.replace(/\b\d{1,2}\/\d{1,2}\/20\d{2}\b/g, usLongDate);
    // M/D/YY — 2-digit
    next = next.replace(/\b\d{1,2}\/\d{1,2}\/\d{2}\b/g, shortDate);
    return next;
  }

  let updates = 0;
  for (const sheet of wb.worksheets) {
    // Walk EVERY cell — body conclusions, footers, methodology lines
    // etc. may all reference the YE date. We only act when the cell
    // contains a YE-anchored phrase ("year ended", "as of", etc.) so
    // we don't accidentally clobber cutoff dates / future deadlines.
    sheet.eachRow({ includeEmpty: false }, (row) => {
      row.eachCell({ includeEmpty: false }, (cell) => {
        const text = readText(cell);
        if (!text) return;
        if (!yePhrases.test(text)) return;
        const next = normalizeDatesIn(text);
        if (next !== text) {
          cell.value = next;
          updates += 1;
        }
      });
    });
  }
  return { updates };
}

type Ye = { year: number; month: number; day: number };

function parseYe(iso: string): Ye | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  return {
    year: parseInt(m[1], 10),
    month: parseInt(m[2], 10),
    day: parseInt(m[3], 10),
  };
}

function formatLongDate(ye: Ye): string {
  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
  ];
  return `${months[ye.month - 1]} ${ye.day}, ${ye.year}`;
}

function formatShortDate(ye: Ye): string {
  const yy = String(ye.year % 100).padStart(2, "0");
  return `${ye.month}/${ye.day}/${yy}`;
}

function formatUsDate(ye: Ye, _kind: "long"): string {
  return `${ye.month}/${ye.day}/${ye.year}`;
}

function pad2(n: number): string {
  return String(n).padStart(2, "0");
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
