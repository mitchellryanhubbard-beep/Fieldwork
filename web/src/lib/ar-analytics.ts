import type { ArAging } from "@/lib/ar-aging-parser";
import type { TrialBalance, TrialBalanceAccount } from "@/lib/tb-parser";

// AR analytics — pure math on TB + aging. Produces a structured result the
// workpaper generator turns into the "Analytics — AR" sheet. Keeping the
// math separate from the sheet builder means we can also surface these
// numbers in the engagement page or feed them into an exception roll-up
// later without re-implementing.

const DAYS_IN_YEAR = 365;

// Industry-typical DSO benchmarks. Null when no benchmark applies (e.g.
// NFP). Sourced from common audit-industry references — auditor overrides
// in the workpaper if their firm uses a different baseline.
const INDUSTRY_DSO_BENCHMARK: Record<string, number | null> = {
  Manufacturing: 72,
  SaaS: 45,
  ConsumerBusiness: 30,
  RealEstate: null,
  NFP: null,
};

export type DsoBlock = {
  revenueCy: number;
  revenuePy: number;
  arCy: number;
  arPy: number;
  dsoCy: number | null;       // null when revenue is 0
  dsoPy: number | null;
  dsoChangeDays: number | null;
  dsoChangePct: number | null;
  industryBenchmark: number | null;
  flagged: boolean;            // true when change > flagDaysThreshold or > flagPctThreshold
  flagDaysThreshold: number;
  flagPctThreshold: number;
};

export type AgingBucket = {
  label: string;
  amount: number;
  percentOfTotal: number;
};

export type AgingCompositionBlock = {
  asOfDate: string | null;
  buckets: AgingBucket[];      // Current, 1-30, 31-60, 61-90, 90+, Credits
  total: number;
};

export type ConcentrationRow = {
  custNum: string;
  custName: string;
  balance: number;
  pctOfTotal: number;
  cumulativePct: number;
};

export type PastDueBlock = {
  pastDueDollar: number;       // 31+ days, excluding credits
  pastDuePct: number;
  flagged: boolean;
  flagPctThreshold: number;
};

export type ArAnalytics = {
  dso: DsoBlock;
  aging: AgingCompositionBlock;
  pyAging: AgingCompositionBlock | null;
  topFive: ConcentrationRow[];
  totalPastDue: PastDueBlock;
};

export function computeArAnalytics(args: {
  account: TrialBalanceAccount;
  trialBalance: TrialBalance;
  aging: ArAging;
  // Optional prior-year AR aging. Drives the PY column in the aging
  // composition table when supplied; null leaves PY out.
  pyAging?: ArAging | null;
  industry: string;
  flagDsoChangeDays?: number;
  flagDsoChangePct?: number;
  flagPastDuePct?: number;
}): ArAnalytics {
  const flagDsoChangeDays = args.flagDsoChangeDays ?? 5;
  const flagDsoChangePct = args.flagDsoChangePct ?? 0.07;
  const flagPastDuePct = args.flagPastDuePct ?? 0.10;

  const dso = computeDso({
    account: args.account,
    trialBalance: args.trialBalance,
    industry: args.industry,
    flagDaysThreshold: flagDsoChangeDays,
    flagPctThreshold: flagDsoChangePct,
  });

  const aging = computeAgingComposition(args.aging);
  const pyAging = args.pyAging
    ? computeAgingComposition(args.pyAging)
    : null;
  const topFive = computeConcentration(args.aging, 5);
  const totalPastDue = computePastDue(args.aging, flagPastDuePct);

  return { dso, aging, pyAging, topFive, totalPastDue };
}

