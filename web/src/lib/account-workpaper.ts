import ExcelJS from "exceljs";
import type { EngagementSetup } from "@/lib/engagement-schema";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";
import {
  ASSERTION_LABELS,
  TESTING_APPROACH_LABELS,
  type AssertionMatrix,
  type AssertionMatrixRow,
} from "@/lib/assertion-matrix";
import type { TrialBalanceAccount } from "@/lib/tb-parser";
import { findFsli, matchMatrixRow } from "@/lib/workpaper-binder";
import { displayAccountName } from "@/lib/account-name";
import {
  getProcedure,
  type AssertionKey,
  type ProcedureEntry,
} from "@/lib/procedure-library";
import {
  METHODOLOGIES,
  type MethodologyId,
  type SampleResult,
  type SelectionReason,
} from "@/lib/sampling-methodologies";
import type { AgingBucket, ArAnalytics } from "@/lib/ar-analytics";
import type { ScrTestResult } from "@/lib/scr-testing";
import { autosizeAllSheets } from "@/lib/excel-autosize";

const USD_FMT = '"$"#,##0;[Red]("$"#,##0);"—"';
const PCT_FMT = "0.0%;[Red]-0.0%;\"—\"";
const DSO_FMT = "0.0\" days\"";

// Short two-letter codes for sheet-tab names. Excel caps tab names at 31 chars,
// and the assertion's full display label (e.g. "Valuation and Allocation")
// pushes that limit with the account name in front. The auditor still sees
// the full assertion text in the tab body and on the cover index.
const ASSERTION_TAB_CODE: Record<AssertionKey, string> = {
  Existence: "E",
  Completeness: "C",
  Accuracy: "A",
  ValuationAndAllocation: "V",
  RightsAndObligations: "R",
  ClassificationAndUnderstandability: "Cl",
  CutOff: "CO",
  Occurrence: "O",
  Presentation: "P",
};

const NAVY = "FF1D3A52";
const CREAM = "FFEDE5D3";

export type AccountWorkpaperInput = {
  engagement: EngagementSetup;
  matrix: AssertionMatrix;
  account: TrialBalanceAccount;
  // Sample results keyed by assertion. Optional — when an AR Aging is
  // uploaded and the per-assertion methodology can produce a sample, the
  // orchestrator passes results in here. Sheets use them to populate the
  // Sample table + emit a "Sample — <assertion>" tab.
  sampleResults?: Partial<Record<AssertionKey, SampleResult>>;
  // Methodology chosen per assertion (whether or not it produced a sample).
  // Used to label the cover sheet.
  methodologySelections?: Partial<Record<AssertionKey, MethodologyId>>;
  // Optional analytics block — when an AR Aging is uploaded the orchestrator
  // computes DSO / aging composition / concentration / past-due % and
  // passes them here. Generator emits an "Analytics — AR" tab.
  arAnalytics?: ArAnalytics;
  // Optional SCR substantive-test result — when a Subsequent Cash Receipts
  // file is uploaded the orchestrator runs the matching engine and passes
  // results here. Generator emits an "SCR — Existence + Valuation" tab.
  scrTestResult?: ScrTestResult;
};

export async function generateAccountWorkpaper(
  input: AccountWorkpaperInput,
): Promise<Buffer> {
  const { engagement, matrix, account } = input;
  const sampleResults = input.sampleResults ?? {};
  const methodologySelections = input.methodologySelections ?? {};
  const fsli = findFsli(account.acctNum, account.name);
  const matrixRow = matchMatrixRow(account, matrix);

  // The assertions that get a tab. Prefer the matrix row's relevant
  // assertions; fall back to a sensible default set so the auditor still
  // gets a usable shell when the matrix didn't surface the account.
  const assertions: AssertionKey[] = matrixRow
    ? matrixRow.relevantAssertions
    : DEFAULT_ASSERTIONS_BY_FSLI[fsli] ?? ["Existence", "ValuationAndAllocation"];

  const wb = new ExcelJS.Workbook();
  wb.creator = "First-Pass";
  wb.created = new Date(matrix.generatedAt);
  wb.title = `${engagement.client.name} — ${displayAccountName(account.name)} Workpaper`;

  buildCoverSheet(wb, {
    engagement,
    account,
    fsli,
    matrixRow,
    assertions,
    methodologySelections,
    sampleResults,
  });
  for (const assertion of assertions) {
    buildAssertionSheet(wb, {
      engagement,
      account,
      fsli,
      assertion,
      matrixRow,
      sampleResult: sampleResults[assertion],
    });
  }
  // One detail tab per assertion that has selections — keeps the assertion
  // tab focused on procedure + results, and gives reviewers a single page
  // with methodology, parameters, seed, coverage, and the full selection
  // list.
  for (const assertion of assertions) {
    const result = sampleResults[assertion];
    if (result) {
      buildSampleSheet(wb, { account, assertion, result });
    }
  }

  if (input.arAnalytics) {
    buildAnalyticsSheet(wb, {
      engagement,
      account,
      analytics: input.arAnalytics,
    });
  }

  if (input.scrTestResult) {
    buildScrSheet(wb, {
      engagement,
      account,
      result: input.scrTestResult,
    });
  }

  // Final pass: widen any column whose content overflows its current width.
  // Never shrinks — preserves intentional minimums set by each sheet builder.
  autosizeAllSheets(wb);

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// ---------------------------------------------------------------------------
// Cover sheet
// ---------------------------------------------------------------------------

function buildCoverSheet(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
    account: TrialBalanceAccount;
    fsli: string;
    matrixRow: AssertionMatrixRow | undefined;
    assertions: AssertionKey[];
    methodologySelections: Partial<Record<AssertionKey, MethodologyId>>;
    sampleResults: Partial<Record<AssertionKey, SampleResult>>;
  },
) {
  const {
    engagement,
    account,
    fsli,
    matrixRow,
    assertions,
    methodologySelections,
    sampleResults,
  } = args;
  const sheet = wb.addWorksheet("Cover", {
    views: [{ state: "frozen", ySplit: 0 }],
  });
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 60;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 18;

  const title = sheet.addRow([
    `${account.acctNum} — ${displayAccountName(account.name)}`,
  ]);
  title.font = { size: 18, bold: true, color: { argb: NAVY } };
  sheet.mergeCells(title.number, 1, title.number, 4);

  const sub = sheet.addRow([
    `${engagement.client.name} · FYE ${engagement.client.fiscalYearEnd} · ${FRAMEWORK_LABELS[engagement.framework]} · ${INDUSTRY_LABELS[engagement.industry]}`,
  ]);
  sub.font = { italic: true, color: { argb: "FF555555" } };
  sheet.mergeCells(sub.number, 1, sub.number, 4);
  sheet.addRow([]);

  sectionHeader(sheet, "Account");
  addLabelValue(sheet, "Account #", account.acctNum);
  addLabelValue(sheet, "Account name", displayAccountName(account.name));
  addLabelValue(sheet, "FSLI", fsli);
  addLabelValue(sheet, "Section", account.section);
  const cyRow = addLabelValue(sheet, "CY Balance", account.cyBalance, USD_FMT);
  const pyRow = addLabelValue(sheet, "PY Balance", account.pyBalance, USD_FMT);
  addLabelFormula(
    sheet,
    "$ Change",
    `B${cyRow.number}-B${pyRow.number}`,
    account.cyBalance - account.pyBalance,
    USD_FMT,
  );
  sheet.addRow([]);

  sectionHeader(sheet, "Plan");
  if (matrixRow) {
    addLabelValue(
      sheet,
      "Planned approach",
      TESTING_APPROACH_LABELS[matrixRow.plannedApproach],
    );
    addLabelValue(sheet, "Overall risk", matrixRow.overallRiskLevel);
    const rationale = sheet.addRow(["Rationale", matrixRow.approachRationale]);
    rationale.getCell(1).font = { bold: true };
    rationale.alignment = { vertical: "top", wrapText: true };
    sheet.mergeCells(rationale.number, 2, rationale.number, 4);
    if (matrixRow.risks.length > 0) {
      const risks = sheet.addRow(["Risks", matrixRow.risks.join("\n")]);
      risks.getCell(1).font = { bold: true };
      risks.alignment = { vertical: "top", wrapText: true };
      sheet.mergeCells(risks.number, 2, risks.number, 4);
    }
  } else {
    const note = sheet.addRow([
      "No matrix row matched this account — assertions below default to a baseline. Regenerate the assertion matrix to refresh.",
    ]);
    note.font = { italic: true, color: { argb: "FF8A2F2F" } };
    sheet.mergeCells(note.number, 1, note.number, 4);
  }
  sheet.addRow([]);

  sectionHeader(sheet, "Assertion tabs");
  const hdr = sheet.addRow([
    "#",
    "Assertion",
    "Sampling methodology",
    "Sample",
  ]);
  styleTableHeader(hdr);
  assertions.forEach((a, i) => {
    const methId = methodologySelections[a];
    const methLabel = methId ? METHODOLOGIES[methId].label : "—";
    const result = sampleResults[a];
    const sampleSummary = result
      ? `${result.selections.length} of ${result.populationCount} · ${(result.coveragePct * 100).toFixed(0)}% $ coverage`
      : "—";
    const row = sheet.addRow([
      i + 1,
      ASSERTION_LABELS[a],
      methLabel,
      sampleSummary,
    ]);
    row.alignment = { vertical: "top", wrapText: true };
  });
  sheet.addRow([]);

  sectionHeader(sheet, "Sign-off");
  sheet.addRow(["Preparer", "", "Date", ""]);
  sheet.addRow(["Reviewer", "", "Date", ""]);
}

