import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function CtaBand() {
  return (
    <section id="cta" className="bg-primary py-16">
      <div className="mx-auto w-full max-w-6xl px-6 text-center">
        <h2 className="font-display text-3xl font-medium leading-tight text-primary-foreground sm:text-4xl">
          Start your 14-day trial.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-primary-foreground/70">
          No card during beta. Walk one engagement through Fieldwork and decide
          if it pays for itself.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/app/engagements/new"
            className={buttonVariants({ variant: "gold", size: "lg" })}
          >
            Start free trial
          </Link>
        </div>
      </div>
    </section>
  );
}
