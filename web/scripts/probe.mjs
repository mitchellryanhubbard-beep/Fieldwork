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

const { error: tableErr, count } = await sb
  .from("engagements")
  .select("*", { count: "exact", head: true });

if (tableErr) {
  console.error("DB CHECK FAIL:", tableErr.message);
  process.exit(1);
}
console.log(`DB CHECK OK — engagements rows: ${count ?? 0}`);

const { data: buckets, error: bucketErr } = await sb.storage.listBuckets();
if (bucketErr) {
  console.error("BUCKETS CHECK FAIL:", bucketErr.message);
  process.exit(1);
}
const names = (buckets ?? []).map((b) => b.name);
console.log("Buckets:", names.join(", ") || "(none)");
if (!names.includes("engagement-files")) {
  console.error("MISSING BUCKET: engagement-files");
  process.exit(1);
}
console.log("STORAGE CHECK OK — engagement-files bucket exists");
