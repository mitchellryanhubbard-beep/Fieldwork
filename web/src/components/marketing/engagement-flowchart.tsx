import { SectionHeading } from "./section-heading";

// Stepwise walkthrough of the actual engagement workflow — mirrors the
// numbered sections on /app/engagements/[id] so the marketing visitor
// sees what the auditor sees once they're inside the app. Step 6 forks
// into two CY workpaper options (scratch vs roll-forward).

type Step = {
  n: string;
  title: string;
  body: string;
};

const STEPS: Step[] = [
  {
    n: "01",
    title: "Client Information",
    body: "Client, fiscal year end, framework, and industry. Drives industry-specific templates and assertion-risk mapping downstream.",
  },
  {
    n: "02",
    title: "Materiality",
    body: "Drives scoping, sample sizes, and exception flagging across every downstream test.",
  },
  {
    n: "03",
    title: "Planning & Risk Questionnaire",
    body: "Identify current-year significant business changes, identify CY audit risks, and give the AI context to modify the audit approach from PY.",
  },
  {
    n: "04",
    title: "Source Files",
    body: "Prior-year signed audit opinion (PDF) and current-year trial balance (Excel, CSV, or PDF). Replacing an upload removes the prior file from storage.",
  },
  {
    n: "05",
    title: "Generate",
    body: "Generate the audit binder (scoping memo + assertion plan + lead sheets) and the standalone assertion-risk matrix workbook from the inputs above.",
  },
  {
    n: "06",
    title: "Support and Workpapers",
    body: "Upload source documents and generate workpapers by financial-statement line item. Expand each FSLI to upload its supporting schedules and open its workpapers.",
  },
];

export function EngagementFlowchart() {
  return (
    <section
      id="product"
      style={{ backgroundColor: "var(--color-fw-band)" }}
      className="py-20"
    >
      <div className="mx-auto w-full max-w-3xl px-6">
        <SectionHeading>Inside an engagement.</SectionHeading>
        <p className="mt-3 max-w-xl text-foreground/70">
          The actual workflow auditors walk through within First-Pass, from
          setup to substantive testing.
        </p>

        <div className="mt-12 space-y-12">
          {STEPS.map((s, i) => (
            <div key={s.n} className="group relative">
              <FlowCard {...s} />
              {i < STEPS.length - 1 ? (
                <SideArrow
                  side={i % 2 === 0 ? "left" : "right"}
                  index={i}
                />
              ) : (
                <CardFireworks />
              )}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

function FlowCard({ n, title, body }: Step) {
  return (
    <div className="flex items-start gap-4 rounded-2xl bg-card p-5 shadow-sm transition-colors duration-200 hover:bg-[#f5f0e2]">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs font-semibold text-primary"
      >
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-lg font-semibold tracking-tight text-primary">
          {title}
        </h3>
        <p className="mt-2 text-sm text-foreground/70">{body}</p>
      </div>
    </div>
  );
}

// SideArrow — hover-triggered curved arrow that arcs out from the side
// of the current card and comes back in pointing down at the next
// card. Mirrors the StepArrow pattern in HowItWorks: opacity 0 by
// default, reveals on group-hover of the surrounding step container.
// Sides alternate down the flow (even indices left, odd indices right)
// so the eye weaves zig-zag from card to card.
function SideArrow({
  side,
  index: _index,
}: {
  side: "left" | "right";
  index: number;
}) {
  const positionStyle =
    side === "right"
      ? { left: "calc(100% + 6px)" }
      : { right: "calc(100% + 6px)" };
  const isRight = side === "right";
  // Body is a Q curve bulging out to one side. The endpoint tangent
  // direction is (end - control) — for the right arrow that's
  // (-56, 26) (down-left); for the left arrow it's (56, 26) (down-
  // right). The arrowhead is drawn with the tip at the local origin
  // and the back along +x, then translated to the body endpoint and
  // rotated by the angle of the BACK direction (= reverse of tangent)
  // so the head opens away from where the curve came from.
  const bodyPath = isRight ? "M 4 0 Q 60 26 4 52" : "M 66 0 Q 10 26 66 52";
  const tipX = isRight ? 4 : 66;
  const tipY = 52;
  // atan2(-26, 56) ≈ -24.9°  /  atan2(-26, -56) ≈ -155.1°
  const headRotationDeg = isRight ? -24.9 : -155.1;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-10 hidden lg:block"
      style={{
        ...positionStyle,
        top: "calc(100% - 4px)",
        width: 70,
        height: 56,
      }}
    >
      <svg
        viewBox="0 0 70 56"
        className="size-full text-accent opacity-0 transition-opacity duration-300 ease-out drop-shadow-[0_2px_6px_rgba(200,160,74,0.55)] group-hover:opacity-100"
        style={{ overflow: "visible" }}
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth={4}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d={bodyPath} />
          {/* Chevron tip at origin, wings opening to +x. Transform
              positions it at the body endpoint and rotates it to align
              with the curve's tangent. */}
          <path
            d="M 11 -5 L 0 0 L 11 5"
            transform={`translate(${tipX} ${tipY}) rotate(${headRotationDeg})`}
          />
        </g>
      </svg>
    </span>
  );
}

// CardFireworks — three staggered gold bursts that pop when the card 06
// step is hovered. Same outline-only ray pattern that lived on the old
// HowItWorks final card.
function CardFireworks() {
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 z-10 hidden lg:block"
    >
      <Burst className="absolute -top-5 -left-3 size-10" delay={0} />
      <Burst className="absolute -top-7 -right-3 size-12" delay={120} />
      <Burst className="absolute -bottom-5 right-6 size-9" delay={240} />
    </span>
  );
}

function Burst({
  className,
  delay,
}: {
  className: string;
  delay: number;
}) {
  return (
    <svg
      viewBox="0 0 60 60"
      className={`${className} text-accent opacity-0 scale-0 origin-center transition duration-500 ease-out drop-shadow-[0_2px_6px_rgba(200,160,74,0.55)] group-hover:opacity-100 group-hover:scale-100`}
      style={{ transitionDelay: `${delay}ms` }}
    >
      <g
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        fill="none"
      >
        <line x1="30" y1="30" x2="30" y2="6" />
        <line x1="30" y1="30" x2="48" y2="12" />
        <line x1="30" y1="30" x2="54" y2="30" />
        <line x1="30" y1="30" x2="48" y2="48" />
        <line x1="30" y1="30" x2="30" y2="54" />
        <line x1="30" y1="30" x2="12" y2="48" />
        <line x1="30" y1="30" x2="6" y2="30" />
        <line x1="30" y1="30" x2="12" y2="12" />
      </g>
      <g fill="currentColor">
        <circle cx="30" cy="30" r="1.4" />
        <circle cx="30" cy="4" r="1" />
        <circle cx="50" cy="10" r="1" />
        <circle cx="56" cy="30" r="1" />
        <circle cx="50" cy="50" r="1" />
        <circle cx="30" cy="56" r="1" />
        <circle cx="10" cy="50" r="1" />
        <circle cx="4" cy="30" r="1" />
        <circle cx="10" cy="10" r="1" />
      </g>
    </svg>
  );
}
