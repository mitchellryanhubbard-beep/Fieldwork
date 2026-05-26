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

// 1. Try to insert (this fails)
console.log("--- insert test ---");
const ins = await sb.from("engagements").insert({
  client_name: "diag",
  fiscal_year_end: "2024-12-31",
  framework: "AICPA",
  industry: "Manufacturing",
  overall_materiality: 100,
  performance_materiality: 75,
  clearly_trivial_threshold: 5,
  materiality_basis: "diag",
});
console.log("insert result:", JSON.stringify(ins, null, 2));

// 2. Try to select
console.log("--- select test ---");
const sel = await sb.from("engagements").select("*").limit(1);
console.log("select result:", JSON.stringify({ data: sel.data, error: sel.error }, null, 2));

// 3. Try to query pg_tables via direct REST
console.log("--- raw fetch /rest/v1/engagements?limit=1 ---");
const r = await fetch(`${env.SUPABASE_URL}/rest/v1/engagements?limit=1`, {
  headers: {
    apikey: env.SUPABASE_SERVICE_ROLE_KEY,
    Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
    Accept: "application/json",
  },
});
console.log("status:", r.status);
console.log("body:", await r.text());
