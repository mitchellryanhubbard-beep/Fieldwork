import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SectionHeading } from "./section-heading";

type Tier = {
  name: string;
  price: string;
  cadence: string;
  desc: string;
  cta: string;
  ctaHref: string;
  ctaVariant: "gold" | "navyOutline";
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    price: "$249",
    cadence: "/user/mo",
    desc: "For small CPA firms with 1–5 users. Limited engagements and AI runs.",
    cta: "Start free trial",
    ctaHref: "/app/engagements/new",
    ctaVariant: "navyOutline",
  },
  {
    name: "Pro",
    price: "$499",
    cadence: "/user/mo",
    desc: "Full testing workflows and integrations. The full First-Pass.",
    cta: "Start free trial",
    ctaHref: "/app/engagements/new",
    ctaVariant: "gold",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    desc: "SSO, audit logs, advanced controls, and dedicated support for large firms.",
    cta: "Talk to sales",
    ctaHref: "#cta",
    ctaVariant: "navyOutline",
  },
];

export function Pricing() {
  return (
    <section
      id="pricing"
      style={{ backgroundColor: "var(--color-fw-band)" }}
      className="py-20"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHeading>Per-seat pricing.</SectionHeading>
        <p className="mt-3 max-w-xl text-foreground/70">
          14-day free trial. No card required during beta. 30-day money-back
          guarantee on paid plans.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-xl border bg-card p-6 ${
                t.featured ? "border-accent shadow-lg" : "border-primary/10"
              }`}
            >
              {t.featured ? (
                <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
                  Most popular
                </span>
              ) : null}
              <h3 className="font-display text-2xl font-medium text-primary">
                {t.name}
              </h3>
              <p className="mt-3 font-mono text-3xl text-primary">
                {t.price}
                <span className="text-base text-foreground/60">
                  {t.cadence}
                </span>
              </p>
              <p className="mt-3 text-sm text-foreground/75">{t.desc}</p>
              <Link
                href={t.ctaHref}
                className={`mt-6 ${buttonVariants({
                  variant: t.ctaVariant,
                  size: "default",
                })}`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
