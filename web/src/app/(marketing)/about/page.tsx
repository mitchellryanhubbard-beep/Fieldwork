import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "About — first-pass.io",
  description:
    "first-pass.io is built by a Fractional Controller for the auditors who do the actual fieldwork. We turn the first pass of every engagement into a workpaper, not a blank Excel sheet.",
};

export default function AboutPage() {
  return (
    <main>
      {/* Title band — matches the cream-tan banded sections elsewhere */}
      <section
        style={{ backgroundColor: "var(--color-fw-band)" }}
        className="pb-20 pt-20 sm:pt-28"
      >
        <div className="mx-auto w-full max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            About
          </p>
          <h1 className="mt-4 font-display text-4xl font-medium leading-[1.05] tracking-tight text-primary sm:text-5xl">
            Built by a controller. For the auditors who do the fieldwork.
          </h1>
          <p className="mt-6 text-lg leading-relaxed text-foreground/75">
            first-pass.io turns the blank-page problem of audit fieldwork into a
            head-start. Upload the trial balance, prior-year audit, and
            supporting schedules; we draft the scoping memo, assertion-risk
            matrix, and per-FSLI lead sheets — in Excel — before you open your
            first workpaper.
          </p>
        </div>
      </section>

      {/* Body */}
      <section className="bg-background pb-24 pt-16">
        <div className="mx-auto grid w-full max-w-3xl gap-12 px-6 text-foreground/80">
          <Block title="Why we exist">
            <p>
              Most audit work begins with a senior staff member duplicating
              last year&apos;s binder, opening Excel, and recreating the same
              workpapers from scratch. The first pass is busywork — and it&apos;s
              where new staff spend the largest share of their first three
              years.
            </p>
            <p className="mt-4">
              We think first-pass work should arrive done. Not perfect, not
              signed-off — but structurally complete, with the data already
              flowing and the procedures already drafted. That way the
              auditor&apos;s job becomes what it was always supposed to be:
              skepticism, judgment, and conclusions.
            </p>
          </Block>

          <Block title="What we believe">
            <ul className="space-y-3">
              <Bullet>
                <span className="font-semibold text-primary">
                  Excel is the audit OS.
                </span>{" "}
                Not a SaaS dashboard. The workpaper, the tickmark, the formula
                — that&apos;s the audit. We meet auditors where they already
                work.
              </Bullet>
              <Bullet>
                <span className="font-semibold text-primary">
                  AI flags. Auditors conclude.
                </span>{" "}
                Every exception we surface is a lead for a human to investigate
                — never an automatic conclusion. The audit opinion stays with
                the person who signs the report.
              </Bullet>
              <Bullet>
                <span className="font-semibold text-primary">
                  Every cell has a source.
                </span>{" "}
                Generated values link back to the prompt, the input row, and the
                reasoning. No black boxes. If a partner asks &quot;where did
                that come from?&quot;, the workpaper answers.
              </Bullet>
              <Bullet>
                <span className="font-semibold text-primary">
                  Zero-retention by default.
                </span>{" "}
                Client data sent to the AI backend is configured for
                zero-retention end to end — not stored, not trained on. Privacy
                isn&apos;t a setting; it&apos;s the only setting.
              </Bullet>
            </ul>
          </Block>

          <Block title="Who builds it">
            <p>
              first-pass.io is built by{" "}
              <span className="font-semibold text-primary">Mitch Hubbard</span>,
              a Fractional Controller who has spent enough fiscal year-ends on
              both sides of the audit to know what slows it down. The product
              is shaped by the procedures we run on a real engagement
              (Hartwell Manufacturing, FY 2024) — not by what looks good in a
              demo.
            </p>
          </Block>

          <Block title="Where we&rsquo;re going">
            <p>
              Today the platform covers Accounts Receivable end-to-end:
              scoping, sampling, confirmations, alternative procedures,
              substantive analytics, and the testing memo. Inventory, Cash,
              Accounts Payable, and Revenue follow next — same pattern, same
              auditor-controlled review at every step.
            </p>
          </Block>

          <div className="pt-4">
            <Link
              href="/app/engagements/new"
              className={buttonVariants({ variant: "gold", size: "lg" })}
            >
              Start a free trial
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
}

function Block({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <h2 className="font-display text-2xl font-medium text-primary">
        {title}
      </h2>
      <div className="mt-4 leading-relaxed">{children}</div>
    </div>
  );
}

function Bullet({ children }: { children: React.ReactNode }) {
  return (
    <li className="flex gap-3">
      <span
        aria-hidden="true"
        className="mt-2 inline-block size-1.5 shrink-0 rounded-full bg-accent"
      />
      <span>{children}</span>
    </li>
  );
}
