import Link from "next/link";
import { EngagementForm } from "@/components/engagement-form";
import type { EngagementFormValues } from "@/lib/engagement-schema";
import { createEngagementAction } from "../actions";

export default function NewEngagementPage() {
  async function handleCreate({ values }: { values: EngagementFormValues }) {
    "use server";
    return createEngagementAction(values);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm">
        <Link
          href="/"
          className="text-muted-foreground hover:text-foreground hover:underline"
        >
          ← Engagements
        </Link>
      </nav>
      <header className="mb-8">
        <h1 className="text-2xl font-semibold tracking-tight">New engagement</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Capture the client, framework, materiality, and CY risk picture.
          Files (PY Audit and CY Trial Balance) are uploaded after the
          engagement is created.
        </p>
      </header>

      <EngagementForm mode="create" onSubmitAction={handleCreate} />
    </main>
  );
}