function computeDso(args: {
  account: TrialBalanceAccount;
  trialBalance: TrialBalance;
  industry: string;
  flagDaysThreshold: number;
  flagPctThreshold: number;
}): DsoBlock {
  const revenueCy = sumRevenue(args.trialBalance, "cy");
  const revenuePy = sumRevenue(args.trialBalance, "py");
  const arCy = args.account.cyBalance;
  const arPy = args.account.pyBalance;

  const dsoCy = revenueCy > 0 ? (arCy / revenueCy) * DAYS_IN_YEAR : null;
  const dsoPy = revenuePy > 0 ? (arPy / revenuePy) * DAYS_IN_YEAR : null;
  const dsoChangeDays = dsoCy !== null && dsoPy !== null ? dsoCy - dsoPy : null;
  const dsoChangePct =
    dsoCy !== null && dsoPy !== null && dsoPy !== 0
      ? (dsoCy - dsoPy) / dsoPy
      : null;

  const flagged =
    (dsoChangeDays !== null &&
      Math.abs(dsoChangeDays) > args.flagDaysThreshold) ||
    (dsoChangePct !== null && Math.abs(dsoChangePct) > args.flagPctThreshold);

  return {
    revenueCy,
    revenuePy,
    arCy,
    arPy,
    dsoCy,
    dsoPy,
    dsoChangeDays,
    dsoChangePct,
    industryBenchmark: INDUSTRY_DSO_BENCHMARK[args.industry] ?? null,
    flagged,
    flagDaysThreshold: args.flagDaysThreshold,
    flagPctThreshold: args.flagPctThreshold,
  };
}

// Revenue is conventionally a credit balance in the GL. Some TBs export
// revenue as negative; ours stores absolute values per the TB-parser
// contract. Sum directly and let abs() guard against sign quirks at the
// callsite.
function sumRevenue(tb: TrialBalance, year: "cy" | "py"): number {
  let total = 0;
  for (const a of tb.accounts) {
    if (a.section !== "Revenue") continue;
    total += year === "cy" ? a.cyBalance : a.pyBalance;
  }
  return Math.abs(total);
}

function computeAgingComposition(aging: ArAging): AgingCompositionBlock {
  // Sum across all customers — invoice-level aging buckets roll up via the
  // ArCustomer aggregation already done by the parser.
  let current = 0,
    d1_30 = 0,
    d31_60 = 0,
    d61_90 = 0,
    d90_plus = 0,
    credits = 0;
  for (const c of aging.customers) {
    current += c.current;
    d1_30 += c.d1_30;
    d31_60 += c.d31_60;
    d61_90 += c.d61_90;
    d90_plus += c.d90_plus;
    credits += c.credits;
  }
  const total = current + d1_30 + d31_60 + d61_90 + d90_plus + credits;
  const pct = (n: number) => (total === 0 ? 0 : n / total);

  return {
    asOfDate: aging.asOfDate,
    buckets: [
      { label: "Current", amount: current, percentOfTotal: pct(current) },
      { label: "1-30 Days", amount: d1_30, percentOfTotal: pct(d1_30) },
      { label: "31-60 Days", amount: d31_60, percentOfTotal: pct(d31_60) },
      { label: "61-90 Days", amount: d61_90, percentOfTotal: pct(d61_90) },
      { label: "90+ Days", amount: d90_plus, percentOfTotal: pct(d90_plus) },
      { label: "Credits", amount: credits, percentOfTotal: pct(credits) },
    ],
    total,
  };
}

function computeConcentration(
  aging: ArAging,
  topN: number,
): ConcentrationRow[] {
  // aging.customers is already sorted by |balance| desc by the parser.
  const totalAbs = aging.customers.reduce(
    (acc, c) => acc + Math.abs(c.total),
    0,
  );
  const out: ConcentrationRow[] = [];
  let cumulative = 0;
  for (const c of aging.customers.slice(0, topN)) {
    const pct = totalAbs === 0 ? 0 : Math.abs(c.total) / totalAbs;
    cumulative += pct;
    out.push({
      custNum: c.custNum,
      custName: c.custName,
      balance: c.total,
      pctOfTotal: pct,
      cumulativePct: cumulative,
    });
  }
  return out;
}

function computePastDue(
  aging: ArAging,
  flagPctThreshold: number,
): PastDueBlock {
  let pastDue = 0;
  let total = 0;
  for (const c of aging.customers) {
    pastDue += c.d31_60 + c.d61_90 + c.d90_plus;
    total += c.current + c.d1_30 + c.d31_60 + c.d61_90 + c.d90_plus + c.credits;
  }
  const pct = total === 0 ? 0 : pastDue / total;
  return {
    pastDueDollar: pastDue,
    pastDuePct: pct,
    flagged: pct > flagPctThreshold,
    flagPctThreshold,
  };
}