// ---------------------------------------------------------------------------
// Assertion sheet
// ---------------------------------------------------------------------------

function buildAssertionSheet(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
    account: TrialBalanceAccount;
    fsli: string;
    assertion: AssertionKey;
    matrixRow: AssertionMatrixRow | undefined;
    sampleResult: SampleResult | undefined;
  },
) {
  const { engagement, account, fsli, assertion, matrixRow, sampleResult } = args;
  const code = ASSERTION_TAB_CODE[assertion];
  const tabName = `${code} — ${ASSERTION_LABELS[assertion]}`.slice(0, 31);
  const sheet = wb.addWorksheet(tabName, {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  sheet.getColumn(1).width = 6;
  sheet.getColumn(2).width = 36;
  sheet.getColumn(3).width = 16;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 12;
  sheet.getColumn(6).width = 12;
  sheet.getColumn(7).width = 40;

  const title = sheet.addRow([
    `${account.acctNum} — ${displayAccountName(account.name)} — ${ASSERTION_LABELS[assertion]}`,
  ]);
  title.font = { size: 14, bold: true, color: { argb: NAVY } };
  sheet.mergeCells(title.number, 1, title.number, 7);

  const sub = sheet.addRow([
    `${engagement.client.name} · FYE ${engagement.client.fiscalYearEnd}`,
  ]);
  sub.font = { italic: true, color: { argb: "FF555555" } };
  sheet.mergeCells(sub.number, 1, sub.number, 7);
  sheet.addRow([]);

  const lib = getProcedure(fsli, assertion);

  if (lib) {
    writeProcedureBlocks(sheet, lib);
  } else {
    sectionHeader(sheet, "Objective");
    addTextBlock(sheet, "TODO — write the assertion objective for this account.");
    sectionHeader(sheet, "Procedure");
    addTextBlock(
      sheet,
      "TODO — write the audit procedure. No library entry exists for this FSLI + assertion combination yet.",
    );
  }

  if (matrixRow && matrixRow.risks.length > 0) {
    sectionHeader(sheet, "Risks (from assertion matrix)");
    addTextBlock(sheet, matrixRow.risks.map((r) => `• ${r}`).join("\n"));
  }

  sectionHeader(sheet, "Sample selection");
  if (sampleResult) {
    const summary = sheet.addRow([
      `${METHODOLOGIES[sampleResult.methodology].label} · ${sampleResult.selections.length} selected · ` +
        `${(sampleResult.coveragePct * 100).toFixed(0)}% \$ coverage · seed ${sampleResult.seed}. ` +
        `See Sample tab for methodology, parameters, and full selection list.`,
    ]);
    summary.font = { italic: true, color: { argb: "FF555555" } };
    summary.alignment = { vertical: "top", wrapText: true };
    summary.height = 36;
    sheet.mergeCells(summary.number, 1, summary.number, 7);
  } else {
    const note = sheet.addRow([
      "No automated sample for this assertion (no AR Aging uploaded yet, or methodology is set to Manual). Populate selections below by hand.",
    ]);
    note.font = { italic: true, color: { argb: "FF555555" } };
    note.alignment = { vertical: "top", wrapText: true };
    note.height = 36;
    sheet.mergeCells(note.number, 1, note.number, 7);
  }

  const sampleHdr = sheet.addRow([
    "#",
    "Customer / Item",
    "CY Balance",
    "Tested To",
    "Tickmark",
    "Exception?",
    "Notes",
  ]);
  styleTableHeader(sampleHdr);

  if (sampleResult && sampleResult.selections.length > 0) {
    sampleResult.selections.forEach((sel, idx) => {
      const r = sheet.addRow([
        idx + 1,
        `${sel.custNum} — ${sel.custName}`,
        sel.balance,
        "",
        "",
        "",
        selectionReasonLabel(sel.reason),
      ]);
      r.getCell(3).numFmt = USD_FMT;
      r.alignment = { vertical: "top", wrapText: true };
      r.height = 22;
    });
  } else {
    // Empty-shell mode: 10 rows for hand entry.
    for (let i = 1; i <= 10; i++) {
      const r = sheet.addRow([i, "", "", "", "", "", ""]);
      r.getCell(3).numFmt = USD_FMT;
      r.alignment = { vertical: "top", wrapText: true };
      r.height = 22;
    }
  }
  sheet.addRow([]);

  if (lib) {
    sectionHeader(sheet, "Tickmark legend");
    for (const t of lib.tickmarks) {
      const row = sheet.addRow([t.symbol, t.meaning]);
      row.getCell(1).font = { bold: true };
      row.alignment = { vertical: "top", wrapText: true };
      sheet.mergeCells(row.number, 2, row.number, 7);
    }
    sheet.addRow([]);
  }

  sectionHeader(sheet, "Exceptions");
  const exHdr = sheet.addRow([
    "#",
    "Description",
    "$ Impact",
    "Disposition",
    "",
    "",
    "",
  ]);
  styleTableHeader(exHdr);
  for (let i = 1; i <= 3; i++) {
    const r = sheet.addRow([i, "", "", "", "", "", ""]);
    r.getCell(3).numFmt = USD_FMT;
    r.height = 22;
  }
  sheet.addRow([]);

  sectionHeader(sheet, "Conclusion");
  addTextBlock(
    sheet,
    buildAssertionConclusion({
      account,
      assertion,
      sampleResult,
      matrixRow,
    }),
  );
  sheet.addRow([]);

  sectionHeader(sheet, "Sign-off");
  sheet.addRow(["Preparer", "", "Date", ""]);
  sheet.addRow(["Reviewer", "", "Date", ""]);
}

// First-pass per-assertion conclusion. Describes what was tested
// (methodology + coverage), the residual-risk level the testing was
// calibrated against, and what the auditor still has to do (review
// the tickmark column for exceptions and document any findings).
function buildAssertionConclusion(args: {
  account: TrialBalanceAccount;
  assertion: AssertionKey;
  sampleResult: SampleResult | undefined;
  matrixRow: AssertionMatrixRow | undefined;
}): string {
  const { account, assertion, sampleResult, matrixRow } = args;
  const assertionLabel = ASSERTION_LABELS[assertion];

  if (!sampleResult) {
    return (
      `First-pass conclusion: No automated sample was drawn for the ${assertionLabel} assertion on ${account.acctNum} — ${displayAccountName(account.name)}. ` +
      `The methodology is set to Manual or the required upload (AR aging) wasn't available at generation time. ` +
      `Auditor: populate selections below by hand, document tickmarks + evidence, and update this conclusion based on test results.`
    );
  }

  const methodLabel = METHODOLOGIES[sampleResult.methodology].label;
  const coveragePct = (sampleResult.coveragePct * 100).toFixed(0);
  const coverageDollar = `$${Math.round(
    sampleResult.coverageDollar,
  ).toLocaleString("en-US")}`;
  const populationDollar = `$${Math.round(
    sampleResult.populationTotal,
  ).toLocaleString("en-US")}`;
  const riskClause = matrixRow?.overallRiskLevel
    ? ` Calibrated against the assertion-matrix overall risk level of ${matrixRow.overallRiskLevel}.`
    : "";

  return (
    `First-pass conclusion: Tested ${sampleResult.selections.length} of ${sampleResult.populationCount} customers via ${methodLabel}, ` +
    `covering ${coverageDollar} of ${populationDollar} (${coveragePct}% $ coverage; seed ${sampleResult.seed}).${riskClause} ` +
    `Subject to auditor review of the tickmark column above — no exceptions noted in the populated rows until the auditor documents otherwise. ` +
    `Update this paragraph to reflect any exceptions identified and the final ${assertionLabel} conclusion.`
  );
}

// ---------------------------------------------------------------------------
// Sample — <assertion> sheet
// One dedicated tab per assertion that produced selections. Tightly scoped:
// methodology header, parameters, seed, coverage, and the full selection
// list (top-tier first, then random). Reviewers can defend every selection
// without leaving this tab.
// ---------------------------------------------------------------------------

function buildSampleSheet(
  wb: ExcelJS.Workbook,
  args: {
    account: TrialBalanceAccount;
    assertion: AssertionKey;
    result: SampleResult;
  },
) {
  const { account, assertion, result } = args;
  const tabName = `Sample — ${ASSERTION_LABELS[assertion]}`.slice(0, 31);
  const sheet = wb.addWorksheet(tabName, {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  sheet.getColumn(1).width = 4;
  sheet.getColumn(2).width = 14;
  sheet.getColumn(3).width = 40;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 16;
  sheet.getColumn(6).width = 40;

  const title = sheet.addRow([
    `Sample selection — ${account.acctNum} ${displayAccountName(account.name)} — ${ASSERTION_LABELS[assertion]}`,
  ]);
  title.font = { size: 14, bold: true, color: { argb: NAVY } };
  sheet.mergeCells(title.number, 1, title.number, 6);
  sheet.addRow([]);

  sectionHeader(sheet, "Methodology");
  addLabelValue(sheet, "Method", METHODOLOGIES[result.methodology].label);
  addLabelValue(
    sheet,
    "Description",
    METHODOLOGIES[result.methodology].description,
  );
  addLabelValue(sheet, "Seed", result.seed);
  sheet.addRow([]);

  sectionHeader(sheet, "Parameters");
  // Each methodology has a different params shape — render the fields
  // that actually apply so reviewers see the real auditable inputs.
  if (result.methodology === "highCoverageHybrid") {
    addLabelValue(
      sheet,
      "Top-tier threshold (% of PM)",
      result.params.topTierPmPct,
      PCT_FMT,
    );
    addLabelValue(
      sheet,
      "Target $ coverage",
      result.params.targetCoveragePct,
      PCT_FMT,
    );
    addLabelValue(sheet, "Minimum sample size", result.params.minSampleSize);
  } else if (result.methodology === "riskBasedTable") {
    addLabelValue(sheet, "Overall risk level", result.params.riskLevel);
    addLabelValue(sheet, "Target sample size", result.params.targetSize);
    addLabelValue(
      sheet,
      "Top-tier auto-included (count)",
      result.params.topTierCount,
    );
  } else if (result.methodology === "musStatistical") {
    addLabelValue(
      sheet,
      "Tolerable misstatement ($)",
      result.params.tolerableMisstatement,
      USD_FMT,
    );
    addLabelValue(
      sheet,
      "Confidence factor",
      result.params.confidenceFactor,
    );
    addLabelValue(
      sheet,
      "Sampling interval ($)",
      result.params.samplingInterval,
      USD_FMT,
    );
    addLabelValue(
      sheet,
      "Computed sample size (n)",
      result.params.computedSampleSize,
    );
  }
  sheet.addRow([]);

  sectionHeader(sheet, "Population + coverage");
  addLabelValue(sheet, "Population total ($)", result.populationTotal, USD_FMT);
  addLabelValue(sheet, "Population items", result.populationCount);
  addLabelValue(sheet, "Selections", result.selections.length);
  addLabelValue(sheet, "Coverage ($)", result.coverageDollar, USD_FMT);
  addLabelValue(sheet, "Coverage (%)", result.coveragePct, PCT_FMT);
  sheet.addRow([]);

  sectionHeader(sheet, "Selections");
  const hdr = sheet.addRow([
    "#",
    "Customer #",
    "Customer name",
    "Balance",
    "Reason",
    "",
  ]);
  styleTableHeader(hdr);
  result.selections.forEach((sel, i) => {
    const row = sheet.addRow([
      i + 1,
      sel.custNum,
      sel.custName,
      sel.balance,
      selectionReasonLabel(sel.reason),
      "",
    ]);
    row.getCell(4).numFmt = USD_FMT;
    // Bold the "auto-included" reasons across methodologies — these are
    // the always-selected rows that survive any seed change.
    if (
      sel.reason === "top-tier" ||
      sel.reason === "risk-table-top" ||
      sel.reason === "mus-auto" ||
      sel.reason === "aged-past-due"
    ) {
      row.getCell(5).font = { bold: true };
    }
  });
}

function selectionReasonLabel(reason: SelectionReason): string {
  switch (reason) {
    case "top-tier":
      return "Auto-included (top-tier)";
    case "random":
      return "Random";
    case "risk-table-top":
      return "Auto-included (largest balances)";
    case "risk-table-random":
      return "Random (risk-based fill)";
    case "mus-auto":
      return "Auto-included (≥ sampling interval)";
    case "mus-hit":
      return "MUS systematic hit";
    case "aged-past-due":
      return "Auto-included (past-due > 60 days)";
  }
}

// ---------------------------------------------------------------------------
// Analytics — AR sheet
// DSO trend (CY vs PY), aging composition (CY only — PY aging is its own
// upload, separate slice), top-5 concentration, and past-due summary.
// Threshold-flagged rows get a red fill so reviewers can scan.
// ---------------------------------------------------------------------------

function buildAnalyticsSheet(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
    account: TrialBalanceAccount;
    analytics: ArAnalytics;
  },
) {
  const { engagement, account, analytics } = args;
  const sheet = wb.addWorksheet("Analytics — AR", {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  sheet.getColumn(1).width = 36;
  sheet.getColumn(2).width = 18;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 16;
  sheet.getColumn(6).width = 36;

  const title = sheet.addRow([
    `Analytics — ${account.acctNum} ${displayAccountName(account.name)}`,
  ]);
  title.font = { size: 14, bold: true, color: { argb: NAVY } };
  sheet.mergeCells(title.number, 1, title.number, 6);

  const sub = sheet.addRow([
    `${engagement.client.name} · FYE ${engagement.client.fiscalYearEnd}` +
      (analytics.aging.asOfDate
        ? ` · Aging as of ${analytics.aging.asOfDate}`
        : ""),
  ]);
  sub.font = { italic: true, color: { argb: "FF555555" } };
  sheet.mergeCells(sub.number, 1, sub.number, 6);
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // DSO block
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Days Sales Outstanding (DSO)");
  const dsoHdr = sheet.addRow([
    "Metric",
    "PY",
    "CY",
    "YoY Change",
    "YoY %",
    "Auditor Comment",
  ]);
  styleTableHeader(dsoHdr);

  const d = analytics.dso;

  // Revenue row — PY/CY raw, $ change + % change as formulas.
  const revRow = sheet.addRow(["Revenue", d.revenuePy, d.revenueCy, "", "", ""]);
  revRow.getCell(2).numFmt = USD_FMT;
  revRow.getCell(3).numFmt = USD_FMT;
  setFormula(revRow.getCell(4), `C${revRow.number}-B${revRow.number}`, d.revenueCy - d.revenuePy, USD_FMT);
  setFormula(
    revRow.getCell(5),
    `IFERROR((C${revRow.number}-B${revRow.number})/B${revRow.number},0)`,
    safePct(d.revenueCy - d.revenuePy, d.revenuePy) ?? 0,
    PCT_FMT,
  );

  // AR row — same pattern.
  const arRow = sheet.addRow(["AR, net (this account)", d.arPy, d.arCy, "", "", ""]);
  arRow.getCell(2).numFmt = USD_FMT;
  arRow.getCell(3).numFmt = USD_FMT;
  setFormula(arRow.getCell(4), `C${arRow.number}-B${arRow.number}`, d.arCy - d.arPy, USD_FMT);
  setFormula(
    arRow.getCell(5),
    `IFERROR((C${arRow.number}-B${arRow.number})/B${arRow.number},0)`,
    safePct(d.arCy - d.arPy, d.arPy) ?? 0,
    PCT_FMT,
  );

  // DSO row — every cell is a formula referencing the rows above.
  const dsoRow = sheet.addRow([
    "DSO (days) = AR / Revenue × 365",
    "",
    "",
    "",
    "",
    "Computed",
  ]);
  dsoRow.font = { bold: true };
  setFormula(
    dsoRow.getCell(2),
    `IFERROR(B${arRow.number}/B${revRow.number}*365,0)`,
    d.dsoPy ?? 0,
    DSO_FMT,
  );
  setFormula(
    dsoRow.getCell(3),
    `IFERROR(C${arRow.number}/C${revRow.number}*365,0)`,
    d.dsoCy ?? 0,
    DSO_FMT,
  );
  setFormula(
    dsoRow.getCell(4),
    `C${dsoRow.number}-B${dsoRow.number}`,
    d.dsoChangeDays ?? 0,
    DSO_FMT,
  );
  setFormula(
    dsoRow.getCell(5),
    `IFERROR((C${dsoRow.number}-B${dsoRow.number})/B${dsoRow.number},0)`,
    d.dsoChangePct ?? 0,
    PCT_FMT,
  );
  if (d.flagged) {
    dsoRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFADBD8" },
      };
    });
  }
  if (d.industryBenchmark !== null) {
    pushRow(
      sheet,
      [
        "Industry benchmark",
        d.industryBenchmark,
        d.industryBenchmark,
        0,
        0,
        `Typical ~${d.industryBenchmark} days for ${engagement.industry}`,
      ],
      { formats: [, DSO_FMT, DSO_FMT, DSO_FMT, PCT_FMT] },
    );
  }
  if (d.flagged) {
    const note = sheet.addRow([
      `Flagged: DSO change ${(d.dsoChangeDays ?? 0).toFixed(1)} days (${((d.dsoChangePct ?? 0) * 100).toFixed(1)}%) exceeds threshold (${d.flagDaysThreshold} days or ${(d.flagPctThreshold * 100).toFixed(0)}%).`,
    ]);
    note.font = { bold: true, color: { argb: "FF8A2F2F" } };
    sheet.mergeCells(note.number, 1, note.number, 6);
  }
  sheet.addRow([]);
  pushConclusionRow(
    sheet,
    "DSO conclusion (first-pass):",
    buildDsoConclusion(d),
  );
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // Aging composition (CY vs PY when uploaded)
  // -----------------------------------------------------------------------
  const hasPy = analytics.pyAging !== null;
  sectionHeader(
    sheet,
    hasPy ? "Aging composition (CY vs PY)" : "Aging composition (CY)",
  );
  if (!hasPy) {
    const agingNote = sheet.addRow([
      "PY aging not uploaded — upload a PY AR Aging file in section 6 to see PY/CY composition comparison.",
    ]);
    agingNote.font = { italic: true, color: { argb: "FF555555" } };
    sheet.mergeCells(agingNote.number, 1, agingNote.number, 6);
  }

  const agingHdr = hasPy
    ? sheet.addRow([
        "Aging Bucket",
        "CY $",
        "CY %",
        "PY $",
        "PY %",
        "Δ %",
      ])
    : sheet.addRow([
        "Aging Bucket",
        "$ Amount",
        "% of Total",
        "",
        "",
        "",
      ]);
  styleTableHeader(agingHdr);

  // Lookup helper for PY buckets by label so each row pulls the
  // matching PY bucket regardless of array order.
  const pyByLabel = new Map<string, AgingBucket>();
  if (analytics.pyAging) {
    for (const b of analytics.pyAging.buckets) pyByLabel.set(b.label, b);
  }

  // Capture the bucket rows so we can SUM them on the Total row and
  // reference the Total cell for the % formulas. Total goes first in the
  // write order; the % formula refers FORWARD to the Total row (Excel
  // handles forward refs fine).
  const bucketRows: { row: ExcelJS.Row; bucket: AgingBucket }[] = [];
  for (const b of analytics.aging.buckets) {
    const pyMatch = pyByLabel.get(b.label);
    const row = hasPy
      ? sheet.addRow([
          b.label,
          b.amount,
          "",
          pyMatch?.amount ?? 0,
          "",
          "",
        ])
      : sheet.addRow([b.label, b.amount, "", "", "", ""]);
    row.getCell(2).numFmt = USD_FMT;
    if (hasPy) row.getCell(4).numFmt = USD_FMT;
    if (
      (b.label === "61-90 Days" || b.label === "90+ Days") &&
      b.amount > 0
    ) {
      row.getCell(1).font = { bold: true };
    }
    bucketRows.push({ row, bucket: b });
  }
  const firstBucketRow = bucketRows[0].row.number;
  const lastBucketRow = bucketRows[bucketRows.length - 1].row.number;

  const totalRow = hasPy
    ? sheet.addRow(["Total", "", "", "", "", ""])
    : sheet.addRow(["Total", "", "", "", "", ""]);
  totalRow.font = { bold: true };
  setFormula(
    totalRow.getCell(2),
    `SUM(B${firstBucketRow}:B${lastBucketRow})`,
    analytics.aging.total,
    USD_FMT,
  );
  setFormula(totalRow.getCell(3), `1`, 1, PCT_FMT);
  if (hasPy) {
    setFormula(
      totalRow.getCell(4),
      `SUM(D${firstBucketRow}:D${lastBucketRow})`,
      analytics.pyAging?.total ?? 0,
      USD_FMT,
    );
    setFormula(totalRow.getCell(5), `1`, 1, PCT_FMT);
  }
  totalRow.eachCell((c) => {
    c.border = { top: { style: "thin" }, bottom: { style: "double" } };
  });

  // Backfill the % formulas now that we know the Total cell address.
  for (const { row, bucket } of bucketRows) {
    setFormula(
      row.getCell(3),
      `IFERROR(B${row.number}/B${totalRow.number},0)`,
      bucket.percentOfTotal,
      PCT_FMT,
    );
    if (hasPy) {
      const pyMatch = pyByLabel.get(bucket.label);
      setFormula(
        row.getCell(5),
        `IFERROR(D${row.number}/D${totalRow.number},0)`,
        pyMatch?.percentOfTotal ?? 0,
        PCT_FMT,
      );
      // Δ% = CY% - PY%, reported in percentage points
      setFormula(
        row.getCell(6),
        `C${row.number}-E${row.number}`,
        bucket.percentOfTotal - (pyMatch?.percentOfTotal ?? 0),
        PCT_FMT,
      );
    }
  }
  sheet.addRow([]);
  pushConclusionRow(
    sheet,
    "Aging conclusion (first-pass):",
    buildAgingConclusion(
      analytics.aging,
      analytics.totalPastDue,
      analytics.pyAging,
    ),
  );
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // Top-5 concentration
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Top-5 customer concentration");
  const concHdr = sheet.addRow([
    "Customer",
    "Balance",
    "% of AR",
    "Cumulative %",
    "",
    "",
  ]);
  styleTableHeader(concHdr);
  // % of AR references the Total cell from the aging block above; cumulative
  // % is a running SUM of the % column rows above + the current row's %.
  const firstConcRow = sheet.rowCount + 1;
  analytics.topFive.forEach((r, i) => {
    const row = sheet.addRow([
      `${r.custNum} — ${r.custName}`,
      r.balance,
      "",
      "",
      "",
      "",
    ]);
    row.getCell(2).numFmt = USD_FMT;
    setFormula(
      row.getCell(3),
      `IFERROR(B${row.number}/B${totalRow.number},0)`,
      r.pctOfTotal,
      PCT_FMT,
    );
    // Cumulative % = SUM of all % cells from the first conc row through
    // the current one. SUM is fine on a single-cell range when i = 0.
    setFormula(
      row.getCell(4),
      `SUM(C${firstConcRow}:C${firstConcRow + i})`,
      r.cumulativePct,
      PCT_FMT,
    );
  });
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // Past-due summary
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Past-due summary");
  const pd = analytics.totalPastDue;
  // Past-due $ sums the three "past-due" buckets in the aging block
  // (31-60, 61-90, 90+) — indices 2, 3, 4 in analytics.aging.buckets.
  const pdBucketRowNums = [
    bucketRows[2]?.row.number,
    bucketRows[3]?.row.number,
    bucketRows[4]?.row.number,
  ].filter((n): n is number => typeof n === "number");
  const pdSumFormula =
    pdBucketRowNums.length > 0
      ? pdBucketRowNums.map((n) => `B${n}`).join("+")
      : "0";

  const pdRow = sheet.addRow([
    "Past-due AR (31+ days)",
    "",
    "",
    "",
    "",
    `Threshold ${(pd.flagPctThreshold * 100).toFixed(0)}%`,
  ]);
  pdRow.font = { bold: true };
  setFormula(pdRow.getCell(2), pdSumFormula, pd.pastDueDollar, USD_FMT);
  setFormula(
    pdRow.getCell(3),
    `IFERROR(B${pdRow.number}/B${totalRow.number},0)`,
    pd.pastDuePct,
    PCT_FMT,
  );
  if (pd.flagged) {
    pdRow.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFFADBD8" },
      };
    });
    const note = sheet.addRow([
      `Flagged: ${(pd.pastDuePct * 100).toFixed(1)}% of AR is past-due, above the ${(pd.flagPctThreshold * 100).toFixed(0)}% threshold. Evaluate allowance for doubtful accounts and follow up on aged balances.`,
    ]);
    note.font = { bold: true, color: { argb: "FF8A2F2F" } };
    note.alignment = { wrapText: true, vertical: "top" };
    note.height = 40;
    sheet.mergeCells(note.number, 1, note.number, 6);
  }
}

