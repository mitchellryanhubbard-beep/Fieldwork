import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listEngagements } from "@/lib/engagement-repo";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";

export const dynamic = "force-dynamic";

export default async function HomePage() {
  let engagements: Awaited<ReturnType<typeof listEngagements>> = [];
  let loadError: string | null = null;

  try {
    engagements = await listEngagements();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-3xl font-semibold tracking-tight">Engagements</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Fieldwork — Engagement Setup. Captured inputs feed the assertion-risk
            matrix and downstream workpaper generation.
          </p>
        </div>
        <Link href="/app/engagements/new" className={buttonVariants()}>
          + New engagement
        </Link>
      </header>

      {loadError ? (
        <Card>
          <CardHeader>
            <CardTitle>Database not reachable</CardTitle>
            <CardDescription>
              Supabase credentials are missing or invalid. Set{" "}
              <code>SUPABASE_URL</code> and{" "}
              <code>SUPABASE_SERVICE_ROLE_KEY</code> in <code>.env.local</code>{" "}
              and apply the migration in{" "}
              <code>web/supabase/migrations/</code>.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="overflow-x-auto rounded bg-muted p-3 text-xs">
              {loadError}
            </pre>
          </CardContent>
        </Card>
      ) : engagements.length === 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>No engagements yet</CardTitle>
            <CardDescription>
              Create one to capture client info, materiality, risk profile, and
              the prior-year audit + current-year trial balance.
            </CardDescription>
          </CardHeader>
        </Card>
      ) : (
        <ul className="grid gap-3">
          {engagements.map((e) => (
            <li key={e.id}>
              <Link
                href={`/app/engagements/${e.id}`}
                className="block rounded-lg border bg-card p-4 transition-colors hover:bg-muted/50"
              >
                <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                  <span className="text-base font-medium">{e.clientName}</span>
                  <span className="text-xs text-muted-foreground">
                    Updated {new Date(e.updatedAt).toLocaleString()}
                  </span>
                </div>
                <div className="mt-1 text-sm text-muted-foreground">
                  FYE {e.fiscalYearEnd} ·{" "}
                  {FRAMEWORK_LABELS[
                    e.framework as keyof typeof FRAMEWORK_LABELS
                  ] ?? e.framework}{" "}
                  ·{" "}
                  {INDUSTRY_LABELS[
                    e.industry as keyof typeof INDUSTRY_LABELS
                  ] ?? e.industry}
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
