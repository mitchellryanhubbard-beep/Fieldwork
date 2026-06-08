import { createHash } from "node:crypto";
import type { ArAging, ArCustomer, ArInvoice } from "@/lib/ar-aging-parser";
import type { AssertionKey } from "@/lib/procedure-library";

// Per-test sampling methodology registry. v1 ships High-coverage hybrid for
// AR Existence; other (FSLI, assertion) combos either have a disabled
// "coming soon" entry or fall back to "manual" (auditor fills the sample
// table by hand).

export type MethodologyId =
  | "highCoverageHybrid"
  | "musStatistical"
  | "riskBasedTable"
  | "periodWindow"
  | "agedReviewTargeted"
  | "manual";

export type MethodologyMeta = {
  id: MethodologyId;
  label: string;
  description: string;
  enabled: boolean;
};

export const METHODOLOGIES: Record<MethodologyId, MethodologyMeta> = {
  highCoverageHybrid: {
    id: "highCoverageHybrid",
    label: "High-coverage hybrid",
    description:
      "Auto-include every balance above a $ threshold (default 10% of PM); random-sample the rest until $ coverage hits a target (default 60%).",
    enabled: true,
  },
  musStatistical: {
    id: "musStatistical",
    label: "Monetary Unit Sampling (MUS)",
    description:
      "Statistical sampling. Each $ in the population has equal probability; large balances are auto-selected. Sample size derived from tolerable misstatement (PM) and a 95% confidence factor.",
    enabled: true,
  },
  riskBasedTable: {
    id: "riskBasedTable",
    label: "Risk-based table",
    description:
      "Fixed sample size by overall-risk level (Low 25 / Moderate 40 / High 60). Auto-includes the top balances and random-fills the remainder.",
    enabled: true,
  },
  periodWindow: {
    id: "periodWindow",
    label: "Period-window (cutoff)",
    description:
      "Select the last N items before period-end and first N after — for cutoff and completeness procedures.",
    enabled: false,
  },
  agedReviewTargeted: {
    id: "agedReviewTargeted",
    label: "Aged review + targeted past-due",
    description:
      "Review the full aging; sample past-due balances (> 60 days) for collectibility evaluation.",
    enabled: true,
  },
  manual: {
    id: "manual",
    label: "Manual (auditor fills)",
    description: "No automated selection — auditor populates the sample table by hand.",
    enabled: true,
  },
};

// Which methodologies make sense for a given (FSLI, assertion). First entry
// is the default. Only `enabled: true` methodologies appear as selectable in
// the UI for v1; the others render as "coming soon" to signal the seam.
export const METHODOLOGY_DEFAULTS: Record<
  string,
  Partial<Record<AssertionKey, MethodologyId[]>>
> = {
  "Accounts Receivable, net": {
    Existence: ["highCoverageHybrid", "musStatistical", "riskBasedTable"],
    Completeness: ["periodWindow", "manual"],
    ValuationAndAllocation: ["agedReviewTargeted", "manual"],
    CutOff: ["periodWindow", "manual"],
    RightsAndObligations: ["manual"],
    Accuracy: ["manual"],
    Presentation: ["manual"],
    ClassificationAndUnderstandability: ["manual"],
  },
};

export function defaultMethodology(
  fsli: string,
  assertion: AssertionKey,
): MethodologyId {
  return (
    METHODOLOGY_DEFAULTS[fsli]?.[assertion]?.[0] ?? "manual"
  );
}

export function availableMethodologies(
  fsli: string,
  assertion: AssertionKey,
): MethodologyMeta[] {
  const ids = METHODOLOGY_DEFAULTS[fsli]?.[assertion] ?? ["manual"];
  return ids.map((id) => METHODOLOGIES[id]);
}

// ---------------------------------------------------------------------------
// High-coverage hybrid
// ---------------------------------------------------------------------------

export type HighCoverageParams = {
  topTierPmPct: number;       // include if |balance| >= pct * PM. Default 1.00 (PM itself).
  targetCoveragePct: number;  // random-sample until coverage ≥ pct. Default 0.60.
  minSampleSize: number;      // minimum total selections. Default 5.
};

export const HIGH_COVERAGE_DEFAULTS: HighCoverageParams = {
  topTierPmPct: 1.0,
  targetCoveragePct: 0.60,
  minSampleSize: 5,
};