function pushRow(
  sheet: ExcelJS.Worksheet,
  values: (string | number | null)[],
  opts: { formats?: (string | undefined)[]; bold?: boolean } = {},
): ExcelJS.Row {
  const row = sheet.addRow(values as ExcelJS.CellValue[]);
  if (opts.bold) row.font = { bold: true };
  opts.formats?.forEach((fmt, i) => {
    if (fmt) row.getCell(i + 1).numFmt = fmt;
  });
  return row;
}

function pushConclusionRow(
  sheet: ExcelJS.Worksheet,
  label: string,
  text?: string,
) {
  const row = sheet.addRow([label, text ?? "", "", "", "", ""]);
  row.getCell(1).font = { bold: true };
  row.getCell(2).alignment = { vertical: "top", wrapText: true };
  row.alignment = { vertical: "top", wrapText: true };
  // Generous row height when we have first-pass text; the auditor can
  // resize after edit. Keep the old 40 when blank for the manual case.
  row.height = text ? Math.min(160, Math.max(60, Math.ceil(text.length / 12))) : 40;
  sheet.mergeCells(row.number, 2, row.number, 6);
}

// First-pass DSO conclusion — narrates revenue/AR change, DSO movement,
// flag status, and industry-benchmark gap. Audit-ready voice; the
// auditor sees this as a starting point in the workpaper and edits.
function buildDsoConclusion(d: import("@/lib/ar-analytics").DsoBlock): string {
  const fmt$ = (n: number) =>
    `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
  const dir = (n: number) =>
    n > 0 ? "increased" : n < 0 ? "decreased" : "held flat";
  const revDelta = d.revenueCy - d.revenuePy;
  const arDelta = d.arCy - d.arPy;
  const revPct =
    d.revenuePy !== 0 ? ((revDelta / d.revenuePy) * 100).toFixed(1) : "n/a";
  const arPct =
    d.arPy !== 0 ? ((arDelta / d.arPy) * 100).toFixed(1) : "n/a";
  const dsoCyStr =
    d.dsoCy === null ? "n/a" : `${d.dsoCy.toFixed(1)} days`;
  const dsoPyStr =
    d.dsoPy === null ? "n/a" : `${d.dsoPy.toFixed(1)} days`;
  const dsoChangeStr =
    d.dsoChangeDays === null
      ? ""
      : ` (${d.dsoChangeDays >= 0 ? "+" : ""}${d.dsoChangeDays.toFixed(1)} days, ${
          d.dsoChangePct === null
            ? ""
            : `${(d.dsoChangePct * 100).toFixed(1)}%`
        })`;
  const benchmark =
    d.industryBenchmark !== null && d.dsoCy !== null
      ? `Industry benchmark is ~${d.industryBenchmark} days; CY DSO is ${
          d.dsoCy > d.industryBenchmark
            ? `${(d.dsoCy - d.industryBenchmark).toFixed(1)} days above`
            : d.dsoCy < d.industryBenchmark
              ? `${(d.industryBenchmark - d.dsoCy).toFixed(1)} days below`
              : "in line with"
        } the benchmark.`
      : "";
  const flag = d.flagged
    ? ` Flagged — change exceeds the ${d.flagDaysThreshold}-day / ${(d.flagPctThreshold * 100).toFixed(0)}% threshold; consider whether collection deterioration or revenue-recognition cutoff is driving the movement and tie out to subsequent cash + allowance work.`
    : " No threshold breach; collection cadence appears consistent with PY.";
  return (
    `Revenue ${dir(revDelta)} from ${fmt$(d.revenuePy)} to ${fmt$(d.revenueCy)} (${revPct}%); AR ${dir(arDelta)} from ${fmt$(d.arPy)} to ${fmt$(d.arCy)} (${arPct}%). ` +
    `DSO moved from ${dsoPyStr} to ${dsoCyStr}${dsoChangeStr}. ` +
    `${benchmark}${flag}`.trim()
  );
}

// First-pass aging-composition conclusion — narrates total AR, the
// healthy/concerning split, and the past-due exposure. When PY aging
// is supplied, appends a PY vs CY shift comparison so the auditor can
// see whether the aging profile has deteriorated.
function buildAgingConclusion(
  aging: import("@/lib/ar-analytics").AgingCompositionBlock,
  pastDue: import("@/lib/ar-analytics").PastDueBlock,
  pyAging: import("@/lib/ar-analytics").AgingCompositionBlock | null = null,
): string {
  const fmt$ = (n: number) =>
    `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
  const pctOf =
    (block: import("@/lib/ar-analytics").AgingCompositionBlock) =>
    (label: string): number => {
      const b = block.buckets.find((x) => x.label === label);
      return b ? b.percentOfTotal : 0;
    };
  const cyPct = pctOf(aging);
  const currentPct = ((cyPct("Current") + cyPct("1-30 Days")) * 100).toFixed(1);
  const d3160 = (cyPct("31-60 Days") * 100).toFixed(1);
  const d6190 = (cyPct("61-90 Days") * 100).toFixed(1);
  const d90 = (cyPct("90+ Days") * 100).toFixed(1);
  const pdPct = (pastDue.pastDuePct * 100).toFixed(1);
  const flag = pastDue.flagged
    ? ` Flagged — past-due ratio exceeds the ${(pastDue.flagPctThreshold * 100).toFixed(0)}% threshold; concentrate Valuation testing on customers carrying balances aged >60 days and corroborate with subsequent cash receipts and allowance adequacy.`
    : " Past-due ratio is within the threshold; allowance evaluation may rely primarily on the 90+ bucket.";

  let pyClause = "";
  if (pyAging) {
    const pyPct = pctOf(pyAging);
    const pyPastDuePct =
      pyPct("31-60 Days") + pyPct("61-90 Days") + pyPct("90+ Days");
    const cyPastDuePct = pastDue.pastDuePct;
    const delta = (cyPastDuePct - pyPastDuePct) * 100;
    const dir =
      Math.abs(delta) < 0.05
        ? "held flat"
        : delta > 0
          ? `worsened by ${delta.toFixed(1)} pp`
          : `improved by ${Math.abs(delta).toFixed(1)} pp`;
    pyClause =
      ` Versus PY (total AR ${fmt$(pyAging.total)}), the past-due share ${dir} ` +
      `(PY ${(pyPastDuePct * 100).toFixed(1)}% → CY ${pdPct}%).`;
  }

  return (
    `Total AR of ${fmt$(aging.total)} as of ${aging.asOfDate ?? "the balance-sheet date"}. ` +
    `Current + 1-30 day balances represent ${currentPct}% of the book; 31-60 day balances ${d3160}%, ` +
    `61-90 day balances ${d6190}%, and balances aged 90+ days ${d90}%. ` +
    `Total past-due (31+ days) of ${fmt$(pastDue.pastDueDollar)} (${pdPct}% of AR).${pyClause}${flag}`
  );
}

