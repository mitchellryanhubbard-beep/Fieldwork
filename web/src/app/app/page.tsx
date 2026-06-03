import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Chip } from "@/components/ui/chip";
import { DeleteEngagementButton } from "@/components/delete-engagement-button";
import { listEngagements } from "@/lib/engagement-repo";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";
import { deleteEngagementAction } from "./engagements/actions";

export const dynamic = "force-dynamic";

// Returns "FY2024 Audits" when every engagement shares a fiscal year (the
// common case), or "All engagements" when the list spans multiple years.
function deriveHeading(
  engagements: Awaited<ReturnType<typeof listEngagements>>,
): string {
  if (engagements.length === 0) return "All engagements";
  const years = new Set(engagements.map((e) => e.fiscalYearEnd.slice(0, 4)));
  if (years.size === 1) {
    const [year] = years;
    return `FY${year} Audits`;
  }
  return "All engagements";
}

export default async function AppHome() {
  let engagements: Awaited<ReturnType<typeof listEngagements>> = [];
  let loadError: string | null = null;

  try {
    engagements = await listEngagements();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  const heading = deriveHeading(engagements);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        Engagements
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-medium tracking-tight text-primary">
          {heading}
        </h1>
        <Link
          href="/app/engagements/new"
          className={buttonVariants({ variant: "gold" })}
        >
          + New engagement
        </Link>
      </div>

      <div className="mt-10">
        {loadError ? (
          <Card>
            <CardHeader>
              <CardTitle>Database not reachable</CardTitle>
              <CardDescription>
                Supabase credentials are missing or invalid. Set{" "}
                <code>SUPABASE_URL</code> and{" "}
                <code>SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
                <code>.env.local</code> and apply the migration in{" "}
                <code>web/supabase/migrations/</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">
                {loadError}
              </pre>
            </CardContent>
          </Card>
        ) : engagements.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No engagements yet</CardTitle>
              <CardDescription>
                Create one to capture client info, materiality, risk profile,
                and the prior-year audit + current-year trial balance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/app/engagements/new"
                className={buttonVariants({ variant: "gold" })}
              >
                + New engagement
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ol className="grid gap-3">
            {engagements.map((e, i) => {
              // Inline server action bound to this engagement's id. Wrapping
              // it here so the row's <DeleteEngagementButton> can fire it
              // after a native confirm.
              async function handleDelete() {
                "use server";
                await deleteEngagementAction(e.id);
              }
              return (
                <li
                  key={e.id}
                  className="group relative flex overflow-hidden rounded-xl border border-primary/10 bg-card transition-colors hover:border-accent/40 focus-within:border-accent/40"
                >
                  <Link
                    href={`/app/engagements/${e.id}`}
                    className="flex flex-1 gap-4 p-5 transition-colors group-hover:bg-secondary/50"
                  >
                    <span
                      aria-hidden="true"
                      className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-full bg-secondary font-mono text-sm font-semibold text-primary group-hover:bg-accent group-hover:text-primary"
                    >
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                        <span className="font-display text-xl font-medium text-primary group-hover:underline">
                          {e.clientName}
                        </span>
                        <span className="text-xs uppercase tracking-[0.14em] text-foreground/50">
                          Updated {new Date(e.updatedAt).toLocaleString()}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-2">
                        <Chip>
                          {INDUSTRY_LABELS[
                            e.industry as keyof typeof INDUSTRY_LABELS
                          ] ?? e.industry}
                        </Chip>
                        <Chip>
                          {FRAMEWORK_LABELS[
                            e.framework as keyof typeof FRAMEWORK_LABELS
                          ] ?? e.framework}
                        </Chip>
                        <span className="font-mono text-sm text-foreground/70">
                          FYE {e.fiscalYearEnd}
                        </span>
                      </div>
                    </div>
                  </Link>
                  {/* Delete slides in from the right at lg+. Default w-0
                      with overflow-hidden so the panel is collapsed; on
                      group-hover/focus the column expands to w-24 and
                      the destructive button is revealed. Mobile keeps it
                      always visible since there's no hover. */}
                  <div className="flex w-24 overflow-hidden lg:w-0 lg:transition-[width] lg:duration-200 lg:ease-out lg:group-hover:w-24 lg:group-focus-within:w-24">
                    <DeleteEngagementButton
                      clientName={e.clientName}
                      action={handleDelete}
                      className="flex h-full w-24 shrink-0 items-center justify-center bg-destructive text-sm font-medium text-destructive-foreground transition-colors hover:bg-destructive/85 disabled:opacity-60"
                    />
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </div>
    </main>
  );
}
