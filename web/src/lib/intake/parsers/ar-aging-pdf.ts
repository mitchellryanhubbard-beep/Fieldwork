import { DEFAULT_CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";
import type {
  ArAging,
  ArCustomer,
  ArInvoice,
} from "@/lib/ar-aging-parser";

// AR Aging PDF parser. Uses Claude with native PDF input to extract a
// structured aging from any PDF layout — QuickBooks/Sage/NetSuite exports,
// scanned reports, custom firm formats. Returns the canonical `ArAging`
// shape so downstream tests don't care that the source was a PDF.
//
// We only ask Claude for the invoice-level rows; customer rollups and the
// grand total are computed by `rollUp()` below so they always tie to the
// invoice detail (no model drift between subtotals).

const SYSTEM_PROMPT =
  "You are an audit-grade AR aging extractor. The user will provide a PDF of a client's accounts-receivable " +
  "aging report. Extract every open invoice listed in the report. " +
  "Be conservative — never invent invoices, customers, dates, or amounts. " +
  "If a column isn't present (e.g. terms, sales rep), return an empty string. " +
  "If a date isn't in ISO format, normalize it to YYYY-MM-DD. " +
  "Aging bucket amounts must sum to the invoice total; if the source PDF has rounding, prefer the invoice total. " +
  "Customer subtotal rows, banner rows, and confidentiality notes are NOT invoices — skip them. " +
  "TB account references / tie-out lines (e.g. 'TB account 1200', 'Per general ledger') are also NOT customers — " +
  "the tell is that they carry a total with NO dollars in any aged bucket (current, 1-30, 31-60, 61-90, 90+). " +
  "A real customer's balance is always distributed across at least one aging bucket; if every bucket is zero, skip the row.";

const AGING_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["asOfDate", "invoices"],
  properties: {
    asOfDate: {
      type: ["string", "null"],
      description:
        "The 'as of' date shown on the report, normalized to YYYY-MM-DD. Null if not stated.",
    },
    invoices: {
      type: "array",
      description:
        "One row per open invoice in the aging. Do not include customer subtotal rows, banners, or notes.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "custNum",
          "custName",
          "invoiceNum",
          "invoiceDate",
          "dueDate",
          "terms",
          "salesRep",
          "total",
          "current",
          "d1_30",
          "d31_60",
          "d61_90",
          "d90_plus",
          "credits",
          "notes",
        ],
        properties: {
          custNum: {
            type: "string",
            description:
              "Customer number/ID as shown on the report. If the report only shows customer name, use a stable normalized form of the name (e.g. 'midwest-fabricators').",
          },
          custName: { type: "string" },
          invoiceNum: { type: "string" },
          invoiceDate: {
            type: ["string", "null"],
            description: "YYYY-MM-DD or null if not present.",
          },
          dueDate: {
            type: ["string", "null"],
            description: "YYYY-MM-DD or null if not present.",
          },
          terms: { type: "string", description: "Payment terms (e.g. 'Net 30'). Empty string if not shown." },
          salesRep: { type: "string", description: "Empty string if not shown." },
          total: {
            type: "number",
            description: "Invoice total in USD. Credit memos are negative.",
          },
          current: { type: "number" },
          d1_30: { type: "number", description: "1-30 days past due, in USD." },
          d31_60: { type: "number" },
          d61_90: { type: "number" },
          d90_plus: { type: "number", description: "90+ days past due, in USD." },
          credits: {
            type: "number",
            description: "Unapplied credit amount, if shown as a separate bucket. 0 if not.",
          },
          notes: {
            type: "string",
            description: "Any auditor-relevant note attached to the row. Empty string if none.",
          },
        },
      },
    },
  },
} as const;

export async function parseArAgingPdf(bytes: Buffer): Promise<ArAging> {
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
              "Extract every open invoice from this AR aging PDF and return it in the JSON schema. " +
              "Include the as-of date if it appears anywhere on the report.",
          },
        ],
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: AGING_JSON_SCHEMA,
      },
    },
  });

  const rawText = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(
      `Claude returned non-JSON output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  return rollUp(parsed as { asOfDate: string | null; invoices: ArInvoice[] });
}

function rollUp(extracted: {
  asOfDate: string | null;
  invoices: ArInvoice[];
}): ArAging {
  // Drop any row that came back with a total but no aged-bucket
  // breakdown — these are typically TB tie-out / reconciliation lines
  // (e.g. "TB account 1200") that don't represent a real customer.
  // Claude tries to skip them via the prompt, but a defense-in-depth
  // filter here catches what slips through.
  const filtered = extracted.invoices.filter((inv) => {
    const bucketSum =
      Math.abs(inv.current) +
      Math.abs(inv.d1_30) +
      Math.abs(inv.d31_60) +
      Math.abs(inv.d61_90) +
      Math.abs(inv.d90_plus);
    return bucketSum > 0;
  });
  extracted = { ...extracted, invoices: filtered };
  const byNum = new Map<string, ArCustomer>();
  for (const inv of extracted.invoices) {
    const existing = byNum.get(inv.custNum);
    if (existing) {
      existing.total += inv.total;
      existing.current += inv.current;
      existing.d1_30 += inv.d1_30;
      existing.d31_60 += inv.d31_60;
      existing.d61_90 += inv.d61_90;
      existing.d90_plus += inv.d90_plus;
      existing.credits += inv.credits;
      existing.invoiceCount += 1;
    } else {
      byNum.set(inv.custNum, {
        custNum: inv.custNum,
        custName: inv.custName,
        total: inv.total,
        current: inv.current,
        d1_30: inv.d1_30,
        d31_60: inv.d31_60,
        d61_90: inv.d61_90,
        d90_plus: inv.d90_plus,
        credits: inv.credits,
        invoiceCount: 1,
      });
    }
  }
  const customers = Array.from(byNum.values()).sort(
    (a, b) => Math.abs(b.total) - Math.abs(a.total),
  );
  const total = extracted.invoices.reduce((acc, inv) => acc + inv.total, 0);
  return {
    asOfDate: extracted.asOfDate,
    customers,
    invoices: extracted.invoices,
    total,
  };
}
