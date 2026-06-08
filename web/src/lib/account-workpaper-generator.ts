import { exportEngagement } from "@/lib/engagement-repo";
import { generateAssertionMatrix } from "@/lib/assertion-matrix-generator";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { parseTrialBalance } from "@/lib/tb-parser";
import { computeArAnalytics } from "@/lib/ar-analytics";
import { runScrTesting } from "@/lib/scr-testing";
import {
  loadArAgingForEngagement,
  loadPyArAgingForEngagement,
  loadSubsequentCashReceiptsForEngagement,
  loadTrialBalanceForEngagement,
  requireUploadsConfirmed,
} from "@/lib/intake/load-canonical";
import { generateAccountWorkpaper } from "@/lib/account-workpaper";
import { displayAccountName } from "@/lib/account-name";
import { findFsli, matchMatrixRow } from "@/lib/workpaper-binder";
import {
  hasFsliInLibrary,
  type AssertionKey,
} from "@/lib/procedure-library";
import {
  defaultMethodology,
  runSampling,
  type MethodologyId,
  type SampleResult,
} from "@/lib/sampling-methodologies";
import {
  loadWorkpaperSettings,
  saveWorkpaperSettings,
  type WorkpaperSettings,
} from "@/lib/workpaper-settings";

export type AccountWorkpaperResult = {
  buffer: Buffer;
  filename: string;
  storagePath: string;
};

// Storage path is deterministic so we can both upsert on generation and look
// up by (engagementId, acctNum) on view. The download-time filename is built
// separately and carries the client + account-name slug for human use.
export function workpaperStoragePath(
  engagementId: string,
  acctNum: string,
): string {
  return `engagements/${engagementId}/workpapers/${acctNum}.xlsx`;
}

export function workpaperStoragePrefix(engagementId: string): string {
  return `engagements/${engagementId}/workpapers`;
}

// Load engagement → fetch + parse TB → find the account → generate matrix
// → build the workbook. Mirrors generateBinder's flow, but at the
// single-account grain.
export async function generateAccountWorkpaperById(
  engagementId: string,
  acctNum: string,
): Promise<AccountWorkpaperResult> {
  const engagement = await exportEngagement(engagementId);

  if (engagement.cyTrialBalanceFile.sizeBytes === 0) {
    throw new Error(
      "Cannot generate workpaper — CY Trial Balance file has not been uploaded.",
    );
  }

  // Verification gate: every uploaded supporting schedule must be
  // confirmed before its canonical data feeds a test. If a file isn't
  // uploaded the generator silently degrades; if it IS uploaded but
  // unconfirmed, block.
  await requireUploadsConfirmed(engagementId, [
    "cy_tb",
    "ar_aging",
    "subsequent_cash_receipts",
  ]);

  const trialBalance = await loadTrialBalanceForEngagement(engagementId);
  if (!trialBalance) {
    throw new Error(
      "Could not load Trial Balance. Verify the upload on the Verify page and try again.",
    );
  }

  const account = trialBalance.accounts.find((a) => a.acctNum === acctNum);
  if (!account) {
    throw new Error(`Account ${acctNum} not found in the parsed trial balance.`);
  }

  const fsli = findFsli(account.acctNum, account.name);
  if (!hasFsliInLibrary(fsli)) {
    throw new Error(
      `No procedure library entry for FSLI "${fsli}" yet. v1 supports Accounts Receivable only.`,
    );
  }

  const { matrix } = await generateAssertionMatrix(engagementId);
  const matrixRow = matchMatrixRow(account, matrix);
  const assertions: AssertionKey[] = matrixRow?.relevantAssertions ?? [];

  // Best-effort AR Aging load (canonical JSON if available, else legacy
  // xlsx). Sampling silently skips if no aging is uploaded.
  const aging = await loadArAgingForEngagement(engagementId);

  // Per-assertion methodology — read auditor's choice from settings, fall
  // back to the FSLI's default. Also write the resolved choice + seed back
  // to settings so the next regeneration is bit-for-bit reproducible.
  const settings = await loadWorkpaperSettings(engagementId, acctNum);
  const methodologySelections: Partial<Record<AssertionKey, MethodologyId>> = {};
  const sampleResults: Partial<Record<AssertionKey, SampleResult>> = {};

  for (const assertion of assertions) {
    const stored = settings.perAssertion[assertion];
    const methodology = stored?.methodology ?? defaultMethodology(fsli, assertion);
    methodologySelections[assertion] = methodology;

    // Every enabled "automated" methodology routes through runSampling.
    // The dispatcher returns null when inputs are missing (e.g. risk-based
    // table without a matrix overallRiskLevel), so the auditor sees a
    // manual sample table instead of a half-baked one.
    if (
      aging &&
      (methodology === "highCoverageHybrid" ||
        methodology === "riskBasedTable" ||
        methodology === "musStatistical" ||
        methodology === "agedReviewTargeted")
    ) {
      const result = runSampling({
        methodology,
        aging,
        performanceMateriality: engagement.materiality.performanceMateriality,
        engagementId,
        acctNum,
        assertion,
        seed: stored?.seed,
        // Intentionally NOT passing stored.params — every
        // regeneration resolves sampling parameters (e.g.
        // topTierPmPct) against current defaults so engagement-level
        // changes take effect without requiring a re-lock. Seed is
        // still honoured for random-fill reproducibility.
        overallRiskLevel: matrixRow?.overallRiskLevel,
      });
      if (result) {
        sampleResults[assertion] = result;
      }
    }
  }

  await persistResolvedSettings(
    engagementId,
    acctNum,
    settings,
    methodologySelections,
    sampleResults,
  );

  // PY aging is optional. When uploaded + verified, computeArAnalytics
  // emits a PY composition block so the workpaper can show a side-by-
  // side PY/CY aging table; when missing, the PY block is left null.
  const pyAging = await loadPyArAgingForEngagement(engagementId);

  // Analytics — only run when we have an aging file. Computed off TB +
  // aging, no Claude call. The generator silently skips the Analytics tab
  // when this is undefined.
  const arAnalytics = aging
    ? computeArAnalytics({
        account,
        trialBalance,
        aging,
        pyAging,
        industry: engagement.industry,
      })
    : undefined;

  // SCR substantive test — only run when both aging AND SCR uploads exist.
  // Uses the locked Existence sample to highlight sampled customers in the
  // per-customer rollup.
  const scr = await loadSubsequentCashReceiptsForEngagement(engagementId);
  const scrTestResult =
    aging && scr
      ? runScrTesting({
          scr,
          aging,
          yeDate: engagement.client.fiscalYearEnd,
          existenceSelections: sampleResults["Existence"]?.selections,
        })
      : undefined;

  const buffer = await generateAccountWorkpaper({
    engagement,
    matrix,
    account,
    sampleResults,
    methodologySelections,
    arAnalytics,
    scrTestResult,
  });

  const filename = downloadFilename(engagement, account.acctNum, account.name);
  const storagePath = workpaperStoragePath(engagementId, account.acctNum);

  // Persist so subsequent loads of the engagement page can show a "View
  // workpaper" link instead of regenerating. upsert=true: regeneration
  // (when we add it) overwrites the previous file in place.
  const sb = getServerSupabase();
  const { error: uploadError } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(storagePath, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(
      `workpaper upload failed: ${uploadError.message}`,
    );
  }

  return { buffer, filename, storagePath };
}

