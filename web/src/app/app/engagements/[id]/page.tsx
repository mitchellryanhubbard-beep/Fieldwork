import Link from "next/link";
import { notFound } from "next/navigation";
import { EngagementForm } from "@/components/engagement-form";
import { FileUpload } from "@/components/file-upload";
import { NumberedSection } from "@/components/numbered-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
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

type Params = { id: string };

export default async function EditEngagementPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const detail = await getEngagement(id);
  if (!detail) notFound();

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
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground/70">
            <Chip>{FRAMEWORK_LABELS[v.framework]}</Chip>
            <Chip>{INDUSTRY_LABELS[v.industry]}</Chip>
            <span className="font-mono text-sm">FYE {v.fiscalYearEnd}</span>
          </div>
        </div>
        <div className="flex gap-2">
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
        <NumberedSection
          n={1}
          title="Source files"
          description="Prior-year signed audit opinion (PDF) and current-year trial balance (Excel or CSV). Replacing an upload removes the prior file from storage."
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
              title="CY Trial Balance (Excel or CSV)"
              description="Current-year trial balance as exported from the client's GL."
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              current={detail.cyTrialBalanceFile}
            />
          </div>
        </NumberedSection>

        <EngagementForm
          mode="edit"
          defaultValues={detail.values}
          onSubmitAction={handleUpdate}
        />
      </div>
    </main>
  );
}
