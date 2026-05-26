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
import { listEngagements } from "@/lib/engagement-repo";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";

export const dynamic = "force-dynamic";

export default async function AppHome() {
  let engagements: Awaited<ReturnType<typeof listEngagements>> = [];
  let loadError: string | null = null;

  try {
    engagements = await listEngagements();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        Engagements
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-medium tracking-tight text-primary">
          FY2024 Audits
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
          <ul className="grid gap-3">
            {engagements.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/app/engagements/${e.id}`}
                  className="block rounded-xl border border-primary/10 bg-card p-5 transition-colors hover:bg-secondary/50"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <span className="font-display text-xl font-medium text-primary">
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
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