export function downloadFilename(
  engagement: { client: { name: string; fiscalYearEnd: string } },
  acctNum: string,
  accountName: string,
): string {
  const safeClient = engagement.client.name
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .slice(0, 30);
  const safeAcct = displayAccountName(accountName)
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .slice(0, 30);
  const fy = engagement.client.fiscalYearEnd.slice(0, 4);
  return `${safeClient}-FY${fy}-WP-${acctNum}-${safeAcct}.xlsx`;
}

// Streams the stored workpaper bytes back. Throws if nothing was generated.
export async function loadAccountWorkpaperById(
  engagementId: string,
  acctNum: string,
): Promise<AccountWorkpaperResult> {
  const engagement = await exportEngagement(engagementId);
  const storagePath = workpaperStoragePath(engagementId, acctNum);

  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(`No stored workpaper for account ${acctNum}.`);
  }
  const buffer = Buffer.from(await data.arrayBuffer());

  // Recover the human-friendly filename by looking the account up again so
  // the file the user saves matches the generation-time name. Uses the
  // canonical TB so this works for any source format.
  let accountName = acctNum;
  const tb = await loadTrialBalanceForEngagement(engagementId);
  if (tb) {
    const acct = tb.accounts.find((a) => a.acctNum === acctNum);
    if (acct) accountName = acct.name;
  }
  const filename = downloadFilename(engagement, acctNum, accountName);

  return { buffer, filename, storagePath };
}

async function persistResolvedSettings(
  engagementId: string,
  acctNum: string,
  current: WorkpaperSettings,
  methodologySelections: Partial<Record<AssertionKey, MethodologyId>>,
  sampleResults: Partial<Record<AssertionKey, SampleResult>>,
): Promise<void> {
  let dirty = false;
  for (const [assertion, methodology] of Object.entries(methodologySelections)) {
    if (!methodology) continue;
    const a = assertion as AssertionKey;
    const existing = current.perAssertion[a];
    const seed = sampleResults[a]?.seed ?? existing?.seed;
    const next = {
      methodology,
      params: existing?.params,
      seed,
      lockedAt: existing?.lockedAt ?? new Date().toISOString(),
    };
    if (
      !existing ||
      existing.methodology !== next.methodology ||
      existing.seed !== next.seed
    ) {
      current.perAssertion[a] = next;
      dirty = true;
    }
  }
  if (dirty) {
    await saveWorkpaperSettings(engagementId, acctNum, current);
  }
}

// Deletes the stored from-scratch workpaper xlsx for one account. Quiet
// success when nothing's there. Settings.json (methodology, seed) is
// preserved so a future regeneration stays reproducible.
export async function deleteAccountWorkpaperFile(
  engagementId: string,
  acctNum: string,
): Promise<void> {
  const sb = getServerSupabase();
  await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .remove([workpaperStoragePath(engagementId, acctNum)]);
}

// Returns the set of acctNums that already have a stored workpaper for the
// engagement. Best-effort: returns an empty set on listing failure.
export async function listGeneratedWorkpaperAcctNums(
  engagementId: string,
): Promise<Set<string>> {
  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .list(workpaperStoragePrefix(engagementId), { limit: 1000 });
  if (error || !data) return new Set();
  return new Set(
    data
      .map((f) => f.name)
      .filter((n) => n.endsWith(".xlsx"))
      .map((n) => n.replace(/\.xlsx$/, "")),
  );
}
