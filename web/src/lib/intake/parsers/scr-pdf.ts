import { DEFAULT_CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";
import type {
  ScrReceipt,
  SubsequentCashReceipts,
} from "@/lib/scr-parser";

// Subsequent Cash Receipts PDF parser. Same pattern as ar-aging-pdf and
// tb-pdf: Claude reads the PDF and returns JSON matching the canonical
// shape. Bank statements, accounting-system print outs, and custom
// auditor-prepared SCR PDFs all route through here.

const SYSTEM_PROMPT =
  "You are an audit-grade subsequent-cash-receipts extractor. The user will provide a PDF showing cash receipts " +
  "the client collected after the balance-sheet date and applied against pre-period invoices. " +
  "Extract every receipt row. " +
  "Do NOT extract banner rows, column headers, subtotal rows ('TOTAL APPLIED', 'GRAND TOTAL'), or auditor commentary at the bottom. " +
  "Each row represents one cash receipt applied to one specific pre-period invoice. " +
  "When a single receipt was applied across multiple invoices, the source typically lists each application as its own row — extract each. " +
  "Be conservative — never invent receipts, customers, amounts, or dates. " +
  "Negative amounts (credit memos applied as offsets) stay negative. " +
  "Dates should be normalized to YYYY-MM-DD. Use empty string for missing date cells, 0 for missing amounts, false for missing 'applied in full' flags.";

const SCR_JSON_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["periodLabel", "receipts"],
  properties: {
    periodLabel: {
      type: ["string", "null"],
      description:
        "The period the receipts cover (e.g. 'January 1-31, 2025'). Pull from the PDF banner if shown. Null if not stated.",
    },
    receipts: {
      type: "array",
      description:
        "One row per receipt-to-invoice application. No subtotal rows, no banners, no auditor notes.",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "receiptNum",
          "customerName",
          "invoiceNum",
          "invoiceDate",
          "invoiceAmount",
          "receiptDate",
          "amountReceived",
          "appliedInFull",
          "remainingBalance",
          "notes",
        ],
        properties: {
          receiptNum: {
            type: "string",
            description:
              "Receipt / transaction number as shown on the source.",
          },
          customerName: { type: "string" },
          invoiceNum: {
            type: "string",
            description: "The pre-period invoice this receipt was applied against.",
          },
          invoiceDate: {
            type: ["string", "null"],
            description: "YYYY-MM-DD or null if not shown.",
          },
          invoiceAmount: {
            type: "number",
            description: "Original invoice total. 0 if not shown.",
          },
          receiptDate: {
            type: ["string", "null"],
            description:
              "Date the receipt cleared, YYYY-MM-DD. Null if not shown.",
          },
          amountReceived: {
            type: "number",
            description:
              "Amount of this specific receipt applied to this invoice. Negative for credit memos.",
          },
          appliedInFull: {
            type: "boolean",
            description:
              "True if the receipt cleared the invoice in full. False for partial payments.",
          },
          remainingBalance: {
            type: "number",
            description:
              "Outstanding balance on the invoice after this receipt. 0 if fully paid.",
          },
          notes: {
            type: "string",
            description:
              "Any auditor-relevant notes shown on the row (e.g., 'partial payment — $X still outstanding'). Empty string if none.",
          },
        },
      },
    },
  },
} as const;

export async function parseSubsequentCashReceiptsPdf(
  bytes: Buffer,
): Promise<SubsequentCashReceipts> {
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
              "Extract every receipt-to-invoice application from this PDF per the JSON schema. " +
              "Include the period label if it appears on the banner.",
          },
        ],
      },
    ],
    output_config: {
      format: {
        type: "json_schema",
        schema: SCR_JSON_SCHEMA,
      },
    },
  });

  const rawText = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsed: { periodLabel: string | null; receipts: ScrReceipt[] };
  try {
    parsed = JSON.parse(rawText);
  } catch (err) {
    throw new Error(
      `Claude returned non-JSON output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  // Total is derived from the receipts so it always ties to the rows the
  // PDF actually contained — never trust a model-extracted total over the
  // sum of its parts.
  const totalReceived = parsed.receipts.reduce(
    (acc, r) => acc + r.amountReceived,
    0,
  );

  return {
    periodLabel: parsed.periodLabel,
    receipts: parsed.receipts,
    totalReceived,
  };
}