function safePct(numerator: number, denominator: number): number | null {
  if (denominator === 0) return null;
  return numerator / denominator;
}

// Sets an Excel formula on a single cell, alongside the pre-computed
// result so apps that don't recompute on open (PDF previews, web previews)
// still show the value. Excel itself recomputes — so when the auditor
// edits a balance, every dependent cell refreshes automatically.
function setFormula(
  cell: ExcelJS.Cell,
  formula: string,
  result: number,
  numFmt?: string,
): void {
  cell.value = { formula, result };
  if (numFmt) cell.numFmt = numFmt;
}

// ---------------------------------------------------------------------------
// SCR — Existence + Valuation sheet
// Subsequent Cash Receipts substantive test. Drops into the AR workpaper
// when an SCR file is uploaded. Provides Existence evidence (receipts on
// YE invoices = the receivables existed) AND Valuation evidence
// (uncollected aged invoices = collectibility concern).
// ---------------------------------------------------------------------------

function buildScrSheet(
  wb: ExcelJS.Workbook,
  args: {
    engagement: EngagementSetup;
    account: TrialBalanceAccount;
    result: ScrTestResult;
  },
) {
  const { engagement, account, result } = args;
  const sheet = wb.addWorksheet("SCR — Existence + Valuation", {
    views: [{ state: "frozen", ySplit: 0 }],
  });

  sheet.getColumn(1).width = 18;
  sheet.getColumn(2).width = 28;
  sheet.getColumn(3).width = 18;
  sheet.getColumn(4).width = 18;
  sheet.getColumn(5).width = 18;
  sheet.getColumn(6).width = 18;
  sheet.getColumn(7).width = 40;

  const title = sheet.addRow([
    `Subsequent Cash Receipts — ${account.acctNum} ${displayAccountName(account.name)}`,
  ]);
  title.font = { size: 14, bold: true, color: { argb: NAVY } };
  sheet.mergeCells(title.number, 1, title.number, 7);

  const sub = sheet.addRow([
    `${engagement.client.name} · FYE ${engagement.client.fiscalYearEnd}` +
      (result.periodLabel ? ` · ${result.periodLabel}` : ""),
  ]);
  sub.font = { italic: true, color: { argb: "FF555555" } };
  sheet.mergeCells(sub.number, 1, sub.number, 7);
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // Coverage summary
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Coverage summary");
  const c = result.coverage;
  const yeArRow = addLabelValue(sheet, "YE AR total ($)", c.yeArTotal, USD_FMT);
  const totalRcptsRow = addLabelValue(
    sheet,
    "Total receipts applied ($)",
    c.totalCollected,
    USD_FMT,
  );
  // Coverage % = Total receipts / YE AR total. Live formula so the auditor
  // can edit either input and see coverage recompute.
  addLabelFormula(
    sheet,
    "Coverage of YE AR (%)",
    `IFERROR(B${totalRcptsRow.number}/B${yeArRow.number},0)`,
    c.coveragePct,
    PCT_FMT,
  );
  // 30/60-day coverage windows can't be derived from the cells above
  // (they depend on receipt-by-receipt dates). Keep as raw values.
  addLabelValue(sheet, "% collected within 30 days post-YE", c.pctCollectedWithin30, PCT_FMT);
  addLabelValue(sheet, "% collected within 60 days post-YE", c.pctCollectedWithin60, PCT_FMT);
  addLabelValue(sheet, "Receipts processed", c.receiptCount);
  addLabelValue(sheet, "Window length (days)", c.daysWindow);
  if (c.daysToCollectMedian !== null) {
    addLabelValue(sheet, "Days to collect — median", c.daysToCollectMedian);
  }
  if (c.daysToCollectMax !== null) {
    addLabelValue(sheet, "Days to collect — max", c.daysToCollectMax);
  }
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // Receipt-level detail (matching)
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Receipt-to-invoice matching");
  const recHdr = sheet.addRow([
    "Receipt #",
    "Customer",
    "Invoice",
    "Match Status",
    "Receipt $",
    "Days to Collect",
    "Notes",
  ]);
  styleTableHeader(recHdr);
  for (const m of result.receiptMatches) {
    const row = sheet.addRow([
      m.receipt.receiptNum,
      m.receipt.customerName,
      m.receipt.invoiceNum,
      matchStatusLabel(m.status),
      m.receipt.amountReceived,
      m.daysToCollect ?? "",
      m.receipt.notes,
    ]);
    row.getCell(5).numFmt = USD_FMT;
    row.alignment = { vertical: "top", wrapText: true };
    if (m.status === "unmatched-receipt") {
      row.getCell(4).font = { bold: true, color: { argb: "FF8A2F2F" } };
    } else if (m.status === "matched-partial") {
      row.getCell(4).font = { bold: true, color: { argb: "FFB7791F" } };
    }
  }
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // Per-customer rollup (sampled customers highlighted)
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Per-customer collection rollup");
  const custHdr = sheet.addRow([
    "Customer #",
    "Customer",
    "YE Balance",
    "Collected",
    "Outstanding",
    "Coverage %",
    "In Existence Sample?",
  ]);
  styleTableHeader(custHdr);
  for (const cust of result.customerRollup) {
    const row = sheet.addRow([
      cust.custNum,
      cust.custName,
      cust.ye_balance,
      cust.collected,
      "",
      "",
      cust.inExistenceSample ? "Yes" : "No",
    ]);
    row.getCell(3).numFmt = USD_FMT;
    row.getCell(4).numFmt = USD_FMT;
    // Outstanding = YE Balance − Collected; Coverage % = Collected / YE.
    setFormula(
      row.getCell(5),
      `C${row.number}-D${row.number}`,
      cust.outstanding,
      USD_FMT,
    );
    setFormula(
      row.getCell(6),
      `IFERROR(D${row.number}/C${row.number},0)`,
      cust.coveragePct,
      PCT_FMT,
    );
    if (cust.inExistenceSample) {
      // Soft gold tint so sampled customers stand out — these are the
      // strongest Existence evidence rows.
      row.getCell(7).font = { bold: true };
      row.eachCell((cell) => {
        cell.fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8EFDC" },
        };
      });
    }
    if (Math.abs(cust.outstanding) > 0.01) {
      row.getCell(5).font = { bold: true };
    }
  }
  sheet.addRow([]);

  // -----------------------------------------------------------------------
  // Exceptions
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Exceptions");

  // Partial payments
  if (result.exceptions.partialPayments.length > 0) {
    const ppHdr = sheet.addRow([
      "Partial payments (remaining balance after receipts applied)",
    ]);
    ppHdr.font = { bold: true, color: { argb: NAVY } };
    sheet.mergeCells(ppHdr.number, 1, ppHdr.number, 7);
    const tHdr = sheet.addRow([
      "Invoice",
      "Customer",
      "Invoice $",
      "Received $",
      "Outstanding $",
      "Days to 1st Receipt",
      "Notes",
    ]);
    styleTableHeader(tHdr);
    for (const inv of result.exceptions.partialPayments) {
      const notes = inv.receipts.map((r) => r.notes).filter(Boolean).join(" · ");
      const row = sheet.addRow([
        inv.invoice.invoiceNum,
        inv.invoice.custName,
        inv.invoice.total,
        inv.amountReceived,
        inv.amountOutstanding,
        inv.daysToCollect ?? "",
        notes,
      ]);
      row.getCell(3).numFmt = USD_FMT;
      row.getCell(4).numFmt = USD_FMT;
      row.getCell(5).numFmt = USD_FMT;
      row.getCell(5).font = { bold: true, color: { argb: "FF8A2F2F" } };
      row.alignment = { vertical: "top", wrapText: true };
    }
    sheet.addRow([]);
  }

  // Unmatched receipts
  if (result.exceptions.unmatchedReceipts.length > 0) {
    const umHdr = sheet.addRow([
      "Unmatched receipts (receipt references an invoice NOT in the aging — investigate)",
    ]);
    umHdr.font = { bold: true, color: { argb: "FF8A2F2F" } };
    sheet.mergeCells(umHdr.number, 1, umHdr.number, 7);
    const tHdr = sheet.addRow([
      "Receipt #",
      "Customer",
      "Invoice (claimed)",
      "Receipt Date",
      "Amount $",
      "",
      "Notes",
    ]);
    styleTableHeader(tHdr);
    for (const m of result.exceptions.unmatchedReceipts) {
      const row = sheet.addRow([
        m.receipt.receiptNum,
        m.receipt.customerName,
        m.receipt.invoiceNum,
        m.receipt.receiptDate ?? "",
        m.receipt.amountReceived,
        "",
        m.receipt.notes,
      ]);
      row.getCell(5).numFmt = USD_FMT;
      row.alignment = { vertical: "top", wrapText: true };
    }
    sheet.addRow([]);
  }

  // Uncollected aged
  if (result.exceptions.uncollectedAged.length > 0) {
    const acHdr = sheet.addRow([
      "Aged YE invoices not collected post-YE (collectibility concern — evaluate allowance)",
    ]);
    acHdr.font = { bold: true, color: { argb: "FF8A2F2F" } };
    sheet.mergeCells(acHdr.number, 1, acHdr.number, 7);
    const tHdr = sheet.addRow([
      "Invoice",
      "Customer",
      "Invoice Date",
      "Invoice $",
      "Outstanding $",
      "Days Outstanding",
      "Notes",
    ]);
    styleTableHeader(tHdr);
    for (const inv of result.exceptions.uncollectedAged) {
      const row = sheet.addRow([
        inv.invoice.invoiceNum,
        inv.invoice.custName,
        inv.invoice.invoiceDate ?? "",
        inv.invoice.total,
        inv.amountOutstanding,
        inv.invoice.invoiceDate
          ? Math.max(0, daysBetweenIso(inv.invoice.invoiceDate, engagement.client.fiscalYearEnd))
          : "",
        inv.invoice.notes,
      ]);
      row.getCell(4).numFmt = USD_FMT;
      row.getCell(5).numFmt = USD_FMT;
      row.getCell(5).font = { bold: true, color: { argb: "FF8A2F2F" } };
      row.alignment = { vertical: "top", wrapText: true };
    }
    sheet.addRow([]);
  }

  if (
    result.exceptions.partialPayments.length === 0 &&
    result.exceptions.unmatchedReceipts.length === 0 &&
    result.exceptions.uncollectedAged.length === 0
  ) {
    const ok = sheet.addRow([
      "No exceptions identified — all receipts match invoices in the aging, all matched invoices fully collected, no aged YE invoices remain uncollected post-YE.",
    ]);
    ok.font = { italic: true, color: { argb: "FF1F6B33" } };
    sheet.mergeCells(ok.number, 1, ok.number, 7);
    sheet.addRow([]);
  }

  // -----------------------------------------------------------------------
  // Conclusion + sign-off
  // -----------------------------------------------------------------------
  sectionHeader(sheet, "Conclusion");
  const conc = sheet.addRow([buildScrConclusion(result)]);
  conc.alignment = { vertical: "top", wrapText: true };
  conc.height = 96;
  sheet.mergeCells(conc.number, 1, conc.number, 7);
  sheet.addRow([]);

  sectionHeader(sheet, "Sign-off");
  sheet.addRow(["Preparer", "", "Date", ""]);
  sheet.addRow(["Reviewer", "", "Date", ""]);
}

