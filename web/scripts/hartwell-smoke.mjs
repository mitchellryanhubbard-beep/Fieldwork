// End-to-end smoke test against a live Supabase project.
// Exercises: create engagement, upload PY Audit PDF, upload CY TB Excel,
// read back, export via the schema-validated path, and diff against the
// canonical Hartwell sample.

import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { createClient } from "@supabase/supabase-js";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";

// --- load env ---
const env = Object.fromEntries(
  readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((l) => l && !l.startsWith("#"))
    .map((l) => {
      const idx = l.indexOf("=");
      return [l.slice(0, idx), l.slice(idx + 1)];
    }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

// --- schema validator ---
const repoRoot = resolve("..");
const schemaPath = resolve(repoRoot, "specs/engagement-setup.schema.json");
const fixturePath = resolve(repoRoot, "specs/fixtures/hartwell-fy2024.sample.json");
const schema = JSON.parse(readFileSync(schemaPath, "utf8"));
const fixture = JSON.parse(readFileSync(fixturePath, "utf8"));

const ajv = new Ajv2020({ allErrors: true, strict: true });
(addFormats.default ?? addFormats)(ajv);
const validate = ajv.compile(schema);

// --- real Hartwell test files (best-effort; falls back to in-memory blobs) ---
const HARTWELL_DIR = "C:/Users/mitch/OneDrive/Documents/Fieldwork.ai/Testing";
const candidatePy = `${HARTWELL_DIR}/Assertion_rules_engine_system_prompt.pdf`;
const candidateTb = `${HARTWELL_DIR}/Hartwell Manufacturing Engagement Setup.xlsx`;

function loadOrStub(path, fallbackName, fallbackType) {
  if (existsSync(path)) {
    const buf = readFileSync(path);
    return {
      name: path.split(/[\\/]/).pop(),
      type: path.endsWith(".pdf")
        ? "application/pdf"
        : "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      buf,
      source: "real",
    };
  }
  console.warn(`!! ${path} not found, using stub`);
  return { name: fallbackName, type: fallbackType, buf: Buffer.from("stub"), source: "stub" };
}

const pyFile = loadOrStub(candidatePy, "stub.pdf", "application/pdf");
const tbFile = loadOrStub(
  candidateTb,
  "stub.xlsx",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
);
console.log(`Using PY Audit  : ${pyFile.name} (${pyFile.source}, ${pyFile.buf.length} B)`);
console.log(`Using CY TB     : ${tbFile.name} (${tbFile.source}, ${tbFile.buf.length} B)`);

// --- step 1: insert engagement ---
const seed = fixture; // mirror values from the canonical fixture
const { data: ins, error: insErr } = await sb
  .from("engagements")
  .insert({
    client_name: seed.client.name,
    fiscal_year_end: seed.client.fiscalYearEnd,
    reporting_period_start: seed.client.reportingPeriodStart ?? null,
    framework: seed.framework,
    industry: seed.industry,
    risk_narrative: seed.cyRiskProfile.narrative ?? null,
    business_changes_narrative: seed.cyBusinessChanges.narrative ?? null,
    materiality_currency: "USD",
    overall_materiality: seed.materiality.overallMateriality,
    performance_materiality: seed.materiality.performanceMateriality,
    clearly_trivial_threshold: seed.materiality.clearlyTrivialThreshold,
    materiality_basis: seed.materiality.basis,
  })
  .select("id, created_at, updated_at")
  .single();
if (insErr) { console.error("insert engagement FAIL:", insErr); process.exit(1); }
const id = ins.id;
console.log(`✓ engagement ${id} created`);

// --- step 2: risk items + business changes ---
{
  const rows = seed.cyRiskProfile.items.map((r, i) => ({
    engagement_id: id, category: r.category, description: r.description, position: i,
  }));
  const { error } = await sb.from("engagement_risk_items").insert(rows);
  if (error) { console.error("risk items FAIL:", error); process.exit(1); }
  console.log(`✓ ${rows.length} risk items inserted`);
}
{
  const rows = seed.cyBusinessChanges.items.map((r, i) => ({
    engagement_id: id, category: r.category, description: r.description, position: i,
  }));
  const { error } = await sb.from("engagement_business_changes").insert(rows);
  if (error) { console.error("business changes FAIL:", error); process.exit(1); }
  console.log(`✓ ${rows.length} business changes inserted`);
}

// --- step 3: file uploads to Storage ---
async function uploadFile(kind, file) {
  const path = `engagements/${id}/${kind}-${Date.now()}-${file.name.replace(/[^A-Za-z0-9._-]/g, "_")}`;
  const { error: upErr } = await sb.storage
    .from("engagement-files")
    .upload(path, file.buf, { contentType: file.type, upsert: false });
  if (upErr) throw new Error(`storage upload ${kind}: ${upErr.message}`);
  const { error: rowErr } = await sb.from("engagement_files").insert({
    engagement_id: id, kind, storage_path: path,
    original_filename: file.name, content_type: file.type, size_bytes: file.buf.length,
  });
  if (rowErr) throw new Error(`file row ${kind}: ${rowErr.message}`);
  return path;
}
const pyPath = await uploadFile("py_audit", pyFile);
console.log(`✓ PY Audit uploaded → ${pyPath}`);
const tbPath = await uploadFile("cy_tb", tbFile);
console.log(`✓ CY TB uploaded → ${tbPath}`);

// --- step 4: round-trip read ---
const { data: readBack, error: readErr } = await sb
  .from("engagements")
  .select("*")
  .eq("id", id)
  .single();
if (readErr) { console.error("read FAIL:", readErr); process.exit(1); }
const [risks, changes, files] = await Promise.all([
  sb.from("engagement_risk_items").select("category, description, position").eq("engagement_id", id).order("position"),
  sb.from("engagement_business_changes").select("category, description, position").eq("engagement_id", id).order("position"),
  sb.from("engagement_files").select("kind, storage_path, original_filename, content_type, size_bytes, uploaded_at").eq("engagement_id", id),
]);
if (risks.error || changes.error || files.error) {
  console.error("subselect FAIL:", risks.error ?? changes.error ?? files.error);
  process.exit(1);
}
console.log(`✓ round-trip: ${risks.data.length} risks, ${changes.data.length} changes, ${files.data.length} files`);

// --- step 5: build export payload + schema validate ---
const fileByKind = Object.fromEntries(files.data.map((f) => [f.kind, f]));
const exportObj = {
  schemaVersion: "1.0.0",
  engagementId: id,
  client: {
    name: readBack.client_name,
    fiscalYearEnd: readBack.fiscal_year_end,
    ...(readBack.reporting_period_start ? { reportingPeriodStart: readBack.reporting_period_start } : {}),
  },
  framework: readBack.framework,
  industry: readBack.industry,
  pyAuditFile: {
    storagePath: fileByKind.py_audit.storage_path,
    originalFilename: fileByKind.py_audit.original_filename,
    contentType: fileByKind.py_audit.content_type,
    sizeBytes: Number(fileByKind.py_audit.size_bytes),
    uploadedAt: fileByKind.py_audit.uploaded_at,
  },
  cyTrialBalanceFile: {
    storagePath: fileByKind.cy_tb.storage_path,
    originalFilename: fileByKind.cy_tb.original_filename,
    contentType: fileByKind.cy_tb.content_type,
    sizeBytes: Number(fileByKind.cy_tb.size_bytes),
    uploadedAt: fileByKind.cy_tb.uploaded_at,
  },
  cyRiskProfile: {
    ...(readBack.risk_narrative ? { narrative: readBack.risk_narrative } : {}),
    items: risks.data.map((r) => ({ category: r.category, description: r.description })),
  },
  cyBusinessChanges: {
    ...(readBack.business_changes_narrative ? { narrative: readBack.business_changes_narrative } : {}),
    items: changes.data.map((r) => ({ category: r.category, description: r.description })),
  },
  materiality: {
    currency: "USD",
    overallMateriality: Number(readBack.overall_materiality),
    performanceMateriality: Number(readBack.performance_materiality),
    clearlyTrivialThreshold: Number(readBack.clearly_trivial_threshold),
    basis: readBack.materiality_basis,
  },
  createdAt: readBack.created_at,
  updatedAt: readBack.updated_at,
};

if (!validate(exportObj)) {
  console.error("✗ schema validation FAIL:");
  for (const e of validate.errors) console.error("  -", e.instancePath, e.message);
  process.exit(1);
}
console.log("✓ export validates against engagement-setup.schema.json");

// --- step 6: diff vs canonical fixture (ignoring id + timestamps) ---
function strip(o) {
  const c = JSON.parse(JSON.stringify(o));
  delete c.engagementId; delete c.createdAt; delete c.updatedAt;
  delete c.pyAuditFile?.storagePath; delete c.pyAuditFile?.uploadedAt;
  delete c.cyTrialBalanceFile?.storagePath; delete c.cyTrialBalanceFile?.uploadedAt;
  delete c.pyAuditFile?.sizeBytes; delete c.cyTrialBalanceFile?.sizeBytes;
  delete c.pyAuditFile?.originalFilename; delete c.cyTrialBalanceFile?.originalFilename;
  delete c.pyAuditFile?.contentType; delete c.cyTrialBalanceFile?.contentType;
  return c;
}
const fixtureStripped = strip(fixture);
const exportStripped = strip(exportObj);
const a = JSON.stringify(fixtureStripped, Object.keys(fixtureStripped).sort());
const b = JSON.stringify(exportStripped, Object.keys(exportStripped).sort());
if (a !== b) {
  console.error("✗ exported engagement differs from fixture (after stripping ids/timestamps/file metadata):");
  console.error("  fixture:", a.slice(0, 400) + "…");
  console.error("  export :", b.slice(0, 400) + "…");
  process.exit(1);
}
console.log("✓ exported payload matches Hartwell fixture content");

// --- step 7: signed URL spot-check ---
const { data: signed, error: sigErr } = await sb.storage
  .from("engagement-files")
  .createSignedUrl(pyPath, 60);
if (sigErr || !signed?.signedUrl) {
  console.error("signed URL FAIL:", sigErr); process.exit(1);
}
console.log("✓ signed URL issued for PY Audit");

// --- cleanup ---
await sb.storage.from("engagement-files").remove([pyPath, tbPath]);
await sb.from("engagements").delete().eq("id", id);
console.log("✓ cleanup complete");

console.log("\nALL SMOKE TESTS PASSED");
