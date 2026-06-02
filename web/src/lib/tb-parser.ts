import ExcelJS from "exceljs";

// Parsed trial balance. The shape is intentionally minimal — only the fields
// the assertion-matrix prompt actually needs. If we add tickmark/sample
// generation later we can extend this without breaking the prompt path.
export type TrialBalanceAccount = {
  acctNum: string;
  name: string;
  section: "Asset" | "Liability" | "Equity" | "Revenue" | "Expense";
  cyBalance: number;
  pyBalance: number;
  materialityScoping: string;
  pyExceptionNote: string;
};

export type TrialBalance = {
  clientName: string;
  accounts: TrialBalanceAccount[];
};

// Read an xlsx buffer (e.g. from Supabase Storage) and extract the TB.
// Tolerant of the Hartwell layout:
//   row 1: client banner (any text)
//   row 2: column headers (Acct # | Account Name | CY Balance | PY Balance | ...)
//   following rows: data, separated by section dividers ("── ASSETS ──",
//   "── LIABILITIES ──", "── EQUITY ──", "── INCOME STATEMENT ──") and
//   subtotal rows ("TOTAL …", "NET INCOME").
//
// Section is inferred from the most recent divider plus, for income statement
// rows, the acctNum prefix (4xxx → Revenue, anything else → Expense).
export async function parseTrialBalance(
  buffer: Buffer | ArrayBuffer,
): Promise<TrialBalance> {
  const wb = new ExcelJS.Workbook();
  // ExcelJS's `xlsx.load` typings conflict with Node 22's Buffer<ArrayBufferLike>
  // shape — at runtime it accepts any byte source. The any-cast is intentional;
  // the runtime contract is correct.
  const buf =
    buffer instanceof Buffer ? buffer : Buffer.from(new Uint8Array(buffer));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await wb.xlsx.load(buf as any);
  const sheet = wb.worksheets[0];
  if (!sheet) throw new Error("Trial balance has no worksheets");

  const clientName = readCellText(sheet, 1, 1) || "Unknown client";

  const accounts: TrialBalanceAccount[] = [];
  let section: TrialBalanceAccount["section"] | null = null;

  for (let r = 3; r <= sheet.rowCount; r++) {
    const acctNum = readCellText(sheet, r, 1).trim();
    const accountName = readCellText(sheet, r, 2).trim();

    if (!accountName) continue;

    if (isSectionDivider(accountName)) {
      section = sectionFromDivider(accountName);
      continue;
    }
    if (isTotalRow(accountName)) continue;
    if (!acctNum) continue;

    // Resolve the section. Preference: explicit divider above the row;
    // otherwise infer from the account-number prefix (1xxx Asset,
    // 2xxx Liability, 3xxx Equity, 4xxx Revenue, 5xxx/6xxx Expense).
    // Income-statement bucket dividers ("Income Statement" / "Revenue")
    // are refined by prefix because 4xxx vs 5xxx/6xxx split them.
    let effectiveSection: TrialBalanceAccount["section"] | null = section;
    if (section === null) {
      effectiveSection = inferSectionFromAcctNum(acctNum);
    } else if (section === "Revenue" || section === "Expense") {
      effectiveSection = acctNum.startsWith("4") ? "Revenue" : "Expense";
    }
    if (!effectiveSection) continue;

    const cyBalance = readCellNumber(sheet, r, 3);
    const pyBalance = readCellNumber(sheet, r, 4);
    const materialityScoping = readCellText(sheet, r, 7).trim();
    const pyExceptionNote = readCellText(sheet, r, 8).trim();

    accounts.push({
      acctNum,
      name: accountName,
      section: effectiveSection,
      cyBalance,
      pyBalance,
      materialityScoping,
      pyExceptionNote,
    });
  }

  return { clientName, accounts };
}

