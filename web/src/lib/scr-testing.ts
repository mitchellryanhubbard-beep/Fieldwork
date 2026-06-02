import type { ArAging, ArInvoice } from "@/lib/ar-aging-parser";
import type {
  ScrReceipt,
  SubsequentCashReceipts,
} from "@/lib/scr-parser";
import type { Selection } from "@/lib/sampling-methodologies";

// Subsequent Cash Receipts substantive test. Consumes the SCR file + the
// AR Aging + (optionally) the Existence sample, runs four passes:
//
//   1. Receipt-to-invoice matching     (Existence + data integrity)
//   2. Coverage + days-to-collect      (Existence + Valuation analytic)
//   3. Per-invoice collection status   (Valuation)
//   4. Per-customer rollup, marking which customers were in the sample
//
// Output is a structured `ScrTestResult` consumed by the workpaper sheet
// builder. All computation is deterministic — no Claude calls.

export type ScrMatchStatus =
  | "matched-full"        // Receipt(s) applied → invoice paid in full
  | "matched-partial"     // Receipt(s) applied but remaining balance > 0
  | "unmatched-receipt"   // Receipt references invoice not in the aging
  | "unmatched-invoice"   // YE invoice has no subsequent receipt
  | "credit-memo";        // Negative receipt — credit memo applied

export type ScrReceiptMatch = {
  receipt: ScrReceipt;
  status: ScrMatchStatus;
  matchedInvoice: ArInvoice | null;
  daysToCollect: number | null;
};

export type ScrInvoiceStatus = {
  invoice: ArInvoice;
  status: ScrMatchStatus;
  receipts: ScrReceipt[];
  amountReceived: number;
  amountOutstanding: number;
  daysToCollect: number | null;        // days from invoice → first receipt
  isAgedAtYE: boolean;                  // > 60 days past invoice date at YE
  flaggedForValuation: boolean;         // aged + not fully collected post-YE
};

export type ScrCustomerRollup = {
  custNum: string;
  custName: string;
  ye_balance: number;
  collected: number;
  outstanding: number;
  coveragePct: number;
  inExistenceSample: boolean;
  invoiceCount: number;
};

export type ScrExceptions = {
  partialPayments: ScrInvoiceStatus[];
  unmatchedReceipts: ScrReceiptMatch[];
  uncollectedAged: ScrInvoiceStatus[];
};

export type ScrCoverage = {
  yeArTotal: number;
  totalCollected: number;
  coveragePct: number;
  receiptCount: number;
  daysWindow: number;                   // span between earliest receipt date and YE
  daysToCollectMedian: number | null;
  daysToCollectMax: number | null;
  pctCollectedWithin30: number;
  pctCollectedWithin60: number;
};

export type ScrTestResult = {
  periodLabel: string | null;
  coverage: ScrCoverage;
  receiptMatches: ScrReceiptMatch[];
  invoiceStatuses: ScrInvoiceStatus[];
  customerRollup: ScrCustomerRollup[];
  exceptions: ScrExceptions;
};

