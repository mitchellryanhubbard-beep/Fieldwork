import ExcelJS from "exceljs";
import { DEFAULT_CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import {
  setPyWorkpaperFsli,
  type PyWorkpaper,
} from "@/lib/py-workpaper-repo";

// The fixed FSLI list Claude classifies against — matches the FSLI_GROUPS
// in workpaper-binder.ts so downstream "Generate CY" can wire the right
// lead-sheet context. "Other" is the catchall when nothing fits (e.g. a
// firm-wide planning memo or independence confirmation).
const FSLI_VALUES = [
  "Cash and Cash Equivalents",
  "Accounts Receivable, net",
  "Inventory",
  "Prepaid Expenses",
  "Property, Plant & Equipment, net",
  "Other Assets",
  "Accounts Payable",
  "Accrued Liabilities",
  "Debt and Credit Facilities",
  "Other Liabilities",
  "Equity",
  "Revenue",
  "Cost of Goods Sold",
  "Operating Expenses",
  "Other",
] as const;

const SYSTEM_PROMPT =
  "You are an audit-workpaper classifier. The user provides a summary of a prior-year audit workpaper (filename, sheet names, and sample text cells). " +
  "Return the financial-statement line item (FSLI) the workpaper covers. " +
  "Pick the SINGLE best fit from the enum. " +
  "Use 'Other' only when the workpaper is firm-wide (e.g., planning memo, independence confirmation, engagement letter) or genuinely doesn't fit any FSLI. " +
  "Filename is the strongest signal: 'PBC_AR_...' → Accounts Receivable; 'WP_AP_...' → Accounts Payable; etc. " +
  "Sheet names + text content confirm or override the filename hint.";

const FSLI_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["fsli"],
  properties: {
    fsli: {
      type: "string",
      enum: [...FSLI_VALUES],
      description: "The FSLI this workpaper covers.",
    },
    rationale: {
      type: "string",
      description:
        "One short sentence justifying the pick — for audit-trail debugging.",
    },
  },
} as const;

export async function tagPyWorkpaper(wp: PyWorkpaper): Promise<string> {
  // Filename is the strongest signal — short-circuit Claude when the
  // file follows a standard naming convention (e.g. WP_AR_03_*). This
  // avoids mis-classifications where Claude sees "Aging" in a DSO/AR
  // analytics file and confuses it with AP aging.
  const fromFilename = fsliFromFilename(wp.originalFilename);
  if (fromFilename) {
    await setPyWorkpaperFsli(wp.id, fromFilename);
    return fromFilename;
  }

  const sb = getServerSupabase();
  const dl = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(wp.storagePath);
  if (dl.error || !dl.data) {
    throw new Error(
      `tagPyWorkpaper: storage download failed: ${dl.error?.message ?? "no data"}`,
    );
  }

  const summary = await summarizeWorkbook(
    Buffer.from(await dl.data.arrayBuffer()),
    wp.originalFilename,
  );

  const client = getClaudeClient();
  const response = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: 1_000,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: summary }],
    output_config: {
      format: { type: "json_schema", schema: FSLI_SCHEMA },
    },
  });

  const raw = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");
  const parsed = JSON.parse(raw) as { fsli: string; rationale?: string };
  if (!(FSLI_VALUES as readonly string[]).includes(parsed.fsli)) {
    throw new Error(`Claude returned non-enum FSLI: ${parsed.fsli}`);
  }
  await setPyWorkpaperFsli(wp.id, parsed.fsli);
  return parsed.fsli;
}

// Maps a workpaper filename to an FSLI when it uses a standard prefix
// (WP_AR_, PBC_AR_, AR-, etc.). Returns null when the filename gives
// no clear hint — the caller then falls back to Claude classification.
export function fsliFromFilename(name: string): string | null {
  const stem = name
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[\s_\-]+/g, "_")
    .toUpperCase();
  // Tokenize on underscore so we match prefix codes (AR, AP, INV, …)
  // as standalone tokens — avoids "PARTIAL" matching as AP.
  const tokens = stem.split("_").filter(Boolean);
  // Build a tester that returns true when one of the codes appears as a
  // standalone token. Ordered most-specific-first.
  const has = (codes: string[]) => tokens.some((t) => codes.includes(t));

  if (has(["AR", "PBCAR"])) return "Accounts Receivable, net";
  if (has(["AP", "PBCAP"])) return "Accounts Payable";
  if (has(["CASH", "BANK"])) return "Cash and Cash Equivalents";
  if (has(["INV", "INVENTORY"])) return "Inventory";
  if (has(["PPE", "FA", "FIXED"])) return "Property, Plant & Equipment, net";
  if (has(["PREPAID", "PPD"])) return "Prepaid Expenses";
  if (has(["ACCRUED", "ACL"])) return "Accrued Liabilities";
  if (has(["DEBT", "LOAN", "NOTE", "NOTES"])) return "Debt and Credit Facilities";
  if (has(["EQUITY", "EQ"])) return "Equity";
  if (has(["REV", "REVENUE", "SALES"])) return "Revenue";
  if (has(["COGS"])) return "Cost of Goods Sold";
  if (has(["OPEX", "OE"])) return "Operating Expenses";
  return null;
}

// Build a compact text summary Claude can classify quickly. We include the
// filename, every sheet name, and the first ~25 non-empty cell values per
// sheet (capped). This is enough signal for FSLI classification without
// blowing tokens on data rows.
async function summarizeWorkbook(
  bytes: Buffer,
  originalFilename: string,
): Promise<string> {
  const wb = new ExcelJS.Workbook();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(bytes as any);
  const lines: string[] = [];
  lines.push(`Filename: ${originalFilename}`);
  lines.push(`Sheets: ${wb.worksheets.map((s) => s.name).join(" / ")}`);
  for (const sheet of wb.worksheets) {
    lines.push("");
    lines.push(`## Sheet: ${sheet.name}`);
    const cells: string[] = [];
    const maxRows = Math.min(sheet.rowCount, 60);
    outer: for (let r = 1; r <= maxRows; r++) {
      for (let c = 1; c <= Math.min(sheet.columnCount, 10); c++) {
        const v = sheet.getRow(r).getCell(c).value;
        const text = cellText(v);
        if (text.length > 0 && text.length < 200) {
          cells.push(text);
          if (cells.length >= 25) break outer;
        }
      }
    }
    lines.push(cells.join(" | "));
  }
  return lines.join("\n");
}

function cellText(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v.trim();
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object") {
    if ("text" in v && typeof (v as { text: unknown }).text === "string") {
      return ((v as { text: string }).text ?? "").trim();
    }
    if (
      "richText" in v &&
      Array.isArray((v as { richText: unknown[] }).richText)
    ) {
      return (v as { richText: { text: string }[] }).richText
        .map((rt) => rt.text)
        .join("")
        .trim();
    }
    if ("result" in v) {
      const r = (v as { result: unknown }).result;
      if (typeof r === "string" || typeof r === "number") return String(r);
    }
  }
  return "";
}
