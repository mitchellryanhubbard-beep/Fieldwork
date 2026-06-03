import { SectionHeading } from "./section-heading";

const STEPS = [
  {
    title: "Engagement Setup",
    body: "Capture client, framework, industry, materiality, PY audit, and CY trial balance.",
  },
  {
    title: "Assertion-Risk Matrix",
    body: "AI maps every significant account to risks, assertions, and a planned approach.",
  },
  {
    title: "Workpaper generation",
    body: "Lead sheets, scoping documents, and per-account workpaper shells, all in Excel.",
  },
  {
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
  // Subtler arc — crest sits about 60px above (or below) the endpoint
  // line rather than the previous 112px, so the arrow reads as a gentle
  // curve instead of a tall arch.
  const path =
    kind === "over"
      ? "M 15,82 Q 140,22 265,82"
      : "M 15,18 Q 140,78 265,18";
  const markerId = `fw-arrow-head-${kind}-${index}`;
  const positionClass =
    kind === "over"
      ? "-top-[60px] -right-[148px]"
      : "-bottom-[60px] -right-[148px]";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 hidden lg:block ${positionClass}`}
      style={{ width: "280px", height: "92px" }}
    >
      <svg
        viewBox="0 0 280 100"
        className="size-full text-accent opacity-0 transition-opacity duration-300 ease-out drop-shadow-[0_2px_6px_rgba(200,160,74,0.55)] group-hover:opacity-100"
        style={{ overflow: "visible" }}
      >
        <defs>
          {/* Open chevron arrowhead — two strokes meeting at the tip
              rather than a filled triangle, so the head reads as a
              hand-drawn arrow rather than a glyph. */}
          <marker
            id={markerId}
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="7"
            markerHeight="7"
            orient="auto-start-reverse"
          >
            <path
              d="M 1 1 L 9 5 L 1 9"
              fill="none"
              stroke="currentColor"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
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
              key={s.title}
              className="group relative rounded-xl border border-primary/10 bg-card p-6 transition-colors duration-200 hover:bg-[#f5f0e2]"
            >
              <h3 className="whitespace-nowrap font-display text-xl font-medium tracking-tight text-primary lg:text-base">
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