export type SelectionReason =
  | "top-tier"           // hybrid: above the PM-relative $ threshold
  | "random"             // hybrid: random tail to hit target coverage
  | "risk-table-top"     // risk-based table: largest balances
  | "risk-table-random"  // risk-based table: random remainder
  | "mus-auto"           // MUS: balance ≥ sampling interval (always selected)
  | "mus-hit"            // MUS: at least one systematic hit landed inside this customer
  | "aged-past-due";     // aged review: customer carries balances aged > threshold days

export type Selection = {
  custNum: string;
  custName: string;
  balance: number;
  reason: SelectionReason;
  // Set on invoice-level samples. When present, the selection refers
  // to this specific invoice rather than the customer's total
  // balance, and the rollover writes the invoice row directly (same
  // customer can appear multiple times).
  invoiceNum?: string;
};

export type RiskLevel = "Low" | "Moderate" | "High";

export type RiskBasedTableParams = {
  riskLevel: RiskLevel;
  targetSize: number;     // total rows targeted, derived from riskLevel
  topTierCount: number;   // largest N balances always included
};

export const RISK_BASED_TABLE_TARGET: Record<RiskLevel, number> = {
  Low: 25,
  Moderate: 40,
  High: 60,
};

export type MusParams = {
  tolerableMisstatement: number;  // typically PM
  confidenceFactor: number;       // 95% no-error → 3.0
  samplingInterval: number;       // tolerableMisstatement / confidenceFactor
  computedSampleSize: number;     // ceil(pop / samplingInterval)
};

export const MUS_DEFAULTS = {
  confidenceFactor: 3.0,
} as const;

export type AgedReviewParams = {
  // Customers carrying any dollars aged STRICTLY MORE than this many
  // days are auto-selected. 60 picks up both 61-90 and 90+ buckets,
  // which is where collectibility risk typically concentrates.
  pastDueThresholdDays: 60;
};

export const AGED_REVIEW_DEFAULTS: AgedReviewParams = {
  pastDueThresholdDays: 60,
};

// Common fields across every methodology's result. Per-methodology details
// live on the discriminated union below.
type SampleResultBase = {
  seed: string;
  populationTotal: number;
  populationCount: number;
  selections: Selection[];
  coverageDollar: number;
  coveragePct: number;
};

export type SampleResult = SampleResultBase &
  (
    | { methodology: "highCoverageHybrid"; params: HighCoverageParams }
    | { methodology: "riskBasedTable"; params: RiskBasedTableParams }
    | { methodology: "musStatistical"; params: MusParams }
    | { methodology: "agedReviewTargeted"; params: AgedReviewParams }
  );

// Deterministic seeded RNG (mulberry32). Same seed string → same shuffle.
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function seedToInt(seed: string): number {
  // 8-hex-char → uint32. Stable across runs/platforms.
  const hex = seed.replace(/[^0-9a-f]/gi, "").slice(0, 8).padEnd(8, "0");
  return parseInt(hex, 16) >>> 0;
}

// Auto-derive a deterministic seed when one wasn't passed.
export function deriveSeed(
  engagementId: string,
  acctNum: string,
  assertion: AssertionKey,
): string {
  return createHash("sha256")
    .update(`${engagementId}::${acctNum}::${assertion}`)
    .digest("hex")
    .slice(0, 8);
}

