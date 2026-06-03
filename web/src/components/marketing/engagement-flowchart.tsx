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
    body: "Source documents and workpapers organized by financial-statement line item. Expand each FSLI to upload its supporting schedules and open its workpapers.",
  },
];

const OPTIONS: Step[] = [
  {
    n: "6A",
    title: "Option 1",
    body: "Create CY workpapers from scratch with the click of a button.",
  },
  {
    n: "6B",
    title: "Option 2",
    body: "Roll PY workpapers forward to create CY workpapers with the click of a button.",
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
                <>
                  <ForkArrow side="left" index={i} />
                  <ForkArrow side="right" index={i} />
                </>
              )}
            </div>
          ))}

          {/* Mobile-only static fork connector. Desktop gets the
              hover-triggered ForkArrows above. */}
          <div className="lg:hidden">
            <YBranch />
          </div>

          <div className="grid gap-3 md:grid-cols-2">
            {OPTIONS.map((o) => (
              <div key={o.n} className="group relative">
                <FlowCard {...o} />
                <OptionFireworks />
              </div>
            ))}
          </div>
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

// Shared chevron tip geometry — 10 wide × 5 deep. Used by the YBranch
// legs so the tip matches the SideArrow marker visually.
const TIP_PATH = "M -6 -7 Q -3 -3 0 0 Q 3 -3 6 -7";

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
  const bodyPath =
    side === "right" ? "M 4 0 Q 60 26 4 52" : "M 66 0 Q 10 26 66 52";
  // Arrowhead drawn as a single stroke that runs wing → tip → wing so
  // the corner rounds cleanly at the tip with strokeLinejoin="round".
  const headPath =
    side === "right" ? "M -3 43 L 4 52 L 11 43" : "M 59 43 L 66 52 L 73 43";
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
        className="size-full text-accent/40 transition-colors duration-300 ease-out group-hover:text-accent"
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
          <path d={headPath} />
        </g>
      </svg>
    </span>
  );
}

// ForkArrow — hover-triggered curve from card 06 splitting toward 6A
// (left) or 6B (right). Each side is its own fixed-size SVG with
// marker-end so the chevron tip renders identically to the SideArrows
// above (no preserveAspectRatio="none" stretching). The two SVGs sit
// 4px apart horizontally so the arrows read as separate at the start.
function ForkArrow({
  side,
  index: _index,
}: {
  side: "left" | "right";
  index: number;
}) {
  const bodyPath =
    side === "left"
      ? "M 180 0 C 130 0 22 26 22 56"
      : "M 0 0 C 50 0 158 26 158 56";
  const headPath =
    side === "left" ? "M 14 47 L 22 56 L 30 47" : "M 150 47 L 158 56 L 166 47";
  const positionStyle =
    side === "left"
      ? { right: "calc(50% + 4px)" }
      : { left: "calc(50% + 4px)" };
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute top-full z-10 hidden lg:block"
      style={{ ...positionStyle, width: 180, height: 64 }}
    >
      <svg
        viewBox="0 0 180 64"
        className="size-full text-accent/40 transition-colors duration-300 ease-out group-hover:text-accent"
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
          <path d={headPath} />
        </g>
      </svg>
    </span>
  );
}

// OptionFireworks — three staggered gold bursts that pop on hover of
// the 6A / 6B cards. Same outline-only ray pattern used on the final
// HowItWorks card.
function OptionFireworks() {
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

function YBranch() {
  return (
    <div aria-hidden="true" className="flex justify-center py-2">
      <svg
        viewBox="0 0 400 56"
        preserveAspectRatio="none"
        className="h-14 w-full max-w-2xl text-accent"
      >
        <g
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        >
          {/* Stem down from center, horizontal bridge, then two legs. */}
          <path d="M 200 0 L 200 18 M 60 18 L 340 18 M 60 18 L 60 50 M 340 18 L 340 50" />
          {/* Identical chevron tips at the foot of each leg. */}
          <path d={TIP_PATH} transform="translate(60 50)" />
          <path d={TIP_PATH} transform="translate(340 50)" />
        </g>
      </svg>
    </div>
  );
}
