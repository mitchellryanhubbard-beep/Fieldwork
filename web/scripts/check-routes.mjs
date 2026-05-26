// Routes smoke test — confirms every public + app route returns 200 (or a
// redirect to a 200) and contains expected critical content.
// Assumes `npm run dev` is already running on http://localhost:3000.

const BASE = process.env.FW_BASE_URL ?? "http://localhost:3000";

const PUBLIC_ROUTES = [
  { path: "/", contains: ["FIELDWORK", "First Pass on Autopilot", "Audit fieldwork that lives inside Excel"] },
  { path: "/app", contains: ["FIELDWORK", "Engagements"] },
  { path: "/app/engagements/new", contains: ["FIELDWORK", "Capture the engagement"] },
];

let failed = 0;

for (const r of PUBLIC_ROUTES) {
  const res = await fetch(`${BASE}${r.path}`, { redirect: "follow" });
  const body = await res.text();
  const okStatus = res.status === 200;
  const missing = r.contains.filter((s) => !body.includes(s));
  if (!okStatus || missing.length > 0) {
    console.error(
      `FAIL  ${r.path}  status=${res.status}  missing=${JSON.stringify(missing)}`,
    );
    failed += 1;
  } else {
    console.log(`OK    ${r.path}  status=200  contains=${r.contains.length}`);
  }
}

if (failed > 0) {
  console.error(`\n${failed} route(s) failed`);
  process.exit(1);
}
console.log("\nAll routes OK");
