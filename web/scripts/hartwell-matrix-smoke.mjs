// End-to-end smoke test for the assertion-matrix endpoint.
// Creates a Hartwell engagement via Supabase (mirrors the production flow,
// minus file uploads), then POSTs to /api/claude/assertion-matrix and asserts
// the response shape + a few audit-domain sanity checks.

import { readFileSync, existsSync } from "node:fs";
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

const BASE = process.env.FW_BASE_URL ?? "http://localhost:3000";
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- load Hartwell fixture from repo root ---
const repoRoot = resolve("..");
const fixturePath = resolve(repoRoot, "specs/fixtures/hartwell-fy2024.sample.json");
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

// --- step 1: insert engagement matching the fixture ---
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
if (insErr) { console.error("insert FAIL:", insErr); process.exit(1); }
const engagementId = ins.id;
console.log(`✓ engagement ${engagementId} created`);

// --- step 2: insert risks + business changes ---
{
  const rows = fixture.cyRiskProfile.items.map((r, i) => ({
    engagement_id: engagementId,
    category: r.category,
    description: r.description,
    position: i,
  }));
  const { error } = await sb.from("engagement_risk_items").insert(rows);
  if (error) { console.error("risks FAIL:", error); process.exit(1); }
  console.log(`✓ ${rows.length} risk items inserted`);
}
{
  const rows = fixture.cyBusinessChanges.items.map((r, i) => ({
    engagement_id: engagementId,
    category: r.category,
    description: r.description,
    position: i,
  }));
  const { error } = await sb.from("engagement_business_changes").insert(rows);
  if (error) { console.error("changes FAIL:", error); process.exit(1); }
  console.log(`✓ ${rows.length} business changes inserted`);
}

// --- step 3: insert stub file references (matrix endpoint needs them for export()) ---
{
  const stubFiles = [
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
  ];
  const { error } = await sb.from("engagement_files").insert(stubFiles);
  if (error) { console.error("files FAIL:", error); process.exit(1); }
  console.log(`✓ 2 file references inserted (stubs)`);
}

// --- step 4: call the matrix endpoint ---
console.log("→ POST /api/claude/assertion-matrix  (this may take 30-90s)");
const t0 = Date.now();
const res = await fetch(`${BASE}/api/claude/assertion-matrix`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ engagementId }),
});
const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
const json = await res.json();

if (!res.ok || !json.ok) {
  console.error(`✗ matrix endpoint FAIL (${res.status}, ${elapsed}s):`, JSON.stringify(json, null, 2).slice(0, 3000));
  // cleanup before exit
  await sb.from("engagements").delete().eq("id", engagementId);
  process.exit(1);
}

const m = json.matrix;
console.log(`✓ matrix returned in ${elapsed}s (${m.rows.length} rows)`);
console.log(`  input tokens:  ${json.usage.inputTokens.toLocaleString()}`);
console.log(`  output tokens: ${json.usage.outputTokens.toLocaleString()}`);

// --- step 5: sanity checks against audit-domain expectations ---
const failures = [];

if (m.rows.length < 5) failures.push(`expected ≥5 rows for a manufacturer, got ${m.rows.length}`);
if (m.rows.length > 60) failures.push(`expected ≤60 rows, got ${m.rows.length} (too granular?)`);

// Every row cites the engagement setup
const uncited = m.rows.filter((r) => r.citation.length < 10 || /^(n\/a|none|generic)/i.test(r.citation));
if (uncited.length > 0) failures.push(`${uncited.length} rows have missing or generic citations`);

// Inventory should appear for a manufacturer
const hasInventory = m.rows.some((r) => /inventor/i.test(r.account));
if (!hasInventory) failures.push("no inventory row found (expected for a manufacturer)");

// Revenue should appear with cut-off or occurrence
const revenueRow = m.rows.find((r) => /revenue|sales/i.test(r.account));
if (!revenueRow) {
  failures.push("no revenue row found");
} else {
  if (!revenueRow.relevantAssertions.some((a) => /CutOff|Occurrence/i.test(a))) {
    failures.push(`revenue row missing CutOff/Occurrence assertion (got: ${revenueRow.relevantAssertions.join(", ")})`);
  }
}

// At least one row should reference the ERP cutover or commodity volatility (the engagement's named risks)
const referencesERP = m.rows.some(
  (r) =>
    r.citation.toLowerCase().includes("erp") ||
    r.risks.some((risk) => /erp|cutover/i.test(risk)),
);
if (!referencesERP) failures.push("no row references the ERP cutover (Business Change #1) — citations not anchored");

// Risk levels are distributed (not all Moderate)
const riskLevels = new Set(m.rows.map((r) => r.overallRiskLevel));
if (riskLevels.size < 2) {
  failures.push(`risk levels not differentiated: every row is ${[...riskLevels][0]}`);
}

// --- step 6: cleanup ---
await sb.from("engagements").delete().eq("id", engagementId);
console.log(`✓ cleanup complete (engagement ${engagementId} deleted)`);

if (failures.length > 0) {
  console.error("\n✗ SANITY CHECKS FAILED:");
  failures.forEach((f) => console.error(`  - ${f}`));
  console.error("\nFull matrix sample:");
  console.error(JSON.stringify(m.rows.slice(0, 3), null, 2));
  process.exit(1);
}

console.log("\n✓ ALL SANITY CHECKS PASSED");
console.log("\nSample row:");
console.log(JSON.stringify(m.rows[0], null, 2));
if (m.notes) {
  console.log("\nModel notes:");
  console.log(m.notes);
}
