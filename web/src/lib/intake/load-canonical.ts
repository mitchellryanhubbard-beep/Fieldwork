import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { loadParsedCanonical, loadVerification } from "@/lib/intake/storage";
import {
  KIND_LABELS,
  type ParseableKind,
} from "@/lib/intake/canonical";
import { parseTrialBalance, type TrialBalance } from "@/lib/tb-parser";
import { parseArAging, type ArAging } from "@/lib/ar-aging-parser";
import {
  parseSubsequentCashReceipts,
  type SubsequentCashReceipts,
} from "@/lib/scr-parser";

// Format-agnostic loaders for the supporting-schedule canonical shapes.
// Each loader prefers the intake-layer JSON (works for xlsx/csv/pdf/etc.)
// and falls back to re-parsing the raw source upload ONLY for legacy
// engagements that were uploaded before the intake layer existed.
//
// Downstream tests should always use these — never reach into Supabase
// storage and call the xlsx parser directly.

export async function loadTrialBalanceForEngagement(
  engagementId: string,
): Promise<TrialBalance | null> {
  const canonical = await loadParsedCanonical(engagementId, "cy_tb");
  if (canonical) return canonical;
  return loadLegacyXlsx<TrialBalance>(engagementId, "cy_tb", parseTrialBalance);
}

export async function loadArAgingForEngagement(
  engagementId: string,
): Promise<ArAging | null> {
  const canonical = await loadParsedCanonical(engagementId, "ar_aging");
  if (canonical) return canonical;
  return loadLegacyXlsx<ArAging>(engagementId, "ar_aging", parseArAging);
}

export async function loadSubsequentCashReceiptsForEngagement(
  engagementId: string,
): Promise<SubsequentCashReceipts | null> {
  const canonical = await loadParsedCanonical(
    engagementId,
    "subsequent_cash_receipts",
  );
  if (canonical) return canonical;
  return loadLegacyXlsx<SubsequentCashReceipts>(
    engagementId,
    "subsequent_cash_receipts",
    parseSubsequentCashReceipts,
  );
}

// Legacy fallback: download the raw upload from storage and run the
// xlsx-specific parser against it. Returns null on any failure — callers
// treat null as "no usable data" and degrade gracefully.
// Throws if any of the required uploads exists on the engagement but its
// verification status isn't "confirmed". Returns the list of unconfirmed
// kinds so callers can build a structured error response.
//
// Workpaper/binder/confirmation generators call this BEFORE doing work —
// it's the single enforcement point for the rule "no test runs on
// unverified canonical data."
export async function requireUploadsConfirmed(
  engagementId: string,
  requiredKinds: ParseableKind[],
): Promise<void> {
  const sb = getServerSupabase();
  const { data: rows } = await sb
    .from("engagement_files")
    .select("kind")
    .eq("engagement_id", engagementId)
    .in("kind", requiredKinds);
  const uploadedKinds = new Set(
    (rows ?? []).map((r) => r.kind as ParseableKind),
  );

  const blocking: { kind: ParseableKind; reason: string }[] = [];
  for (const kind of requiredKinds) {
    if (!uploadedKinds.has(kind)) continue;
    const verification = await loadVerification(engagementId, kind);
    if (!verification) {
      blocking.push({
        kind,
        reason: `not yet parsed — re-upload to trigger intake`,
      });
      continue;
    }
    if (verification.status === "failed") {
      blocking.push({
        kind,
        reason: `parse failed (${verification.failureMessage ?? "unknown"}) — use manual mapping`,
      });
    } else if (verification.status === "pending") {
      blocking.push({
        kind,
        reason: `awaiting confirmation — open the Verify page and click "Confirm and use"`,
      });
    }
  }

  if (blocking.length > 0) {
    const lines = blocking
      .map((b) => `• ${KIND_LABELS[b.kind]}: ${b.reason}`)
      .join("\n");
    throw new Error(`Cannot generate — verification required:\n${lines}`);
  }
}

async function loadLegacyXlsx<T>(
  engagementId: string,
  kind: "cy_tb" | "ar_aging" | "subsequent_cash_receipts",
  parse: (buffer: Buffer) => Promise<T>,
): Promise<T | null> {
  const sb = getServerSupabase();
  const { data: row, error } = await sb
    .from("engagement_files")
    .select("storage_path")
    .eq("engagement_id", engagementId)
    .eq("kind", kind)
    .maybeSingle();
  if (error || !row?.storage_path) return null;
  try {
    const { data, error: dlError } = await sb.storage
      .from(ENGAGEMENT_FILES_BUCKET)
      .download(row.storage_path);
    if (dlError || !data) return null;
    const buffer = Buffer.from(await data.arrayBuffer());
    return await parse(buffer);
  } catch {
    return null;
  }
}
