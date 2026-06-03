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
    title: "Client + Framework",
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
      id="workflow"
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
              {i < STEPS.length - 1 ? <SideArrow index={i} /> : null}
            </div>
          ))}

          <YBranch />

          <div className="grid gap-3 md:grid-cols-2">
            {OPTIONS.map((o) => (
              <FlowCard key={o.n} {...o} />
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
const TIP_PATH = "M -5 -5 L 0 0 L 5 -5";

// SideArrow — hover-triggered curved arrow that arcs out to the right of
// the current card, then comes back in and points down at the next
// card. Mirrors the StepArrow pattern in HowItWorks: opacity 0 by
// default, reveals on group-hover of the surrounding step container.
function SideArrow({ index }: { index: number }) {
  const markerId = `fw-flow-tip-${index}`;
  return (
    <span
      aria-hidden="true"
      className="pointer-events-none absolute z-10 hidden lg:block"
      style={{
        left: "calc(100% + 6px)",
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
        <defs>
          {/* Open chevron arrowhead — same shape as the StepArrow tip
              and the YBranch leg tips so every arrowhead in the page
              shares one visual language. */}
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
          d="M 4 0 Q 60 28 4 56"
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
