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
    body: "AI maps every significant account to risks, assertions, and a planned approach.",
  },
  {
    n: "03",
    title: "Workpaper generation",
    body: "Lead sheets, scoping documents, and per-account workpaper shells, all in Excel.",
  },
  {
    n: "04",
    title: "Substantive testing",
    body: "Sample selections, testing procedures, tickmarks, and ratio + variance flagging.",
  },
];

export function HowItWorks() {
  return (
    <section
      id="product"
      style={{ backgroundColor: "var(--color-fw-band)" }}
      className="py-20"
    >
      <div className="mx-auto w-full max-w-6xl px-6">
        <SectionHeading>
          From engagement setup to substantive testing.
        </SectionHeading>
        <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s, i) => (
            <li
              key={s.n}
              className="group relative rounded-xl border border-primary/10 bg-card p-6"
            >
              <p className="font-mono text-sm font-semibold text-accent">
                {s.n}
              </p>
              <h3 className="mt-3 whitespace-nowrap font-display text-xl font-medium tracking-tight text-primary lg:text-base">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-foreground/70">{s.body}</p>

              {/* Animated arrow that points to the next step on hover.
                  Renders only when there IS a next step, only at the
                  lg breakpoint where the cards sit side-by-side. */}
              {i < STEPS.length - 1 ? (
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -right-5 top-1/2 hidden -translate-y-1/2 lg:block"
                >
                  <svg
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth={2.75}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="size-9 -translate-x-3 text-accent opacity-0 drop-shadow-[0_2px_6px_rgba(200,160,74,0.55)] transition-all duration-300 ease-out group-hover:translate-x-0 group-hover:opacity-100 group-hover:[animation:fw-arrow-bounce_0.9s_ease-in-out_infinite]"
                  >
                    <path d="M5 12h14" />
                    <path d="M13 5l7 7-7 7" />
                  </svg>
                </span>
              ) : null}
            </li>
          ))}
        </ol>
        {/* Custom keyframe used by the hover arrow above. Scoped to
            this section via a style tag so it travels with the component. */}
        <style>{`
          @keyframes fw-arrow-bounce {
            0%, 100% { transform: translateX(0); }
            50%      { transform: translateX(6px); }
          }
        `}</style>
      </div>
    </section>
  );
}
