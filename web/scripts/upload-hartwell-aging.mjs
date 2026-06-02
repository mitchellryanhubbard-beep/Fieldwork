// One-shot helper: uploads Hartwell's AR Aging into Supabase Storage and
// registers it on engagement_files with kind='ar_aging'. Mirrors the path
// uploadEngagementFile takes, so the UI sees it as a real upload.

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
  console.error("Usage: node scripts/upload-hartwell-aging.mjs <engagementId>");
  process.exit(1);
}

const AGING_PATH =
  "C:/Users/mitch/OneDrive/Documents/Fieldwork.ai/Testing/AR Testing/PBC_AR_01_Aged_AR_By_Customer_By_Invoice_12312024.xlsx";
if (!existsSync(AGING_PATH)) {
  console.error(`✗ Aging file not found at ${AGING_PATH}`);
  process.exit(1);
}

const buf = readFileSync(AGING_PATH);
const filename = "PBC_AR_01_Aged_AR_By_Customer_By_Invoice_12312024.xlsx";
const storagePath = `engagements/${engagementId}/ar_aging-${Date.now()}-${filename}`;

// Upload to storage.
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

// Replace any existing ar_aging row (unique on engagement_id+kind).
const existing = await sb
  .from("engagement_files")
  .select("storage_path")
  .eq("engagement_id", engagementId)
  .eq("kind", "ar_aging")
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
    .eq("kind", "ar_aging");
  if (error) {
    console.error("✗ update row failed:", error);
    process.exit(1);
  }
} else {
  const { error } = await sb.from("engagement_files").insert({
    engagement_id: engagementId,
    kind: "ar_aging",
    storage_path: storagePath,
    original_filename: filename,
    content_type:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    size_bytes: buf.length,
  });
  if (error) {
    console.error("✗ insert row failed:", error);
    process.exit(1);
  }
}

console.log(`✓ AR Aging registered for ${engagementId}`);
console.log(`  storage: ${storagePath}`);
console.log(`  size:    ${buf.length.toLocaleString()} bytes`);
