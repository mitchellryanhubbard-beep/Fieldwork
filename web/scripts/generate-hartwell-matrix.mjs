// Generates a Hartwell matrix and persists both the raw JSON and a human-readable
// Markdown summary to web/scripts/output/. Leaves the engagement in Supabase so
// you can also open it at http://localhost:3000/app for inspection.
//
// Usage: node scripts/generate-hartwell-matrix.mjs [--keep|--cleanup]
//   --keep    (default) leave the seeded engagement in Supabase
//   --cleanup delete the engagement after the run

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import ExcelJS from "exceljs";

const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx), l.slice(idx + 1)];
    }),
);

const cleanup = process.argv.includes("--cleanup");
const BASE = process.env.FW_BASE_URL ?? "http://localhost:3000";
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const outDir = resolve("scripts/output");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });

const repoRoot = resolve("..");
const fixturePath = resolve(repoRoot, "specs/fixtures/hartwell-fy2024.sample.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

// --- seed engagement (mirrors Hartwell fixture) ---
const { data: ins, error: insErr } = await sb
  .from("engagements")
  .insert({
    client_name: fixture.client.name,
    fiscal_year_end: fixture.client.fiscalYearEnd,
    reporting_period_start: fixture.client.reportingPeriodStart ?? null,
    framework: fixture.framework,
    industry: fixture.industry,
    risk_narrative: fixture.cyRiskProfile.narrative ?? null,
    business_changes_narrative: fixture.cyBusinessChanges.narrative ?? null,
    materiality_currency: "USD",
    overall_materiality: fixture.materiality.overallMateriality,
    performance_materiality: fixture.materiality.performanceMateriality,
    clearly_trivial_threshold: fixture.materiality.clearlyTrivialThreshold,
    materiality_basis: fixture.materiality.basis,
  })
  .select("id")
  .single();
if (insErr) { console.error("insert engagement FAIL:", insErr); process.exit(1); }
const engagementId = ins.id;
console.log(`✓ engagement ${engagementId} seeded`);

await sb.from("engagement_risk_items").insert(
  fixture.cyRiskProfile.items.map((r, i) => ({
    engagement_id: engagementId,
    category: r.category,
    description: r.description,
    position: i,
  })),
);
await sb.from("engagement_business_changes").insert(
  fixture.cyBusinessChanges.items.map((r, i) => ({
    engagement_id: engagementId,
    category: r.category,
    description: r.description,
    position: i,
  })),
);
await sb.from("engagement_files").insert([
  {
    engagement_id: engagementId,
    kind: "py_audit",
    storage_path: `engagements/${engagementId}/py_audit-stub.pdf`,
    original_filename: "Hartwell_FY2023_Signed_Audit_Opinion.pdf",
    content_type: "application/pdf",
    size_bytes: 0,
  },
  {
    engagement_id: engagementId,
    kind: "cy_tb",
    storage_path: `engagements/${engagementId}/cy_tb-stub.xlsx`,
    original_filename: "Hartwell_FY2024_TB.xlsx",
    content_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size_bytes: 0,
  },
]);

// --- call matrix endpoint ---
console.log(`→ POST ${BASE}/api/claude/assertion-matrix  (~60-90s)`);
const t0 = Date.now();
const res = await fetch(`${BASE}/api/claude/assertion-matrix`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ engagementId }),
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const json = await res.json();

if (!res.ok || !json.ok) {
  console.error(`FAIL (${res.status}, ${elapsed}s):`, JSON.stringify(json, null, 2).slice(0, 2000));
  if (cleanup) await sb.from("engagements").delete().eq("id", engagementId);
  process.exit(1);
}

const m = json.matrix;
console.log(`✓ matrix returned in ${elapsed}s — ${m.rows.length} rows, ${json.usage.outputTokens} output tokens`);

// --- save raw JSON ---
const jsonPath = resolve(outDir, "hartwell-matrix.json");
writeFileSync(jsonPath, JSON.stringify(m, null, 2));
console.log(`✓ raw JSON → ${jsonPath}`);

// --- save human-readable Markdown ---
const fmt = (n) =>
  n == null ? "—" : new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n);

const md = [
  `# Hartwell Manufacturing — Assertion-Risk Matrix (Claude-generated)`,
  ``,
  `**Engagement:** ${fixture.client.name}`,
  `**FYE:** ${fixture.client.fiscalYearEnd}`,
  `**Framework:** ${fixture.framework} · **Industry:** ${fixture.industry}`,
  `**Materiality:** ${fmt(fixture.materiality.overallMateriality)} overall · ${fmt(fixture.materiality.performanceMateriality)} PM · ${fmt(fixture.materiality.clearlyTrivialThreshold)} CTT`,
  ``,
  `**Generated:** ${m.generatedAt}`,
  `**Model:** ${m.modelVersion}`,
  `**Rows:** ${m.rows.length}`,
  `**Token usage:** ${json.usage.inputTokens.toLocaleString()} in · ${json.usage.outputTokens.toLocaleString()} out`,
  ``,
  `---`,
  ``,
  `## Engagement-level notes (Claude's caveats)`,
  ``,
  m.notes ? `> ${m.notes.split("\n").join("\n> ")}` : `*(none)*`,
  ``,
  `---`,
  ``,
  `## Rows`,
  ``,
  m.rows
    .map((r, i) => {
      const lines = [
        `### ${i + 1}. ${r.account} — ${r.accountType} — ${r.overallRiskLevel} risk${r.materialAccount ? " · MATERIAL" : ""}`,
        ``,
        `- **CY balance:** ${fmt(r.cyBalance)} (PY: ${fmt(r.pyBalance)})`,
        `- **Relevant assertions:** ${r.relevantAssertions.join(", ")}`,
        `- **Planned approach:** ${r.plannedApproach}`,
        `- **Rationale:** ${r.approachRationale}`,
      ];
      if (r.risks.length > 0) {
        lines.push(`- **Risks:**`);
        r.risks.forEach((risk) => lines.push(`  - ${risk}`));
      }
      if (r.pyExceptions.length > 0) {
        lines.push(`- **PY exceptions:**`);
        r.pyExceptions.forEach((e) => lines.push(`  - ${e}`));
      }
      lines.push(`- **Citation:** ${r.citation}`);
      lines.push(``);
      return lines.join("\n");
    })
    .join("\n"),
].join("\n");

