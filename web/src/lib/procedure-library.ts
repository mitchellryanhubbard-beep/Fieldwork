import type { ASSERTIONS } from "@/lib/assertion-matrix";

// Hardcoded audit-procedure language keyed by FSLI + assertion.
// v1: Accounts Receivable only. Each entry is the auditor-facing text we drop
// into the workpaper shell — the auditor edits/extends as needed.

export type AssertionKey = (typeof ASSERTIONS)[number];

export type ProcedureEntry = {
  objective: string;
  procedure: string;
  tickmarks: { symbol: string; meaning: string }[];
};

type FsliProcedures = Partial<Record<AssertionKey, ProcedureEntry>>;

// AICPA standard tickmarks reused across multiple AR procedures.
const TICK_AGREED_TB = { symbol: "TB", meaning: "Agreed to trial balance" };
const TICK_AGREED_SUB = {
  symbol: "S",
  meaning: "Agreed to AR subledger / aged trial balance",
};
const TICK_NO_EXCEPTION = {
  symbol: "✓",
  meaning: "No exception noted",
};
const TICK_EXCEPTION = {
  symbol: "E",
  meaning: "Exception noted — see exception sheet",
};

const ACCOUNTS_RECEIVABLE: FsliProcedures = {
  Existence: {
    objective:
      "Obtain audit evidence that recorded accounts receivable balances exist as of the balance-sheet date and represent valid claims against customers.",
    procedure:
      "1. Obtain the year-end aged AR subledger and agree the total to the general ledger and trial balance.\n" +
      "2. Select a sample of customer balances for positive confirmation (focus on largest balances; supplement with a random sample of remaining balances per the sampling plan).\n" +
      "3. Send confirmation requests directly to the customer. Maintain control of the confirmation process throughout.\n" +
      "4. For each confirmation response: agree the confirmed balance to the recorded balance. Investigate and resolve any differences.\n" +
      "5. For non-responses, perform alternative procedures: test subsequent cash receipts post year-end and trace to the open invoice(s) making up the balance; for items not collected, examine shipping documentation and customer purchase orders.\n" +
      "6. Document exceptions and conclude on whether the recorded balance is materially correct.",
    tickmarks: [
      TICK_AGREED_TB,
      TICK_AGREED_SUB,
      { symbol: "C", meaning: "Confirmed directly with customer — no exception" },
      { symbol: "C/D", meaning: "Confirmed — difference resolved (see notes)" },
      { symbol: "A", meaning: "Alternative procedure: subsequent cash receipt" },
      TICK_EXCEPTION,
    ],
  },
  Completeness: {
    objective:
      "Obtain audit evidence that all accounts receivable that should have been recorded are recorded as of the balance-sheet date.",
    procedure:
      "1. Obtain the list of all shipments made in the last [X] days before year-end and the first [X] days after.\n" +
      "2. For each shipment, trace to the corresponding sales invoice and verify the invoice was recorded in the proper period.\n" +
      "3. Inquire of management regarding any unbilled shipments, bill-and-hold arrangements, or revenue recorded outside the normal sales cycle.\n" +
      "4. Review credit memos issued after year-end for any that effectively reverse a current-year sale that should not have been recorded.\n" +
      "5. Scan the post year-end sales journal for unusually large invoices that could indicate prior-period revenue recorded late.\n" +
      "6. Document findings and conclude on completeness.",
    tickmarks: [
      TICK_AGREED_TB,
      { symbol: "SH", meaning: "Agreed to shipping document" },
      { symbol: "INV", meaning: "Agreed to sales invoice" },
      { symbol: "P", meaning: "Recorded in proper period" },
      TICK_NO_EXCEPTION,
      TICK_EXCEPTION,
    ],
  },
  RightsAndObligations: {
    objective:
      "Obtain audit evidence that the entity holds or controls the rights to the accounts receivable as of the balance-sheet date.",
    procedure:
      "1. Inquire of management regarding any factoring, pledging, assignment, or sale of receivables.\n" +
      "2. Review board minutes, loan agreements, and confirmation responses from financial institutions for any references to receivables pledged as collateral.\n" +
      "3. Review the AR subledger for any related-party balances; verify proper disclosure.\n" +
      "4. For any factored or pledged receivables identified, verify proper accounting treatment and disclosure in the financial statements.\n" +
      "5. Document conclusion on the entity's rights to recorded receivables.",
    tickmarks: [
      { symbol: "M", meaning: "Reviewed management representation" },
      { symbol: "L", meaning: "Reviewed loan agreement / board minutes" },
      { symbol: "RP", meaning: "Related-party balance — see disclosure WP" },
      TICK_NO_EXCEPTION,
      TICK_EXCEPTION,
    ],
  },
  ValuationAndAllocation: {
    objective:
      "Obtain audit evidence that accounts receivable are recorded at appropriate amounts and that the allowance for doubtful accounts is reasonable.",
    procedure:
      "1. Obtain the aged AR subledger and agree totals by aging bucket to the general ledger.\n" +
      "2. Recalculate the allowance for doubtful accounts using management's stated methodology; agree inputs (aging buckets, loss rates) to source.\n" +
      "3. Evaluate the reasonableness of management's loss-rate assumptions by comparing to historical write-off experience (3-5 year look-back).\n" +
      "4. For significant past-due balances (over 90 days), examine subsequent cash receipts, payment history, and any correspondence indicating collectibility issues.\n" +
      "5. Inquire of management and the credit department regarding specific accounts in dispute or known collection problems.\n" +
      "6. Compare days-sales-outstanding (DSO) to prior years; investigate significant changes.\n" +
      "7. Conclude on the adequacy of the allowance and the net realizable value of receivables.",
    tickmarks: [
      TICK_AGREED_TB,
      TICK_AGREED_SUB,
      { symbol: "R", meaning: "Recalculated — no exception" },
      { symbol: "H", meaning: "Compared to historical write-off rate" },
      { symbol: "SC", meaning: "Subsequent collection verified" },
      TICK_EXCEPTION,
    ],
  },
  CutOff: {
    objective:
      "Obtain audit evidence that AR-related transactions (sales and cash receipts) have been recorded in the proper accounting period.",
    procedure:
      "1. Obtain shipping records for the last 10 shipments before year-end and the first 10 after year-end.\n" +
      "2. For each shipment, trace to the corresponding sales invoice and verify the invoice was recorded in the period matching the shipment date (per the entity's revenue recognition policy).\n" +
      "3. Examine cash receipts recorded in the first 5 business days after year-end; verify those representing collections of CY receivables were properly reflected in the year-end AR balance.\n" +
      "4. Review credit memos and sales returns issued in the first 30 days after year-end; determine whether any relate to CY sales and require accrual.\n" +
      "5. Document any cutoff errors identified and quantify the effect on AR and sales.",
    tickmarks: [
      { symbol: "SH", meaning: "Agreed to shipping document" },
      { symbol: "INV", meaning: "Agreed to sales invoice" },
      { symbol: "P", meaning: "Recorded in proper period" },
      { symbol: "X", meaning: "Cutoff error — see exception sheet" },
      TICK_NO_EXCEPTION,
    ],
  },
  Accuracy: {
    objective:
      "Obtain audit evidence that amounts and other data related to accounts receivable have been recorded accurately.",
    procedure:
      "1. Foot and cross-foot the aged AR subledger; agree totals to the general ledger.\n" +
      "2. For a sample of customer balances, recompute the balance from the underlying invoice and payment activity.\n" +
      "3. Verify mathematical accuracy of any allowance calculations.\n" +
      "4. Investigate and document any differences identified.",
    tickmarks: [
      TICK_AGREED_TB,
      TICK_AGREED_SUB,
      { symbol: "F", meaning: "Footed — no exception" },
      { symbol: "X", meaning: "Cross-footed — no exception" },
      { symbol: "R", meaning: "Recomputed — no exception" },
      TICK_EXCEPTION,
    ],
  },
  Presentation: {
    objective:
      "Obtain audit evidence that accounts receivable are properly classified, described, and disclosed in the financial statements.",
    procedure:
      "1. Verify that current and non-current portions of receivables are properly classified on the balance sheet.\n" +
      "2. Review for credit balances within the AR subledger; verify reclassification to accounts payable for any material credit balances.\n" +
      "3. Verify proper disclosure of: allowance methodology, related-party receivables, factored / pledged receivables, and significant concentrations of credit risk.\n" +
      "4. Trace the financial-statement AR caption and footnote disclosures to the workpaper support.\n" +
      "5. Conclude on the adequacy of presentation and disclosure.",
    tickmarks: [
      { symbol: "FS", meaning: "Agreed to financial statements" },
      { symbol: "FN", meaning: "Agreed to footnote disclosure" },
      { symbol: "D", meaning: "Disclosure reviewed — no exception" },
      TICK_EXCEPTION,
    ],
  },
  ClassificationAndUnderstandability: {
    objective:
      "Obtain audit evidence that accounts receivable are appropriately classified and that related disclosures are clearly expressed.",
    procedure:
      "1. Review the AR subledger for accounts with credit balances; verify reclassification to AP for material amounts.\n" +
      "2. Verify segregation of current vs. non-current receivables on the balance sheet.\n" +
      "3. Review presentation of related-party receivables — separate caption or footnote per framework requirements.\n" +
      "4. Read the AR-related footnote disclosures; assess clarity and completeness against framework requirements.",
    tickmarks: [
      { symbol: "FS", meaning: "Agreed to financial statements" },
      { symbol: "FN", meaning: "Agreed to footnote disclosure" },
      TICK_NO_EXCEPTION,
      TICK_EXCEPTION,
    ],
  },
};

// FSLI key MUST match the FSLI labels used in workpaper-binder.ts (FSLI_GROUPS).
const PROCEDURE_LIBRARY: Record<string, FsliProcedures> = {
  "Accounts Receivable, net": ACCOUNTS_RECEIVABLE,
};

export function getProcedure(
  fsli: string,
  assertion: AssertionKey,
): ProcedureEntry | null {
  return PROCEDURE_LIBRARY[fsli]?.[assertion] ?? null;
}

export function hasFsliInLibrary(fsli: string): boolean {
  return Object.prototype.hasOwnProperty.call(PROCEDURE_LIBRARY, fsli);
}
