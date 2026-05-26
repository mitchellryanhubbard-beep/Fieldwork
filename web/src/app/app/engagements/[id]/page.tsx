import Link from "next/link";
import { notFound } from "next/navigation";
import { EngagementForm } from "@/components/engagement-form";
import { FileUpload } from "@/components/file-upload";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getEngagement } from "@/lib/engagement-repo";
import type { EngagementFormValues } from "@/lib/engagement-schema";
import { deleteEngagementAction, updateEngagementAction } from "../actions";

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

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm">
        <Link
          href="/app"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Engagements
        </Link>
      </nav>
      <header className="mb-8 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {detail.values.clientName || "Untitled engagement"}
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Engagement ID <code>{id}</code> · Last updated{" "}
            {new Date(detail.updatedAt).toLocaleString()}
          </p>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/app/engagements/${id}/export`}
            className={buttonVariants({ variant: "secondary" })}
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

      <section className="mb-10 space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>Source files</CardTitle>
            <CardDescription>
              Upload the prior-year audit (PDF) and the current-year trial
              balance (Excel or CSV). Replacing an upload removes the prior
              file from storage.
            </CardDescription>
          </CardHeader>
        </Card>
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
      </section>

      <EngagementForm
        mode="edit"
        defaultValues={detail.values}
        onSubmitAction={handleUpdate}
      />
    </main>
  );
}