// First-pass SCR conclusion — narrates coverage %, collection speed,
// and the exception counts (partial payments, unmatched receipts,
// aged uncollected) with concrete numbers so the auditor can verify
// or revise.
function buildScrConclusion(
  result: import("@/lib/scr-testing").ScrTestResult,
): string {
  const fmt$ = (n: number) =>
    `$${Math.round(Math.abs(n)).toLocaleString("en-US")}`;
  const pct = (n: number) => `${(n * 100).toFixed(1)}%`;
  const cov = result.coverage;
  const exc = result.exceptions;
  const totalExc =
    exc.partialPayments.length +
    exc.unmatchedReceipts.length +
    exc.uncollectedAged.length;

  const speedClause =
    cov.daysToCollectMedian !== null
      ? ` Median days-to-collect ${cov.daysToCollectMedian}; ${pct(cov.pctCollectedWithin30)} of YE AR collected within 30 days and ${pct(cov.pctCollectedWithin60)} within 60.`
      : "";

  const exceptionClause =
    totalExc === 0
      ? " No exceptions identified — receipts traced cleanly to invoices, no aged YE invoices remained uncollected post-YE."
      : ` Exceptions: ${exc.partialPayments.length} partial payment(s), ${exc.unmatchedReceipts.length} unmatched receipt(s), and ${exc.uncollectedAged.length} aged YE invoice(s) still uncollected — review the tables above and document the allowance / cutoff implications.`;

  return (
    `First-pass conclusion (Existence + Valuation): ${fmt$(cov.totalCollected)} of ${fmt$(cov.yeArTotal)} ` +
    `YE AR (${pct(cov.coveragePct)}) was collected post-YE via ${cov.receiptCount} receipts.${speedClause}` +
    `${exceptionClause} ` +
    `Subject to auditor review and final conclusion.`
  );
}

