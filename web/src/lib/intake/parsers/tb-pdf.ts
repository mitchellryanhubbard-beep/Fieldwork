import { DEFAULT_CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";
import type {
  TrialBalance,
  TrialBalanceAccount,
} from "@/lib/tb-parser";

// Trial Balance PDF parser. Same pattern as ar-aging-pdf: Claude reads
// the PDF, returns structured JSON matching our canonical TB shape.
//
// MINIMAL EXTRACTION — by design. We pull only:
//   - acct #
//   - account name
//   - section / account type (Asset / Liability / Equity / Revenue / Expense)
//   - CY balance
//   - PY balance
//
// Anything else on the page (scoping notes, PY exception flags, auditor
// commentary, materiality decisions) is intentionally discarded. Per the
// scoping-principle memory: Fieldwork produces its own scoping — never
// take it from client-authored TB columns. Letting that data through
// contaminates Fieldwork's judgment.
//
// Section is required so the Revenue sum (used in DSO + analytics) ties.
// The prompt nudges Claude to infer it from acct-number prefix when no
// banner is present.

const SYSTEM_PROMPT =
  "You are an audit-grade trial-balance extractor. The user will provide a PDF of a client's trial balance. " +
  "Extract every account row. Be conservative — never invent accounts, balances, or names. " +
  "Do NOT extract section banners ('ASSETS', 'LIABILITIES', etc.), subtotal rows ('TOTAL ASSETS', 'NET INCOME', 'GROSS PROFIT'), or header rows. " +
  "Every account must have a section (Asset, Liability, Equity, Revenue, or Expense). " +
  "Infer section from the most recent banner; if there's no banner, infer from acctNum prefix: " +
  "1xxx → Asset, 2xxx → Liability, 3xxx → Equity, 4xxx → Revenue, 5xxx-9xxx → Expense. " +
  "Balances are USD numbers. Negative balances stay negative. Use 0 for blank/missing balances. " +
  "Extract ONLY the five fields in the schema — ignore any scoping notes, exception flags, " +
  "materiality columns, or auditor commentary on the page. Those are not useful to Fieldwork.";

const TB_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["clientName", "accounts"],
  properties: {
    clientName: {
      type: "string",
      description:
        "Client name as shown on the TB banner. If not shown, return an empty string — never invent.",
    },
    accounts: {
      type: "array",
      description: "One row per real account. No banners, no subtotals, no headers.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["acctNum", "name", "section", "cyBalance", "pyBalance"],
        properties: {
          acctNum: { type: "string", description: "Account number as shown." },
          name: { type: "string" },
          section: {
            type: "string",
            enum: ["Asset", "Liability", "Equity", "Revenue", "Expense"],
          },
          cyBalance: {
            type: "number",
            description:
              "Current-year balance in USD. Negative if the report shows it negative.",
          },
          pyBalance: {
            type: "number",
            description: "Prior-year balance in USD. 0 if not shown.",
          },
        },
      },
    },
  },
} as const;

// Minimal-extraction account shape — the five fields Claude returns. Maps
// into the canonical TrialBalanceAccount by zero-filling the deprecated
// materialityScoping + pyExceptionNote fields so downstream code that
// still references them doesn't break.
type ExtractedAccount = {
  acctNum: string;
  name: string;
  section: TrialBalanceAccount["section"];
  cyBalance: number;
  pyBalance: number;
};

export async function parseTrialBalancePdf(
  bytes: Buffer,
): Promise<TrialBalance> {
  const client = getClaudeClient();
  const base64Pdf = bytes.toString("base64");

  const response = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: 16_000,
    system: SYSTEM_PROMPT,
    messages: [
      {
        role: "user",
        content: [
          {
            type: "document",
            source: {
              type: "base64",
              media_type: "application/pdf",
              data: base64Pdf,
            },
          },
          {
            type: "text",
            text:
              "Extract every account from this trial balance and return it per the JSON schema. " +
              "Do not include banners or subtotals.",
          },
        ],
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: TB_JSON_SCHEMA,
      },
    },
  });

  const rawText = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { clientName: string; accounts: ExtractedAccount[] };
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(
      `Claude returned non-JSON output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Inflate the minimal extraction into the canonical TrialBalanceAccount
  // shape with empty strings for the deprecated TB-derived fields. These
  // fields are intentionally never sourced from PDFs — see the
  // scoping-principle memory.
  return {
    clientName: parsed.clientName || "Unknown client",
    accounts: parsed.accounts.map((a) => ({
      acctNum: a.acctNum,
      name: a.name,
      section: a.section,
      cyBalance: a.cyBalance,
      pyBalance: a.pyBalance,
      materialityScoping: "",
      pyExceptionNote: "",
    })),
  };
}
