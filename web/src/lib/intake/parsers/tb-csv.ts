import {
  buildHeaderIndex,
  cellNum,
  cellStr,
  parseCsv,
} from "@/lib/intake/parsers/csv-util";
import type { TrialBalance, TrialBalanceAccount } from "@/lib/tb-parser";

// Trial Balance CSV parser. Same alias-based header matching as the AR
// Aging path. Minimal extraction — acctNum, name, section, CY, PY — per
// the scoping-principle memory.
//
// Section inference: if the source has an explicit "Type" / "Section"
// column, use it. Otherwise infer from account-number prefix:
//   1xxx Asset · 2xxx Liability · 3xxx Equity · 4xxx Revenue · else Expense.

type Field =
  | "acctNum"
  | "name"
  | "section"
  | "cyBalance"
  | "pyBalance";

const ALIASES: Record<Field, string[]> = {
  acctNum: ["Acct #", "Account #", "Account Number", "Account No", "Acct No"],
  name: ["Account", "Account Name", "Description"],
  section: ["Section", "Type", "Account Type", "Category", "Class"],
  cyBalance: [
    "CY Balance",
    "Current Year",
    "Current Year ($)",
    "Current",
    "CY",
    "Ending Balance",
    "Balance",
  ],
  pyBalance: ["PY Balance", "Prior Year", "Prior Year ($)", "PY", "Previous Year"],
};

const REQUIRED: Field[] = ["acctNum", "name", "cyBalance"];

const SECTION_VALUES = new Map<string, TrialBalanceAccount["section"]>([
  ["asset", "Asset"],
  ["assets", "Asset"],
  ["liability", "Liability"],
  ["liabilities", "Liability"],
  ["equity", "Equity"],
  ["revenue", "Revenue"],
  ["income", "Revenue"],
  ["expense", "Expense"],
  ["expenses", "Expense"],
]);

export async function parseTrialBalanceCsv(
  bytes: Buffer,
): Promise<TrialBalance> {
  const text = bytes.toString("utf8");
  const rows = parseCsv(text);
  if (rows.length === 0) throw new Error("CSV is empty");

  // Try to pick up the client name from a leading banner row, but don't
  // require it.
  const clientName = rows[0]?.find((c) => c.trim().length > 0)?.trim() ?? "Unknown client";

  let headerRowIdx = -1;
  let index: Record<Field, number | undefined> | null = null;
  for (let r = 0; r < Math.min(rows.length, 20); r++) {
    const candidate = buildHeaderIndex(rows[r], ALIASES);
    if (REQUIRED.every((f) => candidate[f] !== undefined)) {
      headerRowIdx = r;
      index = candidate;
      break;
    }
  }
  if (headerRowIdx === -1 || !index) {
    throw new Error(
      "Could not detect headers — at minimum 'Account #', 'Account', and 'CY Balance' must be present. Use manual mapping if your file uses different column names.",
    );
  }

  const accounts: TrialBalanceAccount[] = [];
  let lastSection: TrialBalanceAccount["section"] | null = null;
  for (let r = headerRowIdx + 1; r < rows.length; r++) {
    const row = rows[r];
    const acctNum = cellStr(row, index.acctNum);
    const name = cellStr(row, index.name);
    if (!acctNum && !name) continue;
    if (
      /^(total|subtotal|net income|gross profit)\b/i.test(acctNum) ||
      /^(total|subtotal|net income|gross profit)\b/i.test(name)
    ) {
      continue;
    }

    // Section divider rows like "── ASSETS ──" (text-only). Capture as
    // the running section and skip.
    if (!acctNum && /asset|liabilit|equity|revenue|income|expense/i.test(name)) {
      lastSection = inferSectionFromText(name) ?? lastSection;
      continue;
    }

    const explicitSection = cellStr(row, index.section);
    const section =
      SECTION_VALUES.get(explicitSection.toLowerCase()) ??
      lastSection ??
      inferSectionFromAcctNum(acctNum);

    accounts.push({
      acctNum,
      name,
      section,
      cyBalance: cellNum(row, index.cyBalance),
      pyBalance: cellNum(row, index.pyBalance),
      materialityScoping: "",
      pyExceptionNote: "",
    });
  }

  if (accounts.length === 0) {
    throw new Error(
      "No account rows detected in the CSV — every row was filtered as a subtotal or banner.",
    );
  }

  return { clientName, accounts };
}

function inferSectionFromText(s: string): TrialBalanceAccount["section"] | null {
  const t = s.toLowerCase();
  if (t.includes("asset")) return "Asset";
  if (t.includes("liabilit")) return "Liability";
  if (t.includes("equity")) return "Equity";
  if (t.includes("revenue") || t.includes("income")) return "Revenue";
  if (t.includes("expense")) return "Expense";
  return null;
}

function inferSectionFromAcctNum(
  acctNum: string,
): TrialBalanceAccount["section"] {
  if (/^1/.test(acctNum)) return "Asset";
  if (/^2/.test(acctNum)) return "Liability";
  if (/^3/.test(acctNum)) return "Equity";
  if (/^4/.test(acctNum)) return "Revenue";
  return "Expense";
}