function matchStatusLabel(status: import("@/lib/scr-testing").ScrMatchStatus): string {
  switch (status) {
    case "matched-full":
      return "Matched — full";
    case "matched-partial":
      return "Matched — partial";
    case "unmatched-receipt":
      return "Unmatched receipt";
    case "unmatched-invoice":
      return "No subsequent receipt";
    case "credit-memo":
      return "Credit memo";
  }
}

function daysBetweenIso(fromIso: string, toIso: string): number {
  const f = /^(\d{4})-(\d{2})-(\d{2})/.exec(fromIso);
  const t = /^(\d{4})-(\d{2})-(\d{2})/.exec(toIso);
  if (!f || !t) return 0;
  const from = new Date(Number(f[1]), Number(f[2]) - 1, Number(f[3]));
  const to = new Date(Number(t[1]), Number(t[2]) - 1, Number(t[3]));
  return Math.round((to.getTime() - from.getTime()) / 86_400_000);
}

function writeProcedureBlocks(
  sheet: ExcelJS.Worksheet,
  lib: ProcedureEntry,
) {
  sectionHeader(sheet, "Objective");
  addTextBlock(sheet, lib.objective);
  sectionHeader(sheet, "Procedure");
  addTextBlock(sheet, lib.procedure);
}

// ---------------------------------------------------------------------------
// Shared styling helpers (private to this module — keep workpaper-binder.ts
// untouched so its styling stays self-contained).
// ---------------------------------------------------------------------------