export function runHighCoverageHybrid(args: {
  customers: ArCustomer[];
  // Optional invoice-level population. When supplied, sampling
  // operates at the INVOICE level — each individual invoice with
  // balance >= threshold is a key item, and the same customer can
  // appear multiple times if they have multiple qualifying invoices.
  // Matches the auditor's stated methodology "all invoices over PM".
  invoices?: ArInvoice[];
  performanceMateriality: number;
  seed: string;
  params?: Partial<HighCoverageParams>;
}): SampleResult {
  const params = { ...HIGH_COVERAGE_DEFAULTS, ...args.params };
  const pm = args.performanceMateriality;

  // Invoice-level path — preferred when invoice data is available.
  if (args.invoices && args.invoices.length > 0) {
    return runHighCoverageHybridInvoiceLevel(
      args.invoices,
      pm,
      args.seed,
      params,
    );
  }
  // Sort desc by absolute balance — top-tier and random both operate over
  // this stable ordering.
  const sorted = [...args.customers].sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total),
  );
  const populationTotal = sorted.reduce((acc, c) => acc + Math.abs(c.total), 0);

  const threshold = params.topTierPmPct * pm;
  const topTier: ArCustomer[] = [];
  const remainder: ArCustomer[] = [];
  for (const c of sorted) {
    // ">=" matches the auditor's narrative phrasing "equal to or
    // exceeding PM" so a customer balance EXACTLY at PM also lands in
    // the key-item tier.
    if (Math.abs(c.total) >= threshold) topTier.push(c);
    else remainder.push(c);
  }

  // Deterministic shuffle of the remainder.
  const rand = mulberry32(seedToInt(args.seed));
  const shuffled = [...remainder];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const target = params.targetCoveragePct * populationTotal;
  let coverage = topTier.reduce((acc, c) => acc + Math.abs(c.total), 0);
  const randomPicks: ArCustomer[] = [];
  for (const c of shuffled) {
    if (
      coverage >= target &&
      topTier.length + randomPicks.length >= params.minSampleSize
    ) {
      break;
    }
    randomPicks.push(c);
    coverage += Math.abs(c.total);
  }

  const selections: Selection[] = [
    ...topTier.map((c) => ({
      custNum: c.custNum,
      custName: c.custName,
      balance: c.total,
      reason: "top-tier" as const,
    })),
    ...randomPicks.map((c) => ({
      custNum: c.custNum,
      custName: c.custName,
      balance: c.total,
      reason: "random" as const,
    })),
  ];

  return {
    methodology: "highCoverageHybrid",
    params,
    seed: args.seed,
    populationTotal,
    populationCount: sorted.length,
    selections,
    coverageDollar: coverage,
    coveragePct: populationTotal === 0 ? 0 : coverage / populationTotal,
  };
}

// Invoice-level high-coverage hybrid. Every individual invoice whose
// |balance| >= threshold (default PM) becomes a key item; same
// customer can appear multiple times if they carry multiple
// qualifying invoices. Random-fill from the below-threshold remainder
// until coverage target is hit.
function runHighCoverageHybridInvoiceLevel(
  invoices: ArInvoice[],
  pm: number,
  seed: string,
  params: HighCoverageParams,
): SampleResult {
  const sorted = [...invoices].sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total),
  );
  const populationTotal = sorted.reduce(
    (acc, i) => acc + Math.abs(i.total),
    0,
  );

  const threshold = params.topTierPmPct * pm;
  const topTier: ArInvoice[] = [];
  const remainder: ArInvoice[] = [];
  for (const inv of sorted) {
    if (Math.abs(inv.total) >= threshold) topTier.push(inv);
    else remainder.push(inv);
  }

  const rand = mulberry32(seedToInt(seed));
  const shuffled = [...remainder];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const target = params.targetCoveragePct * populationTotal;
  let coverage = topTier.reduce((acc, inv) => acc + Math.abs(inv.total), 0);
  const randomPicks: ArInvoice[] = [];
  for (const inv of shuffled) {
    if (
      coverage >= target &&
      topTier.length + randomPicks.length >= params.minSampleSize
    ) {
      break;
    }
    randomPicks.push(inv);
    coverage += Math.abs(inv.total);
  }

  const selections: Selection[] = [
    ...topTier.map((inv) => ({
      custNum: inv.custNum,
      custName: inv.custName,
      invoiceNum: inv.invoiceNum,
      balance: inv.total,
      reason: "top-tier" as const,
    })),
    ...randomPicks.map((inv) => ({
      custNum: inv.custNum,
      custName: inv.custName,
      invoiceNum: inv.invoiceNum,
      balance: inv.total,
      reason: "random" as const,
    })),
  ];

  return {
    methodology: "highCoverageHybrid",
    params,
    seed,
    populationTotal,
    populationCount: sorted.length,
    selections,
    coverageDollar: coverage,
    coveragePct: populationTotal === 0 ? 0 : coverage / populationTotal,
  };
}

// ---------------------------------------------------------------------------
// Risk-based table
//
// Fixed sample size driven by the assertion-matrix overall-risk level.
// We auto-include the largest N balances and random-fill the remainder
// up to the target. Selections cap at the population size (small clients
// just get the whole population).
// ---------------------------------------------------------------------------

