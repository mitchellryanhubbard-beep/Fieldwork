// Canonical-shape registry for the intake layer.
//
// Every supporting-schedule upload normalizes to one of these shapes
// regardless of source format (xlsx, csv, pdf, image, docx). Downstream
// tests only ever see the canonical type — they never know what format the
// auditor originally uploaded.
//
// New supporting-schedule types extend this union and add a parser path
// in dispatch.ts.

import type { ArAging } from "@/lib/ar-aging-parser";
import type { TrialBalance } from "@/lib/tb-parser";
import type { SubsequentCashReceipts } from "@/lib/scr-parser";

// File-kind keys mirror the engagement_file_kind_enum values that already
// power uploads. py_audit has no canonical shape — we store it as evidence
// but don't parse it yet (it's the PCAOB-signed opinion PDF).
export type ParseableKind =
  | "ar_aging"
  | "py_ar_aging"
  | "cy_tb"
  | "subsequent_cash_receipts";

export type CanonicalByKind = {
  ar_aging: ArAging;
  py_ar_aging: ArAging;
  cy_tb: TrialBalance;
  subsequent_cash_receipts: SubsequentCashReceipts;
};

export type Canonical<K extends ParseableKind> = CanonicalByKind[K];

export const PARSEABLE_KINDS: ParseableKind[] = [
  "ar_aging",
  "py_ar_aging",
  "cy_tb",
  "subsequent_cash_receipts",
];

// Human-facing labels — surfaced in the verification UI title bar.
export const KIND_LABELS: Record<ParseableKind, string> = {
  ar_aging: "CY AR Aging",
  py_ar_aging: "PY AR Aging",
  cy_tb: "CY Trial Balance",
  subsequent_cash_receipts: "Subsequent Cash Receipts",
};

// Detected source format. The intake dispatcher routes to a format-specific
// parser based on this. Detection is best-effort — extension + mime type
// for now; content sniff if/when needed. "manual" is the special case for
// auditor-entered data via the manual-mapping fallback (no source parse).
export type SourceFormat =
  | "xlsx"
  | "csv"
  | "pdf"
  | "image"
  | "docx"
  | "manual"
  | "unknown";

export function detectSourceFormat(
  filename: string,
  mime: string | null,
): SourceFormat {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".xlsx") || lower.endsWith(".xls")) return "xlsx";
  if (lower.endsWith(".csv")) return "csv";
  if (lower.endsWith(".pdf")) return "pdf";
  if (lower.endsWith(".docx") || lower.endsWith(".doc")) return "docx";
  if (
    lower.endsWith(".png") ||
    lower.endsWith(".jpg") ||
    lower.endsWith(".jpeg") ||
    lower.endsWith(".heic") ||
    lower.endsWith(".webp")
  ) {
    return "image";
  }
  // Fall back to mime if extension didn't conclude.
  if (!mime) return "unknown";
  if (mime.includes("spreadsheet") || mime.includes("excel")) return "xlsx";
  if (mime === "text/csv") return "csv";
  if (mime === "application/pdf") return "pdf";
  if (mime.startsWith("image/")) return "image";
  if (mime.includes("word")) return "docx";
  return "unknown";
}
