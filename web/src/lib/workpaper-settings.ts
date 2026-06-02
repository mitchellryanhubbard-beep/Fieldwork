import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import type { AssertionKey } from "@/lib/procedure-library";
import type {
  HighCoverageParams,
  MethodologyId,
} from "@/lib/sampling-methodologies";

// Per-workpaper sampling settings. Persisted as a small JSON blob next to
// the workpaper xlsx in storage so a regeneration always picks up the
// previously-selected methodology + seed.

export type AssertionSettings = {
  methodology: MethodologyId;
  // Only relevant for highCoverageHybrid; ignored otherwise. Optional so we
  // can use library defaults when the auditor hasn't tweaked anything.
  params?: Partial<HighCoverageParams>;
  // Sticky seed — derived from (engagementId + acctNum + assertion) the
  // first time. Stored so regeneration is bit-for-bit reproducible.
  seed?: string;
  // ISO timestamp the auditor (or the system on first generation) wrote
  // these settings.
  lockedAt: string;
};

export type WorkpaperSettings = {
  version: "1.0";
  perAssertion: Partial<Record<AssertionKey, AssertionSettings>>;
};

const EMPTY: WorkpaperSettings = { version: "1.0", perAssertion: {} };

export function workpaperSettingsPath(
  engagementId: string,
  acctNum: string,
): string {
  return `engagements/${engagementId}/workpapers/${acctNum}-settings.json`;
}

export async function loadWorkpaperSettings(
  engagementId: string,
  acctNum: string,
): Promise<WorkpaperSettings> {
  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(workpaperSettingsPath(engagementId, acctNum));
  if (error || !data) return { ...EMPTY };

  try {
    const text = await data.text();
    const parsed = JSON.parse(text) as unknown;
    if (
      parsed &&
      typeof parsed === "object" &&
      "version" in parsed &&
      "perAssertion" in parsed
    ) {
      return parsed as WorkpaperSettings;
    }
    return { ...EMPTY };
  } catch {
    return { ...EMPTY };
  }
}

export async function saveWorkpaperSettings(
  engagementId: string,
  acctNum: string,
  settings: WorkpaperSettings,
): Promise<void> {
  const sb = getServerSupabase();
  const path = workpaperSettingsPath(engagementId, acctNum);
  const body = Buffer.from(JSON.stringify(settings, null, 2), "utf8");
  const { error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(path, body, {
      contentType: "application/json",
      upsert: true,
    });
  if (error) {
    throw new Error(`workpaper settings save failed: ${error.message}`);
  }
}

// Updates one assertion's settings, leaves others alone. Use this from the
// methodology-dropdown action so a single click doesn't have to round-trip
// the full settings doc through the client.
export async function setAssertionMethodology(
  engagementId: string,
  acctNum: string,
  assertion: AssertionKey,
  methodology: MethodologyId,
): Promise<void> {
  const current = await loadWorkpaperSettings(engagementId, acctNum);
  const existing = current.perAssertion[assertion];
  current.perAssertion[assertion] = {
    methodology,
    params: existing?.params,
    seed: existing?.seed,
    lockedAt: new Date().toISOString(),
  };
  await saveWorkpaperSettings(engagementId, acctNum, current);
}
