import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export const metadata = {
  title: "About First-Pass",
  description:
    "Audit is facing a structural labor problem. First-Pass is an AI-native audit copilot that performs the first pass of audit testing automatically — accelerating everything that comes before professional judgment.",
};

export default function AboutPage() {
  return (
    <main>
      {/* Title band */}
      <section
        style={{ backgroundColor: "var(--color-fw-band)" }}
        className="pb-20 pt-20 sm:pt-28"
      >
        <div className="mx-auto w-full max-w-3xl px-6">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            About First-Pass
          </p>
          <h1 className="mt-4 font-display text-4xl font-medium leading-[1.05] tracking-tight text-primary sm:text-5xl">
            Audit is facing a structural labor problem.
          </h1>
        </div>
      </section>

      {/* Body */}
      <section className="bg-background pb-24 pt-16">
        <div className="mx-auto w-full max-w-3xl space-y-7 px-6 text-lg leading-relaxed text-foreground/80">
          <p>
            For decades, firms have relied on teams of staff auditors to
            perform the same first-pass testing engagement after
            engagement — selecting samples, inspecting support, documenting
            results, applying tickmarks, and preparing workpapers for review.
            The work is necessary, but much of it is repetitive, rules-based,
            and time-consuming.
          </p>

          <p>
            At the same time, the profession is experiencing a historic
            shortage of accountants. Firms are being asked to do more with
            fewer people, while clients expect audits to be completed faster
            and at lower cost.
          </p>

          {/* Pull quote / break */}
          <p className="border-l-4 border-accent pl-5 font-display text-2xl font-medium leading-snug text-primary sm:text-3xl">
            First-Pass was built to solve that problem.
          </p>

          <p>
            First-Pass is an AI-native audit copilot that performs the first
            pass of audit testing automatically. By combining prior-year
            workpapers, current-year financial data, risk assessments, and
            supporting documentation, First-Pass generates draft workpapers,
            rolls prior year workpapers forward, performs testing procedures,
            identifies exceptions, and prepares documentation for auditor
            review.
          </p>

          {/* Italic emphasis */}
          <p className="text-xl italic leading-snug text-primary/90 sm:text-2xl">
            We don&rsquo;t replace professional judgment. We accelerate
            everything that comes before it.
          </p>

          <p>
            The result is simple: fewer hours spent on repetitive testing,
            faster audit completion, and more time for auditors to focus on
            the areas that require experience, skepticism, and judgment.
          </p>

          {/* Closing kicker */}
          <div className="pt-4">
            <p className="font-display text-3xl font-medium leading-tight text-primary sm:text-4xl">
              The future of audit isn&rsquo;t more staff.
            </p>
            <p className="mt-2 font-display text-3xl font-medium leading-tight text-accent sm:text-4xl">
              It&rsquo;s a better first pass.
            </p>
          </div>

          <div className="pt-6">
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
