import { createHash } from "node:crypto";
import {
  detectSourceFormat,
  type Canonical,
  type ParseableKind,
  type SourceFormat,
} from "@/lib/intake/canonical";
import {
  saveParsedCanonical,
  saveVerification,
  type VerificationRecord,
} from "@/lib/intake/storage";
import { parseArAging } from "@/lib/ar-aging-parser";
import { parseTrialBalance } from "@/lib/tb-parser";
import { parseSubsequentCashReceipts } from "@/lib/scr-parser";
import { parseArAgingPdf } from "@/lib/intake/parsers/ar-aging-pdf";
import { parseTrialBalancePdf } from "@/lib/intake/parsers/tb-pdf";
import { parseSubsequentCashReceiptsPdf } from "@/lib/intake/parsers/scr-pdf";
import { parseArAgingCsv } from "@/lib/intake/parsers/ar-aging-csv";
import { parseTrialBalanceCsv } from "@/lib/intake/parsers/tb-csv";
import { parseSubsequentCashReceiptsCsv } from "@/lib/intake/parsers/scr-csv";

// Top-level intake dispatcher.
//
// Called once per upload (eager parse, cached forever). Detects the source
// format, routes to the format-specific parser, normalizes to the
// canonical shape, and persists both the parsed JSON and the verification
// record. After this returns, downstream tests can read the canonical JSON
// without re-running the parser — the original file stays as evidence but
// isn't re-touched.

export type IntakeOutcome<K extends ParseableKind> =
  | {
      ok: true;
      canonical: Canonical<K>;
      verification: VerificationRecord;
    }
  | {
      ok: false;
      verification: VerificationRecord;
    };

export async function runIntakeOnUpload<K extends ParseableKind>(args: {
  engagementId: string;
  kind: K;
  originalFilename: string;
  mime: string | null;
  bytes: Buffer;
}): Promise<IntakeOutcome<K>> {
  const { engagementId, kind, originalFilename, mime, bytes } = args;
  const sourceFormat = detectSourceFormat(originalFilename, mime);
  const sourceHash = sha256(bytes);

  try {
    const canonical = await parseToCanonical(kind, sourceFormat, bytes);
    const verification: VerificationRecord = {
      status: "pending",
      sourceFormat,
      originalFilename,
      sourceHash,
      parsedAt: new Date().toISOString(),
      confirmedAt: null,
      failureMessage: null,
    };

    await saveParsedCanonical(engagementId, kind, canonical);
    await saveVerification(engagementId, kind, verification);

    return { ok: true, canonical, verification };
  } catch (err) {
    const verification: VerificationRecord = {
      status: "failed",
      sourceFormat,
      originalFilename,
      sourceHash,
      parsedAt: new Date().toISOString(),
      confirmedAt: null,
      failureMessage: err instanceof Error ? err.message : String(err),
    };
    // Persist the failure so the verification UI can show the right
    // fallback ("we could not extract structured data — manual mapping").
    await saveVerification(engagementId, kind, verification);
    return { ok: false, verification };
  }
}

async function parseToCanonical<K extends ParseableKind>(
  kind: K,
  format: SourceFormat,
  bytes: Buffer,
): Promise<Canonical<K>> {
  if (format === "xlsx") return parseXlsx(kind, bytes);
  if (format === "pdf") return parsePdf(kind, bytes);
  if (format === "csv") return parseCsv(kind, bytes);
  // image, docx, unknown, manual — image/docx ship in later phases;
  // manual never flows through the dispatcher (it's a separate write path).
  throw new Error(
    `Source format "${format}" is not yet supported for "${kind}". Use the manual cell-mapping fallback.`,
  );
}

async function parseCsv<K extends ParseableKind>(
  kind: K,
  bytes: Buffer,
): Promise<Canonical<K>> {
  switch (kind) {
    case "ar_aging":
      return (await parseArAgingCsv(bytes)) as Canonical<K>;
    case "cy_tb":
      return (await parseTrialBalanceCsv(bytes)) as Canonical<K>;
    case "subsequent_cash_receipts":
      return (await parseSubsequentCashReceiptsCsv(bytes)) as Canonical<K>;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled kind: ${String(_exhaustive)}`);
    }
  }
}

async function parsePdf<K extends ParseableKind>(
  kind: K,
  bytes: Buffer,
): Promise<Canonical<K>> {
  switch (kind) {
    case "ar_aging":
      return (await parseArAgingPdf(bytes)) as Canonical<K>;
    case "cy_tb":
      return (await parseTrialBalancePdf(bytes)) as Canonical<K>;
    case "subsequent_cash_receipts":
      return (await parseSubsequentCashReceiptsPdf(bytes)) as Canonical<K>;
    default: {
      const _exhaustive: never = kind;
      throw new Error(`Unhandled kind: ${String(_exhaustive)}`);
    }
  }
}

async function parseXlsx<K extends ParseableKind>(
  kind: K,
  bytes: Buffer,
): Promise<Canonical<K>> {
  switch (kind) {
    case "ar_aging":
      return (await parseArAging(bytes)) as Canonical<K>;
    case "cy_tb":
      return (await parseTrialBalance(bytes)) as Canonical<K>;
    case "subsequent_cash_receipts":
      return (await parseSubsequentCashReceipts(bytes)) as Canonical<K>;
    default: {
      // Exhaustiveness check — if someone adds a kind to ParseableKind
      // without updating this switch, TS catches it here.
      const _exhaustive: never = kind;
      throw new Error(`Unhandled kind: ${String(_exhaustive)}`);
    }
  }
}

function sha256(buf: Buffer): string {
  return createHash("sha256").update(buf).digest("hex");
}
