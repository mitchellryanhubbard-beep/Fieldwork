import { SectionHeading } from "./section-heading";

const STEPS = [
  {
    n: "01",
    title: "Engagement Setup",
    body: "Capture client, framework, industry, materiality, PY audit, and CY trial balance.",
  },
  {
    n: "02",
    title: "Assertion-Risk Matrix",
    body: "AI maps every significant account to risks, assertions, and a planned approach. You review.",
  },
  {
    n: "03",
    title: "Workpaper generation",
    body: "Lead sheets, scoping documents, and per-account workpaper shells, all in Excel.",
  },
  {
    n: "04",
    title: "Substantive + analytical testing",
    body: "Sample selection, tickmarks, ratio + variance flagging, and an exception report you sign.",
  },
];

export function HowItWorks() {
  return (
    <section id="product" className="bg-secondary/40 py-20">
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHeading>
          From engagement setup to signed exception report.
        </SectionHeading>
        <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="rounded-xl border border-primary/10 bg-card p-6"
            >
              <p className="font-mono text-sm font-semibold text-accent">
                {s.n}
              </p>
              <h3 className="mt-3 font-display text-xl font-medium text-primary">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-foreground/70">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
