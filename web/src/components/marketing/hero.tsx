import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function Hero() {
  return (
    <section
      style={{ backgroundColor: "var(--color-fw-band)" }}
      className="pb-20 pt-16 sm:pt-24"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <h1 className="max-w-3xl font-display text-5xl font-medium leading-[1.05] tracking-tight text-primary sm:text-6xl">
          First-pass audit fieldwork that lives in Excel.
        </h1>
        <p className="mt-6 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          First Pass on Autopilot
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
      </div>
    </section>
  );
}
