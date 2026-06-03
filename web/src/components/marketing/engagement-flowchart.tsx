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
              ) : null}
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
          <path d={headPath} />
        </g>
      </svg>
    </span>
  );
}

