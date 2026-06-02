// One-shot helper: upload Hartwell's Subsequent Cash Receipts file into
// Supabase Storage and register on engagement_files.

import { readFileSync, existsSync } from "node:fs";
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

const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

const engagementId = process.argv[2];
if (!engagementId) {
  console.error("Usage: node scripts/upload-hartwell-scr.mjs <engagementId>");
  process.exit(1);
}

const SCR_PATH =
  "C:/Users/mitch/OneDrive/Documents/Fieldwork.ai/Testing/AR Testing/PBC_AR_04_Subsequent_Cash_Receipts_Jan2025.xlsx";
if (!existsSync(SCR_PATH)) {
  console.error(`✗ SCR file not found at ${SCR_PATH}`);
  process.exit(1);
}

const buf = readFileSync(SCR_PATH);
const filename = "PBC_AR_04_Subsequent_Cash_Receipts_Jan2025.xlsx";
const storagePath = `engagements/${engagementId}/subsequent_cash_receipts-${Date.now()}-${filename}`;

const { error: upErr } = await sb.storage
  .from("engagement-files")
  .upload(storagePath, buf, {
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    upsert: false,
  });
if (upErr) {
  console.error("✗ upload failed:", upErr);
  process.exit(1);
}

const existing = await sb
  .from("engagement_files")
  .select("storage_path")
  .eq("engagement_id", engagementId)
  .eq("kind", "subsequent_cash_receipts")
  .maybeSingle();

if (existing.data) {
  await sb.storage
    .from("engagement-files")
    .remove([existing.data.storage_path]);
  const { error } = await sb
    .from("engagement_files")
    .update({
      storage_path: storagePath,
      original_filename: filename,
      content_type:
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      size_bytes: buf.length,
      uploaded_at: new Date().toISOString(),
    })
    .eq("engagement_id", engagementId)
    .eq("kind", "subsequent_cash_receipts");
  if (error) { console.error("✗ update row failed:", error); process.exit(1); }
} else {
  const { error } = await sb.from("engagement_files").insert({
    engagement_id: engagementId,
    kind: "subsequent_cash_receipts",
    storage_path: storagePath,
    original_filename: filename,
    content_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size_bytes: buf.length,
  });
  if (error) { console.error("✗ insert row failed:", error); process.exit(1); }
}

console.log(`✓ SCR registered for ${engagementId}`);
console.log(`  storage: ${storagePath}`);
console.log(`  size:    ${buf.length.toLocaleString()} bytes`);