function readCellText(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
): string {
  const cell = sheet.getRow(row).getCell(col);
  const v = cell.value;
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (typeof v === "object" && v) {
    if ("text" in v && typeof (v as { text: unknown }).text === "string") {
      return (v as { text: string }).text;
    }
    if (
      "richText" in v &&
      Array.isArray((v as { richText: unknown[] }).richText)
    ) {
      return (v as { richText: { text: string }[] }).richText
        .map((rt) => rt.text)
        .join("");
    }
    if ("result" in v) return String((v as { result: unknown }).result ?? "");
    if ("formula" in v) return "";
  }
  return String(v);
}

function readCellNumber(
  sheet: ExcelJS.Worksheet,
  row: number,
  col: number,
): number {
  const cell = sheet.getRow(row).getCell(col);
  const v = cell.value;
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,$]/g, ""));
    return Number.isFinite(n) ? n : 0;
  }
  if (typeof v === "object" && v && "result" in v) {
    const r = (v as { result: unknown }).result;
    if (typeof r === "number") return r;
    if (typeof r === "string") {
      const n = Number(r.replace(/[,$]/g, ""));
      return Number.isFinite(n) ? n : 0;
    }
  }
  return 0;
}

function isSectionDivider(text: string): boolean {
  return /^──.+──$/.test(text.trim());
}

function sectionFromDivider(
  text: string,
): TrialBalanceAccount["section"] | null {
  const t = text.toUpperCase();
  if (t.includes("ASSET")) return "Asset";
  if (t.includes("LIABILIT")) return "Liability";
  if (t.includes("EQUITY")) return "Equity";
  if (t.includes("INCOME") || t.includes("REVENUE")) return "Revenue";
  return null;
}

function isTotalRow(text: string): boolean {
  return /^(TOTAL\b|NET\s+INCOME\b|GROSS\s+PROFIT\b)/i.test(text.trim());
}

// Fallback section inference when the trial balance lacks explicit
// section dividers (e.g. "── ASSETS ──" headers). Uses the first
// digit of the account number per standard chart-of-accounts
// conventions: 1=Asset, 2=Liability, 3=Equity, 4=Revenue, 5/6=Expense.
function inferSectionFromAcctNum(
  acctNum: string,
): TrialBalanceAccount["section"] | null {
  const first = acctNum.trim().charAt(0);
  if (first === "1") return "Asset";
  if (first === "2") return "Liability";
  if (first === "3") return "Equity";
  if (first === "4") return "Revenue";
  if (first === "5" || first === "6") return "Expense";
  return null;
}

// Render the TB as a compact text block to inject into the matrix prompt.
// Keep it readable so Claude can quote account names + balances directly in
// citations. Includes section subtotals so the model has the bigger picture.
export function trialBalanceToPromptText(tb: TrialBalance): string {
  const lines: string[] = [];
  lines.push(`Client: ${tb.clientName}`);
  lines.push("");
  lines.push("Columns: Acct # | Account | Section | CY Balance | PY Balance | Materiality Scoping | PY Exception Note");
  lines.push("");

  const grouped: Record<string, TrialBalanceAccount[]> = {};
  for (const a of tb.accounts) {
    (grouped[a.section] ??= []).push(a);
  }
  const order: TrialBalanceAccount["section"][] = [
    "Asset",
    "Liability",
    "Equity",
    "Revenue",
    "Expense",
  ];
  for (const s of order) {
    const rows = grouped[s];
    if (!rows || rows.length === 0) continue;
    const cyTotal = rows.reduce((acc, r) => acc + r.cyBalance, 0);
    const pyTotal = rows.reduce((acc, r) => acc + r.pyBalance, 0);
    lines.push(`## ${s.toUpperCase()}S  (CY total ${fmt(cyTotal)} · PY total ${fmt(pyTotal)})`);
    for (const a of rows) {
      lines.push(
        [
          a.acctNum,
          a.name,
          a.section,
          fmt(a.cyBalance),
          fmt(a.pyBalance),
          a.materialityScoping || "—",
          a.pyExceptionNote || "—",
        ].join(" | "),
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

function fmt(n: number): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}