function sectionHeader(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text]);
  row.font = { bold: true, size: 12, color: { argb: NAVY } };
  row.getCell(1).fill = {
    type: "pattern",
    pattern: "solid",
    fgColor: { argb: CREAM },
  };
  sheet.mergeCells(row.number, 1, row.number, 7);
}

// Writes a label/value row. Long string values get merged across cols
// 2..totalCols so they can wrap on multiple lines without dragging the
// value column to their own length. Short values (numbers, account #s,
// brief labels) stay un-merged — they don't need the extra space and the
// merge would extend into unused columns.
//
// Returns the row so a subsequent addLabelFormula can reference its cell
// (e.g. `=B${cyRow.number}-B${pyRow.number}` for a $ Change calculation).
function addLabelValue(
  sheet: ExcelJS.Worksheet,
  label: string,
  value: number | string,
  numFmt?: string,
  totalCols: number = 6,
): ExcelJS.Row {
  const row = sheet.addRow([label, value]);
  row.getCell(1).font = { bold: true };
  // Left-align so numeric values (balances, percentages) sit next to their
  // label instead of drifting to the right edge of the merged range.
  row.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  if (numFmt) row.getCell(2).numFmt = numFmt;
  // ~40 chars is the threshold where a typical value column starts to look
  // cramped. Above that the autosize layer would otherwise pull the
  // column to ~70 wide for this one outlier row.
  if (typeof value === "string" && value.length > 40 && totalCols > 2) {
    sheet.mergeCells(row.number, 2, row.number, totalCols);
  }
  return row;
}

