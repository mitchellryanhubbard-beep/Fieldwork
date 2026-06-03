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
          The actual workflow auditors walk through, from setup to substantive
          testing.
        </p>

        <div className="mt-12 space-y-3">
          {STEPS.map((s, i) => (
            <div key={s.n}>
              <FlowCard {...s} />
              {i < STEPS.length - 1 ? <DownArrow /> : null}
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
    <div className="flex items-start gap-4 rounded-2xl bg-card p-5 shadow-sm">
      <span
        aria-hidden="true"
        className="mt-0.5 grid size-8 shrink-0 place-items-center rounded-full bg-accent font-mono text-xs font-semibold text-primary"
      >
        {n}
      </span>
      <div className="min-w-0">
        <h3 className="font-display text-sm font-semibold uppercase tracking-[0.22em] text-primary">
          {title}
        </h3>
        <p className="mt-2 text-sm text-foreground/70">{body}</p>
      </div>
    </div>
  );
}

function DownArrow() {
  return (
    <div aria-hidden="true" className="flex justify-center py-1.5">
      <svg
        viewBox="0 0 14 22"
        width="14"
        height="22"
        className="text-primary/35"
      >
        <path
          d="M 7 0 L 7 16 M 2 12 L 7 19 L 12 12"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </div>
  );
}

function YBranch() {
  return (
    <div aria-hidden="true" className="flex justify-center py-2">
      <svg
        viewBox="0 0 400 56"
        preserveAspectRatio="none"
        className="h-14 w-full max-w-2xl text-primary/35"
      >
        {/* Stem down from center, horizontal bridge, then two legs
            ending in arrowheads above each child card. */}
        <path
          d="M 200 0 L 200 18 M 60 18 L 340 18 M 60 18 L 60 50 M 340 18 L 340 50"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M 55 45 L 60 50 L 65 45"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d="M 335 45 L 340 50 L 345 45"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
    </div>
  );
}
