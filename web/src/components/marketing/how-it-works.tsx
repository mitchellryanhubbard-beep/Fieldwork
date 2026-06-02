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
  // Path is sized to the SVG viewBox below.
  //  - "over"  arches up from a low start, peaks at the top of the box,
  //            comes back down — i.e. crests above the card.
  //  - "under" mirrors it — dips below the card.
  const path =
    kind === "over"
      ? "M 6,45 Q 45,-2 78,44"
      : "M 6,5 Q 45,52 78,6";
  const markerId = `fw-arrow-head-${kind}-${index}`;
  // The "over" arrow sits with its body above the card, so we pin it
  // to the top edge and translate UP just past the card border. The
  // "under" arrow mirrors that at the bottom. Right offset extends
  // half the arrow into the gap so it visually spans both cards.
  const positionClass =
    kind === "over"
      ? "-top-6 -right-12"
      : "-bottom-6 -right-12";
  return (
    <span
      aria-hidden="true"
      className={`pointer-events-none absolute z-10 hidden lg:block ${positionClass}`}
      style={{ width: "84px", height: "52px" }}
    >
      <svg
        viewBox="0 0 84 52"
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
          strokeWidth={3}
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
