import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
      <p className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        First Pass on Autopilot
      </p>
      <h1 className="max-w-3xl font-display text-5xl font-medium leading-[1.05] tracking-tight text-primary sm:text-6xl">
        Audit fieldwork that lives inside Excel.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground/80">
        A copilot for staff auditors. Generates workpapers, designs samples,
        runs analytics, and flags exceptions — without leaving the workbook.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/app/engagements/new"
          className={buttonVariants({ variant: "gold", size: "lg" })}
        >
          Start free trial
        </Link>
        <Link
          href="#cta"
          className={buttonVariants({ variant: "navyOutline", size: "lg" })}
        >
          Book a demo
        </Link>
      </div>
      <p className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">
        AICPA &middot; IFRS &middot; PCAOB
      </p>
    </section>
  );
}
