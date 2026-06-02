// Compact CSV utilities for the intake layer.
//
// Handles the audit-grade essentials: quoted fields (including commas and
// embedded newlines), escaped quotes ("" inside a quoted field), BOM, and
// both Windows + Unix line endings. Picks a delimiter automatically from
// the first non-empty line (`,` or `\t` or `;` or `|`).
//
// Column mapping is alias-based: each canonical field has a list of
// likely header names; the lookup is case-insensitive and tolerates
// whitespace/punctuation differences. This lets us accept exports from
// QuickBooks / Sage / NetSuite without per-system parsers.

export function parseCsv(text: string): string[][] {
  // Strip UTF-8 BOM if present — Excel-exported CSVs commonly include it.
  let i = 0;
  if (text.charCodeAt(0) === 0xfeff) i = 1;

  const delimiter = detectDelimiter(text, i);
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  while (i < text.length) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i += 1;
        continue;
      }
      cell += c;
      i += 1;
      continue;
    }
    if (c === '"') {
      inQuotes = true;
      i += 1;
      continue;
    }
    if (c === delimiter) {
      row.push(cell);
      cell = "";
      i += 1;
      continue;
    }
    if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(cell);
      if (row.length > 1 || row[0] !== "") rows.push(row);
      row = [];
      cell = "";
      i += 1;
      continue;
    }
    cell += c;
    i += 1;
  }
  if (cell !== "" || row.length > 0) {
    row.push(cell);
    if (row.length > 1 || row[0] !== "") rows.push(row);
  }
  return rows;
}

function detectDelimiter(text: string, startIdx: number): string {
  // Read the first non-empty line (outside of quotes — but at the very
  // start of a file the first line is the safest sample) and pick the
  // candidate delimiter with the highest count.
  let line = "";
  for (let i = startIdx; i < text.length; i++) {
    const c = text[i];
    if (c === "\n" || c === "\r") {
      if (line.length > 0) break;
      continue;
    }
    line += c;
  }
  const candidates = [",", "\t", ";", "|"];
  let best = ",";
  let bestCount = -1;
  for (const d of candidates) {
    const count = (line.match(new RegExp(`\\${d}`, "g")) ?? []).length;
    if (count > bestCount) {
      bestCount = count;
      best = d;
    }
  }
  return best;
}

// Normalizes a header for matching: lowercases, strips all non-alphanumeric
// characters. So "Customer #" / "customer#" / "Customer Number" all
// collapse to a stable key for alias lookup.
export function normalizeHeader(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, "");
}

// Builds a header → canonical-field index from a header row + alias map.
// Headers not in the alias map are dropped (the auditor falls back to
// manual mapping if too many columns are missing).
export type HeaderIndex = Record<string, number | undefined>;

export function buildHeaderIndex<FieldKey extends string>(
  headerRow: string[],
  aliases: Record<FieldKey, string[]>,
): Record<FieldKey, number | undefined> {
  // Normalize the source headers once.
  const normalized = headerRow.map(normalizeHeader);
  const index: Partial<Record<FieldKey, number>> = {};
  for (const field of Object.keys(aliases) as FieldKey[]) {
    for (const alias of aliases[field]) {
      const idx = normalized.indexOf(normalizeHeader(alias));
      if (idx >= 0) {
        index[field] = idx;
        break;
      }
    }
  }
  return index as Record<FieldKey, number | undefined>;
}

// Reads a cell value as a string, defaulting to empty.
export function cellStr(row: string[], idx: number | undefined): string {
  if (idx === undefined) return "";
  return (row[idx] ?? "").trim();
}

// Reads a cell as a number. Handles $, commas, parentheses (negative
// accounting notation), and blank cells (returns 0).
export function cellNum(row: string[], idx: number | undefined): number {
  const s = cellStr(row, idx);
  if (!s) return 0;
  // Parentheses → negative.
  const negative = /^\(.*\)$/.test(s);
  const cleaned = s.replace(/[(),$\s]/g, "");
  const n = Number(cleaned);
  if (!Number.isFinite(n)) return 0;
  return negative ? -n : n;
}

// Reads a cell as an ISO date (YYYY-MM-DD), returns null on missing/bad.
// Accepts ISO and a few common US formats.
export function cellDate(row: string[], idx: number | undefined): string | null {
  const s = cellStr(row, idx);
  if (!s) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  // US "MM/DD/YYYY" or "M/D/YYYY"
  const us = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/.exec(s);
  if (us) {
    let [, mm, dd, yy] = us;
    if (yy.length === 2) yy = (Number(yy) > 50 ? "19" : "20") + yy;
    return `${yy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}