const mdPath = resolve(outDir, "hartwell-matrix.md");
writeFileSync(mdPath, md);
console.log(`✓ readable Markdown → ${mdPath}`);

// --- save as xlsx (re-implemented inline so this script stays SDK-free) ---
const wb = new ExcelJS.Workbook();
wb.creator = "Fieldwork";
wb.created = new Date(m.generatedAt);
const sheet = wb.addWorksheet("Assertion Plan", { views: [{ state: "frozen", ySplit: 1 }] });

const columns = [
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
sheet.columns = columns;

const flatRows = m.rows.map((r, i) => ({
  rowNum: i + 1,
  account: r.account,
  accountType: r.accountType,
  cyBalance: r.cyBalance,
  pyBalance: r.pyBalance ?? "",
  materialAccount: r.materialAccount ? "Yes" : "No",
  overallRiskLevel: r.overallRiskLevel,
  relevantAssertions: r.relevantAssertions.join(", "),
  risks: r.risks.join("\n"),
  pyExceptions: r.pyExceptions.join("\n"),
  plannedApproach: r.plannedApproach,
  approachRationale: r.approachRationale,
  citation: r.citation,
}));
sheet.addRows(flatRows);

sheet.addTable({
  name: "FieldworkAssertionPlan",
  ref: "A1",
  headerRow: true,
  style: { theme: "TableStyleMedium2", showRowStripes: true },
  columns: columns.map((c) => ({ name: c.header, filterButton: true })),
  rows: flatRows.map((r) => columns.map((c) => r[c.key])),
});

const headerRow = sheet.getRow(1);
headerRow.font = { bold: true, color: { argb: "FFFFFFFF" } };
headerRow.alignment = { vertical: "middle", horizontal: "left" };
headerRow.height = 22;

sheet.getColumn("cyBalance").numFmt = '"$"#,##0;[Red]("$"#,##0)';
sheet.getColumn("pyBalance").numFmt = '"$"#,##0;[Red]("$"#,##0)';

sheet.eachRow({ includeEmpty: false }, (row, rowIndex) => {
  if (rowIndex === 1) return;
  row.alignment = { vertical: "top", wrapText: true };
  row.height = Math.max(row.height ?? 0, 60);
});

const riskCol = sheet.getColumn("overallRiskLevel");
riskCol.eachCell({ includeEmpty: false }, (cell, rowIndex) => {
  if (rowIndex === 1) return;
  const val = String(cell.value ?? "");
  const fgColor =
    val === "High" ? "FFFADBD8" :
    val === "Moderate" ? "FFFFF3CD" :
    val === "Low" ? "FFD4EDDA" : null;
  if (fgColor) cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: fgColor } };
  cell.font = { bold: true };
});

const notesSheet = wb.addWorksheet("Engagement Notes");
notesSheet.columns = [{ header: "Field", key: "k", width: 22 }, { header: "Value", key: "v", width: 110 }];
notesSheet.getRow(1).font = { bold: true };
notesSheet.addRows([
  { k: "Engagement ID", v: m.engagementId },
  { k: "Generated", v: m.generatedAt },
  { k: "Model", v: m.modelVersion },
  { k: "Rows", v: m.rows.length },
]);
if (m.notes) {
  notesSheet.addRow({});
  const nh = notesSheet.addRow({ k: "Model notes (caveats)", v: "" });
  nh.font = { bold: true };
  const nc = notesSheet.addRow({ k: "", v: m.notes });
  nc.alignment = { vertical: "top", wrapText: true };
  nc.height = Math.max(m.notes.split("\n").length * 18, 120);
}

const xlsxPath = resolve(outDir, "hartwell-matrix.xlsx");
await wb.xlsx.writeFile(xlsxPath);
console.log(`✓ Excel workbook → ${xlsxPath}`);

if (cleanup) {
  await sb.from("engagements").delete().eq("id", engagementId);
  console.log(`✓ engagement ${engagementId} deleted`);
} else {
  console.log(`\nEngagement kept in Supabase. Open at:`);
  console.log(`  ${BASE}/app/engagements/${engagementId}`);
  console.log(`Run with --cleanup to delete after.`);
}