export function runRiskBasedTable(args: {
  customers: ArCustomer[];
  riskLevel: RiskLevel;
  seed: string;
  topTierCount?: number;
}): SampleResult {
  const targetSize = RISK_BASED_TABLE_TARGET[args.riskLevel];
  const topTierCount = args.topTierCount ?? Math.min(5, targetSize);
  const sorted = [...args.customers].sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total),
  );
  const populationTotal = sorted.reduce(
    (acc, c) => acc + Math.abs(c.total),
    0,
  );

  const effectiveTopTier = Math.min(topTierCount, sorted.length);
  const topTier = sorted.slice(0, effectiveTopTier);
  const remainder = sorted.slice(effectiveTopTier);

  // Deterministic shuffle of the remainder.
  const rand = mulberry32(seedToInt(args.seed));
  const shuffled = [...remainder];
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }

  const randomFillSize = Math.max(
    0,
    Math.min(targetSize - effectiveTopTier, remainder.length),
  );
  const randomPicks = shuffled.slice(0, randomFillSize);

  const selections: Selection[] = [
    ...topTier.map((c) => ({
      custNum: c.custNum,
      custName: c.custName,
      balance: c.total,
      reason: "risk-table-top" as const,
    })),
    ...randomPicks.map((c) => ({
      custNum: c.custNum,
      custName: c.custName,
      balance: c.total,
      reason: "risk-table-random" as const,
    })),
  ];
  const coverageDollar = selections.reduce(
    (acc, s) => acc + Math.abs(s.balance),
    0,
  );

  return {
    methodology: "riskBasedTable",
    params: {
      riskLevel: args.riskLevel,
      targetSize,
      topTierCount: effectiveTopTier,
    },
    seed: args.seed,
    populationTotal,
    populationCount: sorted.length,
    selections,
    coverageDollar,
    coveragePct: populationTotal === 0 ? 0 : coverageDollar / populationTotal,
  };
}

// ---------------------------------------------------------------------------
// Monetary Unit Sampling (MUS)
//
// Classical statistical method. Population is conceptually a stack of $1
// units. Sampling interval J = TolerableMisstatement / ConfidenceFactor.
// Sample size n = ceil(populationTotal / J). Any customer whose balance
// ≥ J is auto-selected ("top stratum"). Remaining customers are sampled
// systematically: a seeded random start in [0, J) defines hit points at
// J, 2J, 3J, ...; whichever customer's cumulative range covers a hit gets
// selected.
//
// v1 simplifications: TM defaults to performance materiality, expected
// misstatement = 0 (so confidence factor = 3.0 at 95% confidence). Auditor
// will be able to tune these later.
// ---------------------------------------------------------------------------

export function runMonetaryUnitSampling(args: {
  customers: ArCustomer[];
  tolerableMisstatement: number;
  seed: string;
  confidenceFactor?: number;
}): SampleResult {
  const confidenceFactor =
    args.confidenceFactor ?? MUS_DEFAULTS.confidenceFactor;
  const samplingInterval = args.tolerableMisstatement / confidenceFactor;

  const sorted = [...args.customers].sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total),
  );
  const populationTotal = sorted.reduce(
    (acc, c) => acc + Math.abs(c.total),
    0,
  );
  const computedSampleSize =
    samplingInterval > 0
      ? Math.ceil(populationTotal / samplingInterval)
      : sorted.length;

  // Top stratum: any customer whose balance is at or above the sampling
  // interval is auto-selected per MUS theory.
  const topStratum = new Set<string>();
  for (const c of sorted) {
    if (Math.abs(c.total) >= samplingInterval) topStratum.add(c.custNum);
  }

  // Random start in [0, J) using the seeded RNG. Hits are at
  // start, start + J, start + 2J, ... up to populationTotal.
  const rand = mulberry32(seedToInt(args.seed));
  const start = rand() * samplingInterval;
  const hits: number[] = [];
  for (let h = start; h < populationTotal; h += samplingInterval) {
    hits.push(h);
  }

  // Walk the sorted population once and mark any customer whose cumulative
  // window contains a hit point. We accumulate in the same sorted order so
  // results are deterministic for a given seed.
  const hitSelected = new Set<string>();
  let cumulative = 0;
  let hitIdx = 0;
  for (const c of sorted) {
    const end = cumulative + Math.abs(c.total);
    while (hitIdx < hits.length && hits[hitIdx] < end) {
      hitSelected.add(c.custNum);
      hitIdx += 1;
    }
    cumulative = end;
  }

  const selections: Selection[] = [];
  for (const c of sorted) {
    if (topStratum.has(c.custNum)) {
      selections.push({
        custNum: c.custNum,
        custName: c.custName,
        balance: c.total,
        reason: "mus-auto",
      });
    } else if (hitSelected.has(c.custNum)) {
      selections.push({
        custNum: c.custNum,
        custName: c.custName,
        balance: c.total,
        reason: "mus-hit",
      });
    }
  }
  const coverageDollar = selections.reduce(
    (acc, s) => acc + Math.abs(s.balance),
    0,
  );

  return {
    methodology: "musStatistical",
    params: {
      tolerableMisstatement: args.tolerableMisstatement,
      confidenceFactor,
      samplingInterval,
      computedSampleSize,
    },
    seed: args.seed,
    populationTotal,
    populationCount: sorted.length,
    selections,
    coverageDollar,
    coveragePct: populationTotal === 0 ? 0 : coverageDollar / populationTotal,
  };
}

