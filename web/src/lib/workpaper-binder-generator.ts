import { exportEngagement } from "@/lib/engagement-repo";
import { generateAssertionMatrix } from "@/lib/assertion-matrix-generator";
import {
  loadTrialBalanceForEngagement,
  requireUploadsConfirmed,
} from "@/lib/intake/load-canonical";
import type { TrialBalance } from "@/lib/tb-parser";
import { generateWorkpaperBinder } from "@/lib/workpaper-binder";

export type BinderGenerationResult = {
  buffer: Buffer;
  filename: string;
  matrixRowCount: number;
  tbAccountCount: number;
};

// Top-level: load engagement → fetch + parse TB → generate matrix → build
// the workbook. Matrix generation reuses the same path the matrix endpoint
// uses, so the binder always reflects the current engagement state.
export async function generateBinder(
  engagementId: string,
): Promise<BinderGenerationResult> {
  const engagement = await exportEngagement(engagementId);

  // Verification gate — the binder reads the canonical TB for lead sheets,
  // and the matrix prompt path also reads it. Block if uploaded but not
  // confirmed. AR Aging + SCR aren't currently consumed by the binder, so
  // they're not required here.
  await requireUploadsConfirmed(engagementId, ["cy_tb"]);

  // Load the canonical TB once for the binder side (lead sheets need it).
  // The matrix generator does its own load pass.
  let trialBalance: TrialBalance | null = null;
  if (engagement.cyTrialBalanceFile.sizeBytes > 0) {
    trialBalance = await loadTrialBalanceForEngagement(engagementId);
  }

  const { matrix } = await generateAssertionMatrix(engagementId);

  const buffer = await generateWorkpaperBinder({
    engagement,
    matrix,
    trialBalance,
  });

  const safeClient = engagement.client.name
    .replace(/[^A-Za-z0-9-]+/g, "_")
    .slice(0, 40);
  const fy = engagement.client.fiscalYearEnd.slice(0, 4);
  const filename = `${safeClient}-FY${fy}-Workpaper-Binder.xlsx`;

  return {
    buffer,
    filename,
    matrixRowCount: matrix.rows.length,
    tbAccountCount: trialBalance?.accounts.length ?? 0,
  };
}
