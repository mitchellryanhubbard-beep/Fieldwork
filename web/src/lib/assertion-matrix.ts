import { z } from "zod";

// Output schema for the assertion-risk matrix returned by Claude.
// One row per significant account; every field required so downstream Excel
// rendering doesn't need optional-handling branches.
//
// Stays alongside the engagement schema (specs/engagement-setup.schema.json)
// but lives in code only — this is the seam between the credential server and
// the Office.js add-in. If we ever expose the matrix as a downloadable
// artifact, promote this to specs/.

export const RISK_LEVELS = ["Low", "Moderate", "High"] as const;

export const ASSERTIONS = [
  "Existence",
  "Completeness",
  "Accuracy",
  "ValuationAndAllocation",
  "RightsAndObligations",
  "ClassificationAndUnderstandability",
  "CutOff",
  "Occurrence",
  "Presentation",
] as const;

// Display labels for AICPA assertion vocabulary. Enum stays PascalCase
// (compact, JSON-friendly); humans see spaced form in workpapers + UI.
export const ASSERTION_LABELS: Record<(typeof ASSERTIONS)[number], string> = {
  Existence: "Existence",
  Completeness: "Completeness",
  Accuracy: "Accuracy",
  ValuationAndAllocation: "Valuation and Allocation",
  RightsAndObligations: "Rights and Obligations",
  ClassificationAndUnderstandability: "Classification and Understandability",
  CutOff: "Cut-Off",
  Occurrence: "Occurrence",
  Presentation: "Presentation",
};

export const TESTING_APPROACHES = [
  "SubstantiveDetail",
  "Analytical",
  "TestOfControls",
  "Mixed",
] as const;

export const TESTING_APPROACH_LABELS: Record<
  (typeof TESTING_APPROACHES)[number],
  string
> = {
  SubstantiveDetail: "Substantive Detail",
  Analytical: "Analytical",
  TestOfControls: "Test of Controls",
  Mixed: "Mixed",
};

export const ACCOUNT_TYPES = [
  "Asset",
  "Liability",
  "Equity",
  "Revenue",
  "Expense",
] as const;

export const AssertionMatrixRowSchema = z
  .object({
    account: z.string().min(1).max(200),
    accountType: z.enum(ACCOUNT_TYPES),
    cyBalance: z.number(),
    pyBalance: z.number().nullable(),
    materialAccount: z.boolean(),
    risks: z.array(z.string().min(1).max(500)).min(0).max(10),
    relevantAssertions: z.array(z.enum(ASSERTIONS)).min(1).max(9),
    overallRiskLevel: z.enum(RISK_LEVELS),
    pyExceptions: z.array(z.string().min(1).max(500)).min(0).max(10),
    plannedApproach: z.enum(TESTING_APPROACHES),
    approachRationale: z.string().min(1).max(1000),
    citation: z.string().min(1).max(500),
  })
  .strict();

export type AssertionMatrixRow = z.infer<typeof AssertionMatrixRowSchema>;

export const AssertionMatrixSchema = z
  .object({
    engagementId: z.string().uuid(),
    generatedAt: z.string().datetime({ offset: true }),
    modelVersion: z.string().min(1),
    rows: z.array(AssertionMatrixRowSchema).min(1).max(500),
    notes: z.string().max(4000).optional(),
  })
  .strict();

export type AssertionMatrix = z.infer<typeof AssertionMatrixSchema>;

// JSON Schema for Claude's structured-output `output_config.format`.
// Hand-written rather than zod-derived to give Claude clearer field
// descriptions — those significantly improve output quality.
//
// Constraints intentionally minimal: structured outputs do not support
// `minItems` / `maxItems` / `minLength` / `maxLength` / numerical bounds.
// The post-call zod schema (AssertionMatrixSchema) enforces those limits
// after we receive the response.
export const ASSERTION_MATRIX_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["rows"],
  properties: {
    rows: {
      type: "array",
      description:
        "One row per significant financial-statement account. Cover every account in the trial balance that is individually material OR that aggregates with related accounts to a material balance. Aim for 8-30 rows on a typical mid-market private audit. Include zero-balance accounts only if they represent a real risk (e.g. dormant accounts with prior misuse).",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "account",
          "accountType",
          "cyBalance",
          "pyBalance",
          "materialAccount",
          "risks",
          "relevantAssertions",
          "overallRiskLevel",
          "pyExceptions",
          "plannedApproach",
          "approachRationale",
          "citation",
        ],
        properties: {
          account: {
            type: "string",
            description:
              "Account name as it appears in the trial balance, or a clear grouping name if you aggregated related accounts (e.g. 'Cash and Cash Equivalents').",
          },
          accountType: {
            type: "string",
            enum: [...ACCOUNT_TYPES],
            description:
              "Statement category. If unclear, default to the more conservative classification.",
          },
          cyBalance: {
            type: "number",
            description:
              "Current-year balance in USD. Use the absolute value the auditor sees on the TB (positive for both assets and liabilities; do not flip signs). If you aggregated multiple accounts, sum them.",
          },
          pyBalance: {
            type: ["number", "null"],
            description:
              "Prior-year balance in USD if available from the PY Audit. Null if not stated.",
          },
          materialAccount: {
            type: "boolean",
            description:
              "True if the account exceeds the engagement's performance materiality (individually or in aggregate). Use the engagement's stated PM.",
          },
          risks: {
            type: "array",
            description:
              "Specific risk statements for this account, drawn from the engagement's risk profile and business changes. Each risk should be auditor-actionable, not generic. Keep to 0-10 items.",
            items: { type: "string" },
          },
          relevantAssertions: {
            type: "array",
            description:
              "Assertions in scope for this account given its risks. Use AICPA assertion vocabulary. At least one required.",
            items: { type: "string", enum: [...ASSERTIONS] },
          },
          overallRiskLevel: {
            type: "string",
            enum: [...RISK_LEVELS],
            description:
              "Combined inherent + control risk assessment. Anchor in the engagement's CY risk profile and business changes — do not default to Moderate.",
          },
          pyExceptions: {
            type: "array",
            description:
              "Exceptions or findings from the PY audit that affect this account. Empty array if none were noted. Keep to 0-10 items.",
            items: { type: "string" },
          },
          plannedApproach: {
            type: "string",
            enum: [...TESTING_APPROACHES],
            description:
              "Substantive testing strategy. Pick Analytical only when balance is predictable AND risk is low. Use Mixed for accounts that need both detail tests + analytics.",
          },
          approachRationale: {
            type: "string",
            description:
              "One- or two-sentence rationale tying the planned approach to the assessed risks. Auditors will read this — make it specific.",
          },
          citation: {
            type: "string",
            description:
              "Citation back to the Engagement Setup inputs that drove this row. Reference specific risk items, business changes, or materiality figures by name. Example: 'Risk #1 (commodity input price volatility) + Business Change #1 (ERP cutover, May 2024)'.",
          },
        },
      },
    },
    notes: {
      type: "string",
      description:
        "Optional engagement-level notes — things you flagged across multiple accounts, gaps in the engagement setup that limited your matrix, or assumptions you made.",
    },
  },
} as const;