export function runScrTesting(args: {
  scr: SubsequentCashReceipts;
  aging: ArAging;
  yeDate: string;                       // engagement.client.fiscalYearEnd
  existenceSelections?: Selection[];    // for marking sampled customers
  agedThresholdDays?: number;           // default 60
}): ScrTestResult {
  const agedThresholdDays = args.agedThresholdDays ?? 60;
  const yeMs = parseLocalDate(args.yeDate)?.getTime() ?? null;

  // Index aging invoices by invoice # for O(1) matching. Aging is the
  // population we test against — anything not in here is an anomaly.
  const invoiceByNum = new Map<string, ArInvoice>();
  for (const inv of args.aging.invoices) {
    invoiceByNum.set(inv.invoiceNum, inv);
  }

  // ----- Pass 1: receipt-to-invoice matching ---------------------------
  const receiptMatches: ScrReceiptMatch[] = args.scr.receipts.map((receipt) => {
    const matchedInvoice = invoiceByNum.get(receipt.invoiceNum) ?? null;
    const days =
      matchedInvoice && receipt.receiptDate && matchedInvoice.invoiceDate
        ? daysBetween(matchedInvoice.invoiceDate, receipt.receiptDate)
        : null;
    let status: ScrMatchStatus;
    if (!matchedInvoice) status = "unmatched-receipt";
    else if (receipt.amountReceived < 0) status = "credit-memo";
    else if (receipt.appliedInFull && receipt.remainingBalance === 0)
      status = "matched-full";
    else status = "matched-partial";
    return { receipt, status, matchedInvoice, daysToCollect: days };
  });

  // ----- Pass 2: per-invoice collection status -------------------------
  const receiptsByInvoice = new Map<string, ScrReceipt[]>();
  for (const r of args.scr.receipts) {
    const list = receiptsByInvoice.get(r.invoiceNum) ?? [];
    list.push(r);
    receiptsByInvoice.set(r.invoiceNum, list);
  }

  const invoiceStatuses: ScrInvoiceStatus[] = args.aging.invoices.map((inv) => {
    const receipts = receiptsByInvoice.get(inv.invoiceNum) ?? [];
    const amountReceived = receipts.reduce(
      (acc, r) => acc + (r.amountReceived < 0 ? 0 : r.amountReceived),
      0,
    );
    // Outstanding is signed — invoice can still have positive remaining
    // even if a credit was applied. We compute against the invoice total.
    const amountOutstanding = inv.total - amountReceived;
    const firstReceiptDate = receipts
      .map((r) => r.receiptDate)
      .filter((d): d is string => !!d)
      .sort()[0] ?? null;
    const daysToCollect =
      firstReceiptDate && inv.invoiceDate
        ? daysBetween(inv.invoiceDate, firstReceiptDate)
        : null;
    const ageAtYE =
      inv.invoiceDate && yeMs !== null
        ? daysBetween(inv.invoiceDate, args.yeDate)
        : 0;
    const isAgedAtYE = ageAtYE > agedThresholdDays;

    let status: ScrMatchStatus;
    if (receipts.length === 0) status = "unmatched-invoice";
    else if (Math.abs(amountOutstanding) < 0.01) status = "matched-full";
    else status = "matched-partial";

    return {
      invoice: inv,
      status,
      receipts,
      amountReceived,
      amountOutstanding,
      daysToCollect,
      isAgedAtYE,
      flaggedForValuation:
        isAgedAtYE && Math.abs(amountOutstanding) > 0.01,
    };
  });

  // ----- Pass 3: coverage analytics ------------------------------------
  const yeArTotal = args.aging.total;
  // Only count receipts that hit an aging invoice in coverage — receipts
  // against unknown invoices shouldn't pad the % collected number.
  const totalCollected = receiptMatches
    .filter(
      (m) =>
        m.status === "matched-full" ||
        m.status === "matched-partial" ||
        m.status === "credit-memo",
    )
    .reduce((acc, m) => acc + m.receipt.amountReceived, 0);
  const coveragePct = yeArTotal === 0 ? 0 : totalCollected / yeArTotal;

  const dtcSamples = receiptMatches
    .map((m) => m.daysToCollect)
    .filter((d): d is number => d !== null && d >= 0);
  const dtcSorted = [...dtcSamples].sort((a, b) => a - b);
  const dtcMedian =
    dtcSorted.length === 0
      ? null
      : dtcSorted[Math.floor(dtcSorted.length / 2)];
  const dtcMax = dtcSorted.length === 0 ? null : dtcSorted[dtcSorted.length - 1];

  // % of YE AR collected within X days post-YE — uses days from receipt
  // back to YE (not days from invoice). Audit-standard cutoff windows.
  const within30 = sumReceiptsWithinDays(receiptMatches, args.yeDate, 30);
  const within60 = sumReceiptsWithinDays(receiptMatches, args.yeDate, 60);

  // Days window: span between earliest receipt and YE.
  const earliestReceipt = receiptMatches
    .map((m) => m.receipt.receiptDate)
    .filter((d): d is string => !!d)
    .sort()[0] ?? null;
  const latestReceipt = receiptMatches
    .map((m) => m.receipt.receiptDate)
    .filter((d): d is string => !!d)
    .sort()
    .slice(-1)[0] ?? null;
  const daysWindow =
    earliestReceipt && latestReceipt
      ? daysBetween(earliestReceipt, latestReceipt) + 1
      : 0;

  const coverage: ScrCoverage = {
    yeArTotal,
    totalCollected,
    coveragePct,
    receiptCount: args.scr.receipts.length,
    daysWindow,
    daysToCollectMedian: dtcMedian,
    daysToCollectMax: dtcMax,
    pctCollectedWithin30: yeArTotal === 0 ? 0 : within30 / yeArTotal,
    pctCollectedWithin60: yeArTotal === 0 ? 0 : within60 / yeArTotal,
  };

  // ----- Pass 4: per-customer rollup -----------------------------------
  const sampledCustNums = new Set(
    args.existenceSelections?.map((s) => s.custNum) ?? [],
  );

  const customerRollup: ScrCustomerRollup[] = args.aging.customers.map((c) => {
    const collected = invoiceStatuses
      .filter((s) => s.invoice.custNum === c.custNum)
      .reduce((acc, s) => acc + s.amountReceived, 0);
    const invoiceCount = invoiceStatuses.filter(
      (s) => s.invoice.custNum === c.custNum,
    ).length;
    const outstanding = c.total - collected;
    return {
      custNum: c.custNum,
      custName: c.custName,
      ye_balance: c.total,
      collected,
      outstanding,
      coveragePct: c.total === 0 ? 0 : collected / c.total,
      inExistenceSample: sampledCustNums.has(c.custNum),
      invoiceCount,
    };
  });

  // ----- Exceptions ----------------------------------------------------
  const exceptions: ScrExceptions = {
    partialPayments: invoiceStatuses.filter(
      (s) => s.status === "matched-partial",
    ),
    unmatchedReceipts: receiptMatches.filter(
      (m) => m.status === "unmatched-receipt",
    ),
    uncollectedAged: invoiceStatuses.filter((s) => s.flaggedForValuation),
  };

  return {
    periodLabel: args.scr.periodLabel,
    coverage,
    receiptMatches,
    invoiceStatuses,
    customerRollup,
    exceptions,
  };
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function sumReceiptsWithinDays(
  matches: ScrReceiptMatch[],
  yeDate: string,
  windowDays: number,
): number {
  const ye = parseLocalDate(yeDate);
  if (!ye) return 0;
  const cutoff = ye.getTime() + windowDays * 86_400_000;
  return matches.reduce((acc, m) => {
    if (!m.receipt.receiptDate) return acc;
    if (m.receipt.amountReceived < 0) return acc;
    const t = parseLocalDate(m.receipt.receiptDate)?.getTime() ?? null;
    if (t === null) return acc;
    if (t > cutoff) return acc;
    return acc + m.receipt.amountReceived;
  }, 0);
}

function daysBetween(fromISO: string, toISO: string): number {
  const from = parseLocalDate(fromISO);
  const to = parseLocalDate(toISO);
  if (!from || !to) return 0;
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function parseLocalDate(iso: string): Date | null {
  // Parse YYYY-MM-DD as a local-midnight date, NOT UTC. Keeps day
  // arithmetic stable across server timezones — the same bug pattern that
  // bit the confirmation-letter date earlier.
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) {
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}
