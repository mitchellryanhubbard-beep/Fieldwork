import { getEngagement } from "@/lib/engagement-repo";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { parseTrialBalance, type TrialBalanceAccount } from "@/lib/tb-parser";
import { findFsli } from "@/lib/workpaper-binder";
import type { AssertionKey } from "@/lib/procedure-library";
import {
  availableMethodologies,
  defaultMethodology,
  type MethodologyId,
} from "@/lib/sampling-methodologies";
import { loadWorkpaperSettings } from "@/lib/workpaper-settings";
import { loadParsedCanonical } from "@/lib/intake/storage";

export type ScopedAccountListing = {
  acctNum: string;
  name: string;
  cyBalance: number;
  pyBalance: number;
  scoping: string;
};

// Per-assertion methodology rows surfaced in the engagement page UI. The
// dropdown component receives this exact shape — server side resolves the
// "current" choice from settings.json (or falls back to the FSLI default).
export type AssertionMethodologyRow = {
  assertion: AssertionKey;
  methodologies: ReturnType<typeof availableMethodologies>;
  currentMethodology: MethodologyId;
};

// The standard AR assertions we surface in the methodology grid. Stable
// regardless of the matrix output so the page renders without a Claude
// call. Expand per FSLI as we light up more procedure-library coverage.
const DEFAULT_AR_ASSERTIONS: AssertionKey[] = [
  "Existence",
  "Completeness",
  "RightsAndObligations",
  "ValuationAndAllocation",
  "CutOff",
];

// Load the per-assertion methodology rows for one account. Looks up the
// auditor's saved choice; falls back to the FSLI default when nothing has
// been chosen yet.
export async function loadAccountMethodologyRows(
  engagementId: string,
  acctNum: string,
  fsli: string,
): Promise<AssertionMethodologyRow[]> {
  const settings = await loadWorkpaperSettings(engagementId, acctNum);
  const assertions = fsli === "Accounts Receivable, net" ? DEFAULT_AR_ASSERTIONS : [];
  return assertions.map((assertion) => {
    const methodologies = availableMethodologies(fsli, assertion);
    const stored = settings.perAssertion[assertion]?.methodology;
    const fallback = defaultMethodology(fsli, assertion);
    return {
      assertion,
      methodologies,
      currentMethodology: (stored ?? fallback) as MethodologyId,
    };
  });
}

// Returns every account in the requested FSLI from the engagement's TB
// (AR only in v1). Scoping is NOT derived from any TB column — that's
// Fieldwork's job, decided downstream via materiality + matrix. See the
// scoping-principle memory.
//
// Reads the canonical TB JSON from the intake layer first (works for any
// source format — xlsx/csv/pdf). Falls back to re-parsing the raw upload
// only for legacy uploads from before intake existed.
export async function listScopedAccountsForWorkpapers(
  engagementId: string,
  fsliFilter: string = "Accounts Receivable, net",
): Promise<ScopedAccountListing[]> {
  const detail = await getEngagement(engagementId);
  if (!detail || !detail.cyTrialBalanceFile) return [];
  if (detail.cyTrialBalanceFile.sizeBytes === 0) return [];

  let accounts: TrialBalanceAccount[] = [];
  const canonical = await loadParsedCanonical(engagementId, "cy_tb");
  if (canonical) {
    accounts = canonical.accounts;
  } else {
    try {
      const sb = getServerSupabase();
      const { data, error } = await sb.storage
        .from(ENGAGEMENT_FILES_BUCKET)
        .download(detail.cyTrialBalanceFile.storagePath);
      if (error || !data) return [];
      const buffer = Buffer.from(await data.arrayBuffer());
      const tb = await parseTrialBalance(buffer);
      accounts = tb.accounts;
    } catch {
      return [];
    }
  }

  return accounts
    .filter((a) => findFsli(a.acctNum, a.name) === fsliFilter)
    .map((a) => ({
      acctNum: a.acctNum,
      name: a.name,
      cyBalance: a.cyBalance,
      pyBalance: a.pyBalance,
      scoping: "",
    }));
}
