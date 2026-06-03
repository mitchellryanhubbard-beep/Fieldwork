import { SectionHeading } from "./section-heading";

const BULLETS = [
  {
    title: "Zero-retention API",
    body: "Client data is never stored or trained on. Verified at every code path that sends client content.",
  },
  {
    title: "Audit trail on every cell",
    body: "Source, prompt, and reasoning saved with each generated workpaper cell.",
  },
  {
    title: "Never auto-concludes",
    body: "First-Pass flags exceptions; auditors form opinions. By design.",
  },
  {
    title: "Framework templates",
    body: "Distinct templates for AICPA, IFRS, and PCAOB engagements.",
  },
];

export function TrustCompliance() {
  return (
    <section
      id="trust"
      style={{ backgroundColor: "var(--color-fw-band)" }}
      className="py-20"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHeading>Built for firm-grade trust.</SectionHeading>
        <ul className="mt-10 grid gap-6 sm:grid-cols-2">
          {BULLETS.map((b) => (
            <li key={b.title} className="border-l-2 border-accent pl-5">
              <h3 className="font-display text-xl font-medium text-primary">
                {b.title}
              </h3>
              <p className="mt-2 text-sm text-foreground/75">{b.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
