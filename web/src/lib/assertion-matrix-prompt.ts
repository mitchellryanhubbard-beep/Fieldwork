import type { EngagementSetup } from "@/lib/engagement-schema";
import {
  ASSERTIONS,
  RISK_LEVELS,
  TESTING_APPROACHES,
} from "@/lib/assertion-matrix";
import {
  trialBalanceToPromptText,
  type TrialBalance,
} from "@/lib/tb-parser";

// System prompt — frozen across requests (so the credential server can
// cache the prefix later). Voice: senior auditor giving the staff their
// scoping memo. Heavy on "do" / "don't" rules because Claude follows
// instructions more literally on Opus 4.7.
export const ASSERTION_MATRIX_SYSTEM_PROMPT = [
  "You are a senior auditor at a mid-tier public-accounting firm.",
  "Your job is to produce a first-pass assertion-risk matrix for a staff auditor:",
  "for every significant account in the trial balance, identify the risks,",
  "relevant assertions, prior-year exceptions, and a planned testing approach.",
  "",
  "Hard rules — never violate:",
  "- Use only the engagement inputs the user supplies. Do not invent risks,",
  "  balances, or PY exceptions. If an input is missing, say so in `notes`",
  "  rather than guessing.",
  "- You are scoping the work, not concluding the audit. Never write language",
  "  like 'no material misstatement' or 'opinion'. Flag risks; leave conclusions",
  "  to the human.",
  "- Every row needs a citation tying it back to the engagement setup — risk",
  "  items, business changes, materiality figures, or PY exceptions by name.",
  "  Generic citations like 'professional skepticism' are not acceptable.",
  "- Use AICPA assertion vocabulary exactly: " + ASSERTIONS.join(", ") + ".",
  "- Risk levels are exactly: " + RISK_LEVELS.join(", ") + ". Do not default to",
  "  'Moderate' — anchor in the engagement's CY risk profile.",
  "- Planned approaches are exactly: " + TESTING_APPROACHES.join(", ") + ".",
  "  Pick 'Analytical' only when balance is predictable AND overall risk is Low.",
  "",
  "Style:",
  "- Be specific and auditor-actionable. 'Inventory exists' is generic;",
  "  'Existence at the Ohio plant post-ERP cutover (May 2024)' is actionable.",
  "- Aggregate related accounts into one row when the audit treats them as one",
  "  (e.g. 'Cash and Cash Equivalents'). Name the aggregation explicitly.",
  "- Pre-skewed expectations from the framework + industry are fair game;",
  "  e.g. manufacturers usually have material inventory + cost-of-sales risks.",
].join("\n");

// Per-engagement user message — concrete data, varies every call.
// Optional `trialBalance` argument injects the real account list + CY/PY
// balances + per-account materiality scoping into the prompt. When absent,
// the model is told to flag that it's working without the TB.
export function buildAssertionMatrixUserMessage(
  engagement: EngagementSetup,
  trialBalance?: TrialBalance,
): string {
  const v = engagement;
  const lines: string[] = [];

  lines.push(`# Engagement: ${v.client.name}`);
  lines.push(`Fiscal year end: ${v.client.fiscalYearEnd}`);
  if (v.client.reportingPeriodStart) {
    lines.push(`Reporting period start: ${v.client.reportingPeriodStart}`);
  }
  lines.push(`Framework: ${v.framework}`);
  lines.push(`Industry: ${v.industry}`);
  lines.push("");

  lines.push("## Materiality (USD)");
  lines.push(`- Overall: ${v.materiality.overallMateriality.toLocaleString()}`);
  lines.push(
    `- Performance: ${v.materiality.performanceMateriality.toLocaleString()}`,
  );
  lines.push(
    `- Clearly trivial: ${v.materiality.clearlyTrivialThreshold.toLocaleString()}`,
  );
  lines.push(`- Basis: ${v.materiality.basis}`);
  lines.push("");

  lines.push("## CY Risk Profile");
  if (v.cyRiskProfile.narrative) {
    lines.push(`Narrative: ${v.cyRiskProfile.narrative}`);
    lines.push("");
  }
  if (v.cyRiskProfile.items.length === 0) {
    lines.push("(No structured risk items supplied.)");
  } else {
    v.cyRiskProfile.items.forEach((item, i) => {
      lines.push(`Risk #${i + 1} [${item.category}]: ${item.description}`);
    });
  }
  lines.push("");

  lines.push("## CY Significant Business Changes");
  if (v.cyBusinessChanges.narrative) {
    lines.push(`Narrative: ${v.cyBusinessChanges.narrative}`);
    lines.push("");
  }
  if (v.cyBusinessChanges.items.length === 0) {
    lines.push("(No structured business changes supplied.)");
  } else {
    v.cyBusinessChanges.items.forEach((item, i) => {
      lines.push(
        `Change #${i + 1} [${item.category}]: ${item.description}`,
      );
    });
  }
  lines.push("");

  lines.push("## Source Files");
  lines.push(`- PY Audit: ${v.pyAuditFile.originalFilename}`);
  lines.push(`- CY Trial Balance: ${v.cyTrialBalanceFile.originalFilename}`);
  lines.push("");

  if (trialBalance) {
    lines.push("## CY Trial Balance (PARSED — use these real balances + scoping)");
    lines.push("");
    lines.push(trialBalanceToPromptText(trialBalance));
    lines.push("");
    lines.push(
      "Use the real account names, real CY + PY balances, and the per-account",
      "materiality scoping column verbatim from the TB above. The `Scoped In`",
      "/`Below PM` column reflects the engagement's performance materiality —",
      "treat `Scoped In` accounts as material. If a row has a 'YES — See Notes'",
      "PY exception flag, surface that in `pyExceptions` for the matching row.",
    );
  } else {
    lines.push(
      "Note: the trial balance is uploaded to Supabase Storage but was not",
      "parsed into this prompt. Produce the matrix from the Engagement Setup",
      "data above; return null for pyBalance and 0 for cyBalance, then call",
      "out the missing TB in the `notes` field.",
    );
  }
  lines.push("");
  lines.push(
    "The PY Audit (signed opinion + issued financial statements) is uploaded",
    "but not parsed here. If you need PY exception detail beyond the TB's",
    "exception column, flag it in `notes`.",
  );
  lines.push("");

  lines.push("## Task");
  lines.push(
    "Produce the assertion-risk matrix as JSON matching the supplied schema.",
    "One row per significant account. Anchor every row in the engagement",
    "inputs above and cite the specific risk/change/exception/TB line that",
    "drove it. When a TB row is scoped 'Below PM', either omit it from the",
    "matrix or include it only if a specific engagement-level risk lifts it",
    "above its balance.",
  );

  return lines.join("\n");
}
