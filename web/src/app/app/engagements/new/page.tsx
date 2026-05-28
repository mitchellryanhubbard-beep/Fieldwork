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
          href="/app"
          className="text-foreground/60 hover:text-foreground hover:underline"
        >
          ← Engagements
        </Link>
      </nav>

      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          New engagement
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-primary">
          Capture the engagement.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-foreground/70">
          Client + framework, materiality, current-year risk picture, and
          significant business changes. Source files (PY Audit + CY Trial
          Balance) are uploaded on the next screen.
        </p>
      </header>

      <EngagementForm
        mode="create"
        onSubmitAction={handleCreate}
        startingNumber={1}
      />
    </main>
  );
}
