import { exportEngagement } from "@/lib/engagement-repo";
import { generateAssertionMatrix } from "@/lib/assertion-matrix-generator";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { parseTrialBalance, type TrialBalance } from "@/lib/tb-parser";
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

  // Load the parsed TB once for the binder side (lead sheets need it). The
  // matrix generator does its own parse pass — duplicated, but each path
  // benefits from being self-contained.
  let trialBalance: TrialBalance | null = null;
  if (engagement.cyTrialBalanceFile.sizeBytes > 0) {
    try {
      const sb = getServerSupabase();
      const { data, error } = await sb.storage
        .from(ENGAGEMENT_FILES_BUCKET)
        .download(engagement.cyTrialBalanceFile.storagePath);
      if (error || !data) {
        throw new Error(`storage download: ${error?.message ?? "no data"}`);
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      trialBalance = await parseTrialBalance(buffer);
    } catch {
      trialBalance = null;
    }
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
