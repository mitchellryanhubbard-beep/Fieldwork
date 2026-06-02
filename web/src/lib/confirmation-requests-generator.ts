import { exportEngagement } from "@/lib/engagement-repo";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { generateConfirmationRequests } from "@/lib/confirmation-requests";
import { findFsli } from "@/lib/workpaper-binder";
import { hasFsliInLibrary } from "@/lib/procedure-library";
import {
  defaultMethodology,
  runSampling,
  type SampleResult,
} from "@/lib/sampling-methodologies";
import { loadWorkpaperSettings } from "@/lib/workpaper-settings";
import { downloadFilename } from "@/lib/account-workpaper-generator";
import {
  loadArAgingForEngagement,
  loadTrialBalanceForEngagement,
  requireUploadsConfirmed,
} from "@/lib/intake/load-canonical";

export type ConfirmationsResult = {
  buffer: Buffer;
  filename: string;
  storagePath: string;
  customerCount: number;
};

export function confirmationsStoragePath(
  engagementId: string,
  acctNum: string,
): string {
  return `engagements/${engagementId}/workpapers/${acctNum}-confirmations.xlsx`;
}

// Generate the confirmation-requests workbook for a single AR account.
// Re-uses the AR Existence sample that's already locked in settings.json
// so the customers asked to confirm match the customers tested in the
// workpaper.
export async function generateConfirmationsById(
  engagementId: string,
  acctNum: string,
): Promise<ConfirmationsResult> {
  const engagement = await exportEngagement(engagementId);

  if (engagement.cyTrialBalanceFile.sizeBytes === 0) {
    throw new Error(
      "Cannot generate confirmations — CY Trial Balance file has not been uploaded.",
    );
  }

  // Verification gate. Confirmations need both the TB (for account
  // resolution) and the AR Aging (for the invoice list on each letter).
  await requireUploadsConfirmed(engagementId, ["cy_tb", "ar_aging"]);

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
      `No confirmation template for FSLI "${fsli}" yet. v1 supports Accounts Receivable.`,
    );
  }

  const aging = await loadArAgingForEngagement(engagementId);
  if (!aging) {
    throw new Error(
      "Cannot generate confirmations — AR Aging file has not been uploaded.",
    );
  }

  // Re-run sampling with the locked seed so confirmations match the
  // workpaper's selections one-for-one.
  const settings = await loadWorkpaperSettings(engagementId, acctNum);
  const stored = settings.perAssertion["Existence"];
  const methodology = stored?.methodology ?? defaultMethodology(fsli, "Existence");
  let sample: SampleResult | null = null;
  if (methodology === "highCoverageHybrid") {
    sample = runSampling({
      methodology,
      aging,
      performanceMateriality: engagement.materiality.performanceMateriality,
      engagementId,
      acctNum,
      assertion: "Existence",
      seed: stored?.seed,
      params: stored?.params,
    });
  }
  if (!sample || sample.selections.length === 0) {
    throw new Error(
      "Cannot generate confirmations — no Existence sample exists. Generate the AR workpaper first.",
    );
  }

  const buffer = await generateConfirmationRequests({
    engagement,
    account: { acctNum: account.acctNum, name: account.name },
    aging,
    selections: sample.selections,
    asOfDate: engagement.client.fiscalYearEnd,
  });

  const filename = downloadFilename(engagement, account.acctNum, account.name)
    .replace(/\.xlsx$/, "-Confirmations.xlsx");
  const storagePath = confirmationsStoragePath(engagementId, account.acctNum);

  const sb = getServerSupabase();
  const { error: uploadError } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(storagePath, buffer, {
      contentType:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      upsert: true,
    });
  if (uploadError) {
    throw new Error(`confirmations upload failed: ${uploadError.message}`);
  }

  return {
    buffer,
    filename,
    storagePath,
    customerCount: sample.selections.length,
  };
}

// Mirrors loadAccountWorkpaperById: fetch the stored xlsx and stream back.
export async function loadConfirmationsById(
  engagementId: string,
  acctNum: string,
): Promise<ConfirmationsResult> {
  const engagement = await exportEngagement(engagementId);
  const storagePath = confirmationsStoragePath(engagementId, acctNum);

  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(storagePath);
  if (error || !data) {
    throw new Error(`No stored confirmations for account ${acctNum}.`);
  }
  const buffer = Buffer.from(await data.arrayBuffer());

  // Recover the friendly filename via the canonical TB.
  let accountName = acctNum;
  const tb = await loadTrialBalanceForEngagement(engagementId);
  if (tb) {
    const acct = tb.accounts.find((a) => a.acctNum === acctNum);
    if (acct) accountName = acct.name;
  }
  const filename = downloadFilename(engagement, acctNum, accountName).replace(
    /\.xlsx$/,
    "-Confirmations.xlsx",
  );

  return { buffer, filename, storagePath, customerCount: 0 };
}

// Deletes the stored confirmations xlsx for one account.
export async function deleteConfirmationsFile(
  engagementId: string,
  acctNum: string,
): Promise<void> {
  const sb = getServerSupabase();
  await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .remove([confirmationsStoragePath(engagementId, acctNum)]);
}

// Returns the set of acctNums that have stored confirmations for this
// engagement — so the page can show "View confirmations" instead of
// "Generate confirmations" on second load.
export async function listGeneratedConfirmationAcctNums(
  engagementId: string,
): Promise<Set<string>> {
  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .list(`engagements/${engagementId}/workpapers`, { limit: 1000 });
  if (error || !data) return new Set();
  return new Set(
    data
      .map((f) => f.name)
      .filter((n) => n.endsWith("-confirmations.xlsx"))
      .map((n) => n.replace(/-confirmations\.xlsx$/, "")),
  );
}