// Top-level dispatcher — call this from the workpaper generator. Returns
// null when the methodology doesn't produce an automated sample
// (manual, period-window, etc.) or required inputs are missing.
// ---------------------------------------------------------------------------
// Aged review + targeted past-due — Valuation
// ---------------------------------------------------------------------------
//
// Valuation is fundamentally a recoverability question against the full AR
// book. Population = every customer balance. Selection = every customer
// carrying $ aged > pastDueThresholdDays — those are where the
// collectibility risk lives (subsequent-cash + allowance adequacy work
// targets them). Deterministic: order by aged-$ desc, no random draw.
//
export function runAgedReviewTargeted(args: {
  customers: ArCustomer[];
  seed: string;
  params?: Partial<AgedReviewParams>;
}): SampleResult {
  const params: AgedReviewParams = { ...AGED_REVIEW_DEFAULTS, ...args.params };
  const populationTotal = args.customers.reduce(
    (s, c) => s + Math.abs(c.total),
    0,
  );
  const pastDueOf = (c: ArCustomer) =>
    (c.d61_90 ?? 0) + (c.d90_plus ?? 0);
  const pastDue = args.customers
    .filter((c) => pastDueOf(c) > 0)
    .sort((a, b) => pastDueOf(b) - pastDueOf(a));

  const selections: Selection[] = pastDue.map((c) => ({
    custNum: c.custNum,
    custName: c.custName,
    balance: c.total,
    reason: "aged-past-due" as const,
  }));
  const coverageDollar = selections.reduce(
    (s, sel) => s + Math.abs(sel.balance),
    0,
  );
  return {
    methodology: "agedReviewTargeted",
    params,
    seed: args.seed,
    populationTotal,
    populationCount: args.customers.length,
    selections,
    coverageDollar,
    coveragePct:
      populationTotal === 0 ? 0 : coverageDollar / populationTotal,
  };
}

export function runSampling(args: {
  methodology: MethodologyId;
  aging: ArAging;
  performanceMateriality: number;
  engagementId: string;
  acctNum: string;
  assertion: AssertionKey;
  seed?: string;
  // High-coverage hybrid params (only used for that methodology).
  params?: Partial<HighCoverageParams>;
  // Risk-based table needs the assertion-matrix overall-risk level. When
  // missing (no matrix row), we degrade gracefully to null so the auditor
  // sees an empty sample table instead of a half-baked one.
  overallRiskLevel?: RiskLevel;
  // MUS overrides (default: TM = PM, CF = 3.0).
  musOverrides?: {
    tolerableMisstatement?: number;
    confidenceFactor?: number;
  };
}): SampleResult | null {
  const seed =
    args.seed ?? deriveSeed(args.engagementId, args.acctNum, args.assertion);
  switch (args.methodology) {
    case "highCoverageHybrid":
      return runHighCoverageHybrid({
        customers: args.aging.customers,
        invoices: args.aging.invoices,
        performanceMateriality: args.performanceMateriality,
        seed,
        params: args.params,
      });
    case "riskBasedTable": {
      if (!args.overallRiskLevel) return null;
      return runRiskBasedTable({
        customers: args.aging.customers,
        riskLevel: args.overallRiskLevel,
        seed,
      });
    }
    case "musStatistical":
      return runMonetaryUnitSampling({
        customers: args.aging.customers,
        tolerableMisstatement:
          args.musOverrides?.tolerableMisstatement ??
          args.performanceMateriality,
        confidenceFactor: args.musOverrides?.confidenceFactor,
        seed,
      });
    case "agedReviewTargeted":
      return runAgedReviewTargeted({
        customers: args.aging.customers,
        seed,
      });
    default:
      return null;
  }
}
