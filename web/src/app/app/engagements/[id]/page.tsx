import Link from "next/link";
import { notFound } from "next/navigation";
import { EngagementForm } from "@/components/engagement-form";
import { FileUpload } from "@/components/file-upload";
import { GenerateBinderButton } from "@/components/generate-binder-button";
import { GenerateMatrixButton } from "@/components/generate-matrix-button";
import { NumberedSection } from "@/components/numbered-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { loadVerification, type VerificationRecord } from "@/lib/intake/storage";
import {
  KIND_LABELS,
  PARSEABLE_KINDS,
  type ParseableKind,
} from "@/lib/intake/canonical";
import { getEngagement } from "@/lib/engagement-repo";
import type { EngagementFormValues } from "@/lib/engagement-schema";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";
import {
  deleteEngagementAction,
  updateEngagementAction,
} from "../actions";

export const dynamic = "force-dynamic";

const USD_COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

type Params = { id: string };

export default async function EditEngagementPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const detail = await getEngagement(id);
  if (!detail) notFound();

  const verifications = await Promise.all(
    PARSEABLE_KINDS.map(async (k) => [k, await loadVerification(id, k)] as const),
  ).then((entries) => Object.fromEntries(entries));

  // Verification gate — build a friendly "blocking" reason per generator
  // so the buttons can disable + show a tooltip when an upload is pending
  // or failed. Server-side enforcement (requireUploadsConfirmed) is the
  // source of truth; this just keeps the UI honest about why a button is
  // grey.
  const binderBlocker = blockingReason(verifications, ["cy_tb"]);

  async function handleUpdate({ values }: { values: EngagementFormValues }) {
    "use server";
    return updateEngagementAction(id, values);
  }

  async function handleDelete() {
    "use server";
    await deleteEngagementAction(id);
  }

  const v = detail.values;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm">
        <Link
          href="/app"
          className="text-foreground/60 hover:text-foreground hover:underline"
        >
          ← Engagements
        </Link>
      </nav>

      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight text-primary">
            {v.clientName || "Untitled engagement"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-foreground/70">
            <Chip>{FRAMEWORK_LABELS[v.framework]}</Chip>
            <Chip>{INDUSTRY_LABELS[v.industry]}</Chip>
            <span className="font-mono text-sm">
              FYE {v.fiscalYearEnd}
              <span className="text-foreground/40"> &middot; </span>
              M {USD_COMPACT.format(v.overallMateriality)}
              <span className="text-foreground/40"> &middot; </span>
              PM {USD_COMPACT.format(v.performanceMateriality)}
              <span className="text-foreground/40"> &middot; </span>
              CTT {USD_COMPACT.format(v.clearlyTrivialThreshold)}
            </span>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <GenerateBinderButton
            engagementId={id}
            clientName={v.clientName || "engagement"}
            generationBlockedReason={binderBlocker}
          />
          <GenerateMatrixButton
            engagementId={id}
            clientName={v.clientName || "engagement"}
          />
          <Link
            href={`/app/engagements/${id}/export`}
            className={buttonVariants({ variant: "goldOutline" })}
          >
            Export JSON
          </Link>
          <form action={handleDelete}>
            <Button type="submit" variant="destructive">
              Delete
            </Button>
          </form>
        </div>
      </header>

      <div className="space-y-12">
        <EngagementForm
          mode="edit"
          defaultValues={detail.values}
          onSubmitAction={handleUpdate}
          startingNumber={1}
        />

        <NumberedSection
          n={5}
          title="Source files"
          description="Prior-year signed audit opinion (PDF) and current-year trial balance (Excel, CSV, or PDF). Replacing an upload removes the prior file from storage."
        >
          <div className="space-y-4">
            <FileUpload
              engagementId={id}
              kind="py_audit"
              title="PY Audit (PDF)"
              description="Signed audit opinion + accompanying issued financial statements only — not the full PY binder."
              accept="application/pdf,.pdf"
              current={detail.pyAuditFile}
            />
            <FileUpload
              engagementId={id}
              kind="cy_tb"
              title="CY Trial Balance (Excel, CSV, or PDF)"
              description="Current-year trial balance as exported from the client's GL. We'll extract the structured data on upload."
              accept=".xlsx,.xls,.csv,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/pdf"
              current={detail.cyTrialBalanceFile}
              verification={verifications.cy_tb}
            />
          </div>
        </NumberedSection>

        <NumberedSection
          n={6}
          title="Supporting Schedules"
          description="Client-provided supporting schedules used during fieldwork — agings, listings, rolls, and confirmations. Each FSLI brings its own set as we add coverage."
        >
          <div className="space-y-4">
            <FileUpload
              engagementId={id}
              kind="ar_aging"
              title="AR Aging — by Customer + Invoice"
              description="Open AR as of the balance-sheet date, broken down by invoice under each customer with standard aging buckets (Current, 1-30, 31-60, 61-90, 90+). Excel, CSV, or PDF — we'll extract the structured data on upload."
              accept=".xlsx,.xls,.csv,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/pdf"
              current={detail.arAgingFile}
              verification={verifications.ar_aging}
            />
            <FileUpload
              engagementId={id}
              kind="subsequent_cash_receipts"
              title="Subsequent Cash Receipts"
              description="Cash receipts collected after the balance-sheet date, applied against pre-YE invoices. Powers the Existence + Valuation substantive test (receipt-to-invoice matching, % collected within 30/60 days, aged-uncollected flagging)."
              accept=".xlsx,.xls,.csv,.pdf,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv,application/pdf"
              current={detail.subsequentCashReceiptsFile}
              verification={verifications.subsequent_cash_receipts}
            />
          </div>
        </NumberedSection>

        <NumberedSection
          n={7}
          title="Workpapers"
          description="PY files can be uploaded for reference or rolled forward into the CY pane. Each scoped account gets its own workpaper and confirmation request set."
        >
          <Link
            href={`/app/engagements/${id}/workpapers`}
            className={`${buttonVariants({ variant: "gold" })} w-fit`}
          >
            Open workpapers →
          </Link>
        </NumberedSection>
      </div>
    </main>
  );
}

// Builds a short, user-facing reason a generator is blocked, mirroring the
// requireUploadsConfirmed server-side enforcement. Returns undefined when
// every required upload is either absent (silent degrade) or confirmed.
function blockingReason(
  verifications: Partial<Record<ParseableKind, VerificationRecord | null>>,
  requiredKinds: ParseableKind[],
): string | undefined {
  const blockers: string[] = [];
  for (const kind of requiredKinds) {
    const v = verifications[kind];
    if (!v) continue; // no upload, generator degrades silently
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
