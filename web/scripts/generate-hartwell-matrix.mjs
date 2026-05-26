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

if (cleanup) {
  await sb.from("engagements").delete().eq("id", engagementId);
  console.log(`✓ engagement ${engagementId} deleted`);
} else {
  console.log(`\nEngagement kept in Supabase. Open at:`);
  console.log(`  ${BASE}/app/engagements/${engagementId}`);
  console.log(`Run with --cleanup to delete after.`);
}
