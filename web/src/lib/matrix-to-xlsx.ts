import ExcelJS from "exceljs";
import {
  ASSERTION_LABELS,
  TESTING_APPROACH_LABELS,
  type AssertionMatrix,
} from "@/lib/assertion-matrix";

// Render an AssertionMatrix as a workbook buffer ready to write or stream.
// Layout: one sheet ("Assertion Plan") with a real Excel Table; second sheet
// ("Engagement Notes") with the model's caveats. The Table carries a named
// range ("FirstPassAssertionPlan") so downstream workpaper generation (M3)
// can reference it without scanning cells.
export async function matrixToXlsx(matrix: AssertionMatrix): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = "First-Pass";
  wb.created = new Date(matrix.generatedAt);

  const sheet = wb.addWorksheet("Assertion Plan", {
    views: [{ state: "frozen", ySplit: 1 }],
  });

  const columns: Array<{
    header: string;
    key: keyof MatrixRowFlat;
    width: number;
  }> = [
    { header: "#", key: "rowNum", width: 4 },
    { header: "Account", key: "account", width: 38 },
    { header: "Type", key: "accountType", width: 10 },
    { header: "CY Balance", key: "cyBalance", width: 16 },
    { header: "PY Balance", key: "pyBalance", width: 16 },
    { header: "Material?", key: "materialAccount", width: 10 },
    { header: "Overall Risk", key: "overallRiskLevel", width: 12 },
    { header: "Assertions", key: "relevantAssertions", width: 36 },
    { header: "Risks", key: "risks", width: 60 },
    { header: "PY Exceptions", key: "pyExceptions", width: 36 },
    { header: "Planned Approach", key: "plannedApproach", width: 18 },
    { header: "Rationale", key: "approachRationale", width: 60 },
    { header: "Citation", key: "citation", width: 50 },
  ];

  sheet.columns = columns.map((c) => ({
    header: c.header,
    key: c.key,
    width: c.width,
  }));

  const rows = matrix.rows.map(
    (r, i): MatrixRowFlat => ({
      rowNum: i + 1,
      account: r.account,
      accountType: r.accountType,
      cyBalance: r.cyBalance,
      pyBalance: r.pyBalance ?? "",
      materialAccount: r.materialAccount ? "Yes" : "No",
      overallRiskLevel: r.overallRiskLevel,
      relevantAssertions: r.relevantAssertions
        .map((a) => ASSERTION_LABELS[a])
        .join(", "),
      risks: r.risks.join("\n"),
      pyExceptions: r.pyExceptions.join("\n"),
      plannedApproach: TESTING_APPROACH_LABELS[r.plannedApproach],
      approachRationale: r.approachRationale,
      citation: r.citation,
    }),
  );

  sheet.addRows(rows);

  // Make it a real Excel Table so auditors can sort/filter natively.
  sheet.addTable({
    name: "FirstPassAssertionPlan",
    ref: "A1",
    headerRow: true,
    style: {
      theme: "TableStyleMedium2",
      showRowStripes: true,
    },
    columns: columns.map((c) => ({ name: c.header, filterButton: true })),
    rows: rows.map((r) =>
      columns.map(
        (c) => (r as Record<string, unknown>)[c.key] as ExcelJS.CellValue,
      ),
    ),
  });

  // Header styling.
  const headerRow = sheet.getRow(1);
  headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
  headerRow.alignment = { vertical: "middle", horizontal: "left" };
  headerRow.height = 22;

  // Currency formatting for the balance columns.
  sheet.getColumn("cyBalance").numFmt = '"$"#,##0;[Red]("$"#,##0)';
  sheet.getColumn("pyBalance").numFmt = '"$"#,##0;[Red]("$"#,##0)';

  // Wrap long text + vertical-top align so multi-line cells don't get clipped.
  sheet.eachRow({ includeEmpty: false }, (row, rowIndex) => {
    if (rowIndex === 1) return;
    row.alignment = { vertical: "top", wrapText: true };
    row.height = Math.max(row.height ?? 0, 60);
  });

  // Color-code overall risk for fast scanning.
  const riskCol = sheet.getColumn("overallRiskLevel");
  riskCol.eachCell({ includeEmpty: false }, (cell, rowIndex) => {
    if (rowIndex === 1) return;
    const val = String(cell.value ?? "");
    const fill: ExcelJS.FillPattern | null =
      val === "High"
        ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFADBD8" } }
        : val === "Moderate"
          ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF3CD" } }
          : val === "Low"
            ? { type: "pattern", pattern: "solid", fgColor: { argb: "FFD4EDDA" } }
            : null;
    if (fill) cell.fill = fill;
    cell.font = { bold: true };
  });

  // Engagement notes on a second sheet so they don't clutter the table.
  const notesSheet = wb.addWorksheet("Engagement Notes");
  notesSheet.columns = [{ header: "Field", key: "k", width: 22 }, { header: "Value", key: "v", width: 110 }];
  notesSheet.getRow(1).font = { bold: true };
  notesSheet.addRows([
    { k: "Engagement ID", v: matrix.engagementId },
    { k: "Generated", v: matrix.generatedAt },
    { k: "Model", v: matrix.modelVersion },
    { k: "Rows", v: matrix.rows.length },
  ]);
  if (matrix.notes) {
    notesSheet.addRow({});
    const notesHeader = notesSheet.addRow({ k: "Model notes (caveats)", v: "" });
    notesHeader.font = { bold: true };
    const notesRow = notesSheet.addRow({ k: "", v: matrix.notes });
    notesRow.alignment = { vertical: "top", wrapText: true };
    notesRow.height = computeWrappedRowHeight(matrix.notes, 100);
  }

  const arrayBuffer = await wb.xlsx.writeBuffer();
  return Buffer.from(arrayBuffer);
}

// Approximates the row height needed to display `text` wrapped at the given
// column width without truncation. Counts explicit newlines plus the wrap
// span of each line (charsPerLine ≈ Excel column width in default font).
// Excel default row line height is ~15 points; pad slightly for descenders.
function computeWrappedRowHeight(text: string, charsPerLine: number): number {
  const LINE_HEIGHT = 15.5;
  const PADDING = 8;
  const MIN_HEIGHT = 60;
  const wrappedLines = text
    .split("\n")
    .reduce(
      (acc, line) => acc + Math.max(1, Math.ceil(line.length / charsPerLine)),
      0,
    );
  return Math.max(wrappedLines * LINE_HEIGHT + PADDING, MIN_HEIGHT);
}

type MatrixRowFlat = {
  rowNum: number;
  account: string;
  accountType: string;
  cyBalance: number;
  pyBalance: number | "";
  materialAccount: string;
  overallRiskLevel: string;
  relevantAssertions: string;
  risks: string;
  pyExceptions: string;
  plannedApproach: string;
  approachRationale: string;
  citation: string;
};
