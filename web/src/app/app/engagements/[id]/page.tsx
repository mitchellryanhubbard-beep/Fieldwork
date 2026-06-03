import Link from "next/link";
import { notFound } from "next/navigation";
import { EngagementForm } from "@/components/engagement-form";
import { FileUpload } from "@/components/file-upload";
import { GenerateBinderButton } from "@/components/generate-binder-button";
import { GenerateMatrixButton } from "@/components/generate-matrix-button";
import { NumberedSection } from "@/components/numbered-section";
import { buttonVariants } from "@/components/ui/button";
import { DeleteEngagementButton } from "@/components/delete-engagement-button";
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
          <DeleteEngagementButton
            clientName={v.clientName || "this engagement"}
            action={handleDelete}
          />
        </div>
      </header>

      <div className="space-y-6">
        <EngagementForm
          mode="edit"
          defaultValues={detail.values}
          onSubmitAction={handleUpdate}
          startingNumber={1}
        />

        <NumberedSection
          n={4}
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
          n={5}
          title="Generate"
          description="Generate the workpaper binder (scoping memo + assertion plan + lead sheets) and the standalone assertion-risk matrix workbook from the inputs above."
        >
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
          </div>
        </NumberedSection>

        <NumberedSection
          n={6}
          title="Support and Workpapers"
          description="Source documents and workpapers organized by financial-statement line item. Expand each FSLI to upload its supporting schedules and open its workpapers."
        >
          <FsliBreakdown
            engagementId={id}
            schedulesByFsli={{
              "accounts-receivable": (
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
              ),
            }}
            workpapersByFsli={{
              "accounts-receivable": (
                <div className="space-y-3">
                  <p className="text-xs text-foreground/60">
                    PY files can be uploaded for reference or rolled forward
                    into the CY pane. Each scoped account gets its own
                    workpaper and confirmation request set.
                  </p>
                  <Link
                    href={`/app/engagements/${id}/workpapers`}
                    className={`${buttonVariants({ variant: "gold", size: "sm" })} w-fit`}
                  >
                    Open AR workpapers →
                  </Link>
                </div>
              ),
            }}
          />
        </NumberedSection>
      </div>
    </main>
  );
}

// Trial balance breakdown by financial-statement line item. Each FSLI
// expands to its own Supporting Schedules and Workpapers links. Routes
// are placeholders until per-FSLI pages exist.
const FSLIS = [
  { slug: "cash", name: "Cash" },
  { slug: "accounts-receivable", name: "Accounts Receivable" },
  { slug: "inventory", name: "Inventory" },
  { slug: "ppe", name: "PP&E" },
  { slug: "accounts-payable", name: "Accounts Payable" },
  { slug: "revenue", name: "Revenue" },
  { slug: "opex", name: "OPEX" },
];

type FsliBreakdownProps = {
  engagementId: string;
  schedulesByFsli?: Record<string, React.ReactNode>;
  workpapersByFsli?: Record<string, React.ReactNode>;
};

function FsliBreakdown({
  engagementId: _engagementId,
  schedulesByFsli = {},
  workpapersByFsli = {},
}: FsliBreakdownProps) {
  return (
    <div className="rounded-xl border border-primary/10 bg-card p-5">
      <ul className="space-y-2">
        {FSLIS.map((f) => (
          <li key={f.slug}>
            <details className="group rounded-md border border-primary/10 bg-background/60">
              <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-sm font-medium text-primary [&::-webkit-details-marker]:hidden">
                <span>{f.name}</span>
                <span className="text-xs text-primary/40 transition group-open:rotate-90">
                  ▸
                </span>
              </summary>
              <div className="space-y-2 border-t border-primary/10 px-4 py-3">
                <FsliChild
                  label="Supporting Schedules"
                  content={schedulesByFsli[f.slug]}
                />
                <FsliChild
                  label="Workpapers"
                  content={workpapersByFsli[f.slug]}
                />
              </div>
            </details>
          </li>
        ))}
      </ul>
    </div>
  );
}

// A single child row under an FSLI. If `content` is provided, render a
// nested <details> with the title as the summary so the user can drill
// straight into the schedule uploads or workpaper links. Otherwise show a
// placeholder link until that FSLI gets wired up.
function FsliChild({
  label,
  content,
}: {
  label: string;
  content?: React.ReactNode;
}) {
  if (!content) {
    return (
      <Link
        href="#"
        className="block text-sm text-primary/75 hover:text-primary hover:underline"
      >
        {label}
      </Link>
    );
  }
  return (
    <details className="group/inner rounded border border-primary/10 bg-background">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2 text-sm text-primary [&::-webkit-details-marker]:hidden">
        <span>{label}</span>
        <span className="text-xs text-primary/40 transition group-open/inner:rotate-90">
          ▸
        </span>
      </summary>
      <div className="border-t border-primary/10 px-3 py-3">{content}</div>
    </details>
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