// Like addLabelValue, but the value cell is an Excel formula. The
// `result` is stored alongside the formula so apps that don't recompute
// on open (PDF previews, the verification UI, etc.) still see the value.
// Excel itself recomputes — so if the auditor edits a source balance,
// the dependent cells refresh.
function addLabelFormula(
  sheet: ExcelJS.Worksheet,
  label: string,
  formula: string,
  result: number,
  numFmt?: string,
): ExcelJS.Row {
  const row = sheet.addRow([label]);
  row.getCell(1).font = { bold: true };
  row.alignment = { vertical: "top", horizontal: "left", wrapText: true };
  row.getCell(2).value = { formula, result };
  if (numFmt) row.getCell(2).numFmt = numFmt;
  return row;
}

function addTextBlock(sheet: ExcelJS.Worksheet, text: string) {
  const row = sheet.addRow([text]);
  row.alignment = { vertical: "top", wrapText: true };
  sheet.mergeCells(row.number, 1, row.number, 7);
  // Height is left for the autofit pass to compute based on the merged
  // range's actual character capacity. Manual hints based on raw line
  // count over-estimate when the merge spans wide columns.
}

function styleTableHeader(row: ExcelJS.Row) {
  row.font = { bold: true, color: { argb: "FFFFFFFF" } };
  row.height = 22;
  row.alignment = { vertical: "middle" };
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: NAVY },
    };
  });
}

// Default assertions to use when the assertion matrix doesn't yield a row
// for an account. Keyed by FSLI label (must match FSLI_GROUPS in
// workpaper-binder.ts).
const DEFAULT_ASSERTIONS_BY_FSLI: Record<string, AssertionKey[]> = {
  "Accounts Receivable, net": [
    "Existence",
    "Completeness",
    "RightsAndObligations",
    "ValuationAndAllocation",
    "CutOff",
  ],
};
