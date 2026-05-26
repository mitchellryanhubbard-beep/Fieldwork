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

// Supabase exposes information_schema indirectly via system catalogs.
// Try the Postgres meta endpoint that the Supabase dashboard uses internally.
const r = await fetch(
  `${env.SUPABASE_URL}/rest/v1/?select=*`,
  {
    headers: {
      apikey: env.SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${env.SUPABASE_SERVICE_ROLE_KEY}`,
      Accept: "application/openapi+json",
    },
  },
);
console.log("OpenAPI status:", r.status);
const body = await r.text();
// Look for the table names in PostgREST's OpenAPI spec
const matches = body.match(/"\/[a-z_]+"/g) ?? [];
console.log("Paths in OpenAPI spec:", matches.slice(0, 20));
