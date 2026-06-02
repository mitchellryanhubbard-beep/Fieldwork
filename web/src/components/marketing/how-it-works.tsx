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
  // Wider arrow that lives ENTIRELY outside the cards — its arc body
  // crests well above (or dips well below) the card row, only the
  // endpoints brush close to the card edges.
  //
  //   "over"  arches up; start low on the left, peak high, end low on right
  //   "under" mirrors it
  const path =
    kind === "over"
      ? "M 8,82 Q 110,-12 212,82"
      : "M 8,10 Q 110,104 212,10";
  const markerId = `fw-arrow-head-${kind}-${index}`;
  // Center the arrow horizontally on the gap between this card and
  // the next. The arrow span is 220px; pulling right back by half its
  // own width centers it on the card's right edge (the gap midpoint
  // sits a few px right of that, close enough to look balanced).
  // Vertically: "over" pinned at the top edge then translated up so
  // the arc body is well above the card; "under" mirrors.
  const positionClass =
    kind === "over"
      ? "-top-20 -right-[110px]"
      : "-bottom-20 -right-[110px]";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 hidden lg:block ${positionClass}`}
      style={{ width: "220px", height: "92px" }}
    >
      <svg
        viewBox="0 0 220 92"
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
          strokeWidth={3.5}
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
