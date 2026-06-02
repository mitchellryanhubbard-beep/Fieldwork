import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import type {
  Canonical,
  ParseableKind,
  SourceFormat,
} from "@/lib/intake/canonical";

// Two JSON sidecars live alongside every parseable upload:
//   - {kind}-parsed.json        the canonical extracted data (what tests use)
//   - {kind}-verification.json  status: pending | confirmed | failed
//
// One parse per upload. The parsed JSON is the source of truth from that
// moment forward — re-running the source-format parser is wasted work
// (and, for PDF/image, wasted Claude tokens).

export type VerificationStatus = "pending" | "confirmed" | "failed";

export type VerificationRecord = {
  status: VerificationStatus;
  sourceFormat: SourceFormat;
  originalFilename: string;
  // Sha256 of the original upload bytes — lets us detect if the file
  // changed under us and force a re-parse.
  sourceHash: string;
  parsedAt: string;          // ISO timestamp of last successful parse
  confirmedAt: string | null;
  failureMessage: string | null;
};

export function parsedJsonPath(
  engagementId: string,
  kind: ParseableKind,
): string {
  return `engagements/${engagementId}/${kind}-parsed.json`;
}

export function verificationPath(
  engagementId: string,
  kind: ParseableKind,
): string {
  return `engagements/${engagementId}/${kind}-verification.json`;
}

export async function loadParsedCanonical<K extends ParseableKind>(
  engagementId: string,
  kind: K,
): Promise<Canonical<K> | null> {
  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(parsedJsonPath(engagementId, kind));
  if (error || !data) return null;
  try {
    const text = await data.text();
    return JSON.parse(text) as Canonical<K>;
  } catch {
    return null;
  }
}

export async function saveParsedCanonical<K extends ParseableKind>(
  engagementId: string,
  kind: K,
  canonical: Canonical<K>,
): Promise<void> {
  const sb = getServerSupabase();
  const body = Buffer.from(JSON.stringify(canonical, null, 2), "utf8");
  const { error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(parsedJsonPath(engagementId, kind), body, {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`saveParsedCanonical failed: ${error.message}`);
}

export async function loadVerification(
  engagementId: string,
  kind: ParseableKind,
): Promise<VerificationRecord | null> {
  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(verificationPath(engagementId, kind));
  if (error || !data) return null;
  try {
    const text = await data.text();
    return JSON.parse(text) as VerificationRecord;
  } catch {
    return null;
  }
}

export async function saveVerification(
  engagementId: string,
  kind: ParseableKind,
  record: VerificationRecord,
): Promise<void> {
  const sb = getServerSupabase();
  const body = Buffer.from(JSON.stringify(record, null, 2), "utf8");
  const { error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(verificationPath(engagementId, kind), body, {
      contentType: "application/json",
      upsert: true,
    });
  if (error) throw new Error(`saveVerification failed: ${error.message}`);
}

export async function deleteParseSidecar(
  engagementId: string,
  kind: ParseableKind,
): Promise<void> {
  const sb = getServerSupabase();
  await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .remove([
      parsedJsonPath(engagementId, kind),
      verificationPath(engagementId, kind),
    ]);
}
