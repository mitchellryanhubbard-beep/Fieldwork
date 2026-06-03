import type Anthropic from "@anthropic-ai/sdk";
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
import { PLANNING_QUESTIONNAIRE } from "@/lib/planning-questionnaire";

export type PyAuditAttachment = {
  bytes: Buffer;
  contentType: string;
  filename: string;
};

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
// Optional `pyAudit` attachment is rendered as a Claude document block so
// the signed PY opinion + financials are read in full each generation.
export function buildAssertionMatrixUserMessage(
  engagement: EngagementSetup,
  trialBalance?: TrialBalance,
  pyAudit?: PyAuditAttachment,
): Array<Anthropic.ContentBlockParam> {
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
  lines.push("");

  lines.push("## Planning & Risk Questionnaire");
  lines.push(
    "Auditor's CY planning answers — combines business changes, risk",
    "identification, and audit-approach signals. Treat each 'Yes' answer",
    "(plus the auditor's Describe text) as a CY risk anchor and cite it in",
    "the matching matrix row's citation. 'No' answers are informational",
    "only — they confirm no CY change in that area vs. PY.",
  );
  lines.push("");
  const answers = v.planningQuestionnaire;
  let anyYes = false;
  for (const group of PLANNING_QUESTIONNAIRE) {
    lines.push(`### ${group.title}`);
    for (const q of group.questions) {
      const a = answers[q.id];
      if (q.kind === "text") {
        const val = (a?.value ?? "").trim();
        lines.push(`- ${q.prompt}`);
        lines.push(`  ${val || "(no answer)"}`);
      } else {
        const val = (a?.value ?? "").toLowerCase();
        const desc = (a?.description ?? "").trim();
        const tag =
          val === "yes" ? "YES" : val === "no" ? "No" : "(not answered)";
        if (val === "yes") anyYes = true;
        lines.push(`- ${q.prompt} → ${tag}`);
        if (val === "yes" && desc) lines.push(`  Describe: ${desc}`);
      }
    }
    lines.push("");
  }
  if (!anyYes) {
    lines.push(
      "(No 'Yes' answers — treat as a low-change year and lean on PY",
      "audit findings + industry-standard risks rather than CY-specific",
      "anchors.)",
    );
    lines.push("");
  }

  lines.push("## Source Files");
  lines.push(`- PY Audit: ${v.pyAuditFile.originalFilename}`);
  lines.push(`- CY Trial Balance: ${v.cyTrialBalanceFile.originalFilename}`);
  lines.push("");

  if (trialBalance) {
    lines.push("## CY Trial Balance (PARSED — real account list + balances)");
    lines.push("");
    lines.push(trialBalanceToPromptText(trialBalance));
    lines.push("");
    lines.push(
      "Use the real account names and real CY + PY balances above. Derive",
      "materiality scoping yourself — an account is material when |CY balance|",
      "exceeds the engagement's performance materiality (see the Materiality",
      "block above), or when a specific engagement-level risk lifts it above",
      "its balance. PY exceptions come from the attached PY audit PDF below,",
      "not from the TB — never expect a scoping or exception column on the TB.",
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
  if (pyAudit && pyAudit.contentType === "application/pdf") {
    lines.push(
      "The PY Audit (signed opinion + issued financial statements) is",
      "attached as a PDF document below. READ IT IN FULL and use it to:",
      "  - Identify the prior-year opinion type and any emphasis-of-matter or",
      "    going-concern language; cite it when it shapes a CY assertion.",
      "  - Pull PY exceptions, misstatements, control deficiencies, or",
      "    significant deficiencies named in the opinion or footnotes, and",
      "    surface them in the matching account row's `pyExceptions`.",
      "  - Anchor account-specific risks (revenue recognition policy,",
      "    inventory costing method, related-party balances, contingencies,",
      "    subsequent events) in actual footnote language — not boilerplate.",
      "  - Cite the PY audit by section (e.g. 'PY opinion — Basis for",
      "    Qualified Opinion' or 'PY footnote 7 — Inventory') in the",
      "    `citation` field when a row is driven by the PY audit.",
    );
  } else {
    lines.push(
      "The PY Audit (signed opinion + issued financial statements) is",
      "uploaded but not parseable in this generation (missing or non-PDF).",
      "If you need PY exception detail beyond the TB's exception column,",
      "flag it in `notes`.",
    );
  }
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

  const blocks: Array<Anthropic.ContentBlockParam> = [];
  if (pyAudit && pyAudit.contentType === "application/pdf") {
    blocks.push({
      type: "document",
      source: {
        type: "base64",
        media_type: "application/pdf",
        data: pyAudit.bytes.toString("base64"),
      },
    });
  }
  blocks.push({ type: "text", text: lines.join("\n") });
  return blocks;
}
