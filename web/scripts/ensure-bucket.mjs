import { readFileSync } from "node:fs";
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

const BUCKET = "engagement-files";

const { data: existing } = await sb.storage.getBucket(BUCKET);
if (existing) {
  console.log(`Bucket '${BUCKET}' already exists. No-op.`);
  process.exit(0);
}

const { error } = await sb.storage.createBucket(BUCKET, {
  public: false,
  fileSizeLimit: 50 * 1024 * 1024, // 50 MB cap on individual uploads
});

if (error) {
  console.error("createBucket FAIL:", error.message);
  process.exit(1);
}

console.log(`Bucket '${BUCKET}' created (private, 50MB upload cap).`);
