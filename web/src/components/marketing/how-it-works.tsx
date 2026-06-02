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

function StepArrow({
  kind,
  index,
}: {
  kind: "over" | "under";
  index: number;
}) {
  // Arrows span roughly card-center to card-center (≈280px at the lg
  // breakpoint where each card is ~264px wide with 16px gap). The
  // endpoints sit just inside the top (or bottom) edge of each card
  // and the arc body crests well above (or dips well below) the row.
  //
  //   "over"  starts low on the left, peaks high above, ends low on right
  //   "under" mirrors it — endpoints near the top, dip below
  const path =
    kind === "over"
      ? "M 15,90 Q 140,-22 265,90"
      : "M 15,10 Q 140,122 265,10";
  const markerId = `fw-arrow-head-${kind}-${index}`;
  // Position the 280px-wide arrow so it stretches from the centre of
  // this card to the centre of the next: right edge anchored 148px
  // past the card's right edge so 132px of the arrow sits over THIS
  // card and 148px extends into the gap + next card.
  const positionClass =
    kind === "over"
      ? "-top-[88px] -right-[148px]"
      : "-bottom-[88px] -right-[148px]";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 hidden lg:block ${positionClass}`}
      style={{ width: "280px", height: "100px" }}
    >
      <svg
        viewBox="0 0 280 100"
        className="size-full text-accent opacity-0 transition-opacity duration-300 ease-out drop-shadow-[0_2px_6px_rgba(200,160,74,0.55)] group-hover:opacity-100"
        style={{ overflow: "visible" }}
      >
        <defs>
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto-start-reverse"
          >
            <path d="M 0 0 L 10 5 L 0 10 Z" fill="currentColor" />
          </marker>
        </defs>
        <path
          d={path}
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          markerEnd={`url(#${markerId})`}
        />
      </svg>
    </span>
  );
}

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
              className="group relative rounded-xl border border-primary/10 bg-card p-6 transition-colors duration-200 hover:bg-[#f5f0e2]"
            >
              <p className="font-mono text-sm font-semibold text-accent">
                {s.n}
              </p>
              <h3 className="mt-3 whitespace-nowrap font-display text-xl font-medium tracking-tight text-primary lg:text-base">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-foreground/70">{s.body}</p>

              {/* Arched arrows between adjacent steps. Alternating
                  curve direction (over → under → over) so the eye
                  weaves down-up-down across the row when scanning. Path
                  is drawn left→right with a marker-end arrowhead so the
                  tip auto-orients to the curve's tangent. */}
              {i < STEPS.length - 1 ? <StepArrow kind={i % 2 === 0 ? "over" : "under"} index={i} /> : null}
            </li>
          ))}
        </ol>
        {/* Custom keyframe used by the hover arrow path. Scoped to
            this section via a style tag so it travels with the component. */}
        <style>{`
          @keyframes fw-arrow-bounce {
            0%, 100% { transform: translateX(0); }
            50%      { transform: translateX(5px); }
          }
        `}</style>
      </div>
    </section>
  );
}
