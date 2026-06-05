import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkpapersSection } from "@/components/workpapers-section";
import { Chip } from "@/components/ui/chip";
import { listScopedAccountsForWorkpapers } from "@/lib/account-workpaper-listing";
import { listGeneratedWorkpaperAcctNums } from "@/lib/account-workpaper-generator";
import { listGeneratedConfirmationAcctNums } from "@/lib/confirmation-requests-generator";
import { listPyWorkpapers, type PyWorkpaper } from "@/lib/py-workpaper-repo";
import { findFsli } from "@/lib/workpaper-binder";
import { loadVerification, type VerificationRecord } from "@/lib/intake/storage";
import {
  KIND_LABELS,
  PARSEABLE_KINDS,
  type ParseableKind,
} from "@/lib/intake/canonical";
import { getEngagement } from "@/lib/engagement-repo";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";

export const dynamic = "force-dynamic";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

type Params = { id: string };

export default async function EngagementWorkpapersPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const detail = await getEngagement(id);
  if (!detail) notFound();

  const [
    arAccounts,
    generatedAcctNums,
    generatedConfirmationAcctNums,
    verifications,
    pyWorkpapers,
  ] = await Promise.all([
    listScopedAccountsForWorkpapers(id),
    listGeneratedWorkpaperAcctNums(id),
    listGeneratedConfirmationAcctNums(id),
    Promise.all(
      PARSEABLE_KINDS.map(async (k) => [k, await loadVerification(id, k)] as const),
    ).then((entries) => Object.fromEntries(entries)),
    listPyWorkpapers(id),
  ]);

  const pyWorkpapersByFsli: Record<string, PyWorkpaper[]> = {};
  for (const py of pyWorkpapers) {
    if (!py.fsli) continue;
    (pyWorkpapersByFsli[py.fsli] ??= []).push(py);
  }
  const fsliByAcctNum: Record<string, string> = {};
  for (const a of arAccounts) {
    fsliByAcctNum[a.acctNum] = findFsli(a.acctNum, a.name);
  }

  const workpaperBlocker = blockingReason(verifications, [
    "cy_tb",
    "ar_aging",
    "subsequent_cash_receipts",
  ]);
  const confirmationsBlocker = blockingReason(verifications, [
    "cy_tb",
    "ar_aging",
  ]);

  const v = detail.values;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm">
        <Link
          href={`/app/engagements/${id}#section-6`}
          className="text-foreground/60 hover:text-foreground hover:underline"
        >
          ← {v.clientName || "Engagement"}
        </Link>
      </nav>

      <header className="mb-10">
        <h1 className="font-display text-3xl font-medium tracking-tight text-primary">
          Accounts Receivable Workpapers
        </h1>
        {(() => {
          const cyTotal = arAccounts.reduce((s, a) => s + a.cyBalance, 0);
          const pyTotal = arAccounts.reduce((s, a) => s + a.pyBalance, 0);
          return (
            <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground/70">
              <Chip>{FRAMEWORK_LABELS[v.framework]}</Chip>
              <Chip>{INDUSTRY_LABELS[v.industry]}</Chip>
              <span className="font-mono text-sm">FYE {v.fiscalYearEnd}</span>
              <span className="text-foreground/40">·</span>
              <span className="font-mono text-sm">
                CY {USD.format(cyTotal)}
              </span>
              <span className="font-mono text-sm text-foreground/55">
                PY {USD.format(pyTotal)}
              </span>
            </div>
          );
        })()}
        <p className="mt-4 max-w-2xl text-sm text-foreground/70">
          PY files can be uploaded and rolled forward into the CY pane or you
          can generate a new workpaper utilizing the link at the bottom.
        </p>
      </header>

      <WorkpapersSection
        engagementId={id}
        accounts={arAccounts}
        generatedAcctNums={Array.from(generatedAcctNums)}
        generatedConfirmationAcctNums={Array.from(
          generatedConfirmationAcctNums,
        )}
        hasArAging={
          !!detail.arAgingFile && detail.arAgingFile.sizeBytes > 0
        }
        hasTrialBalance={
          !!detail.cyTrialBalanceFile &&
          detail.cyTrialBalanceFile.sizeBytes > 0
        }
        pyWorkpapers={pyWorkpapers}
        pyWorkpapersByFsli={pyWorkpapersByFsli}
        fsliByAcctNum={fsliByAcctNum}
        workpaperBlockedReason={workpaperBlocker}
        confirmationsBlockedReason={confirmationsBlocker}
      />
    </main>
  );
}

function blockingReason(
  verifications: Partial<Record<ParseableKind, VerificationRecord | null>>,
  requiredKinds: ParseableKind[],
): string | undefined {
  const blockers: string[] = [];
  for (const kind of requiredKinds) {
    const v = verifications[kind];
    if (!v) continue;
    if (v.status === "confirmed") continue;
    if (v.status === "pending") {
      blockers.push(`${KIND_LABELS[kind]}: confirm on Verify page`);
    } else if (v.status === "failed") {
      blockers.push(`${KIND_LABELS[kind]}: parse failed, use manual mapping`);
    }
  }
  if (blockers.length === 0) return undefined;
  return `Blocked — ${blockers.join(" · ")}`;
}
