# First-Pass — Engagement Setup (web)

The web intake that captures everything the assertion-risk matrix and downstream workpaper generation need: client + framework + industry + materiality + risk profile + business changes + PY Audit + CY Trial Balance.

The output of this app is a JSON document conforming to [`specs/engagement-setup.schema.json`](../specs/engagement-setup.schema.json) — the locked contract consumed by the Office.js add-in.

## Prerequisites

- Node.js 22+
- A Supabase project (free tier is fine for dev)

## First-time setup

1. **Create a Supabase project** at https://supabase.com → New project.
2. **Apply the migration.** In the Supabase dashboard → SQL Editor, paste the contents of [`supabase/migrations/00000000000000_init.sql`](./supabase/migrations/00000000000000_init.sql) and run it. It creates the tables, enums, RLS, and the `engagement-files` storage bucket.
3. **Copy your keys.** In the dashboard → Project Settings → API, copy:
   - `Project URL` → `SUPABASE_URL`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (server-only — never expose to the browser)
4. **Configure local env.**

   ```sh
   cp .env.example .env.local
   # then edit .env.local and paste the two values
   ```

5. **Install and run.**

   ```sh
   npm install
   npm run dev
   ```

   Open http://localhost:3000.

## Validating the schema contract

From the repo root (one level up):

```sh
npm run validate:hartwell
```

That runs the Hartwell FY2024 fixture in `specs/fixtures/` through AJV against the JSON schema. It must print `OK` before any change to the schema is merged.

## Notes

- All database + storage access goes through Server Actions and the service role key. There is no browser-side Supabase client yet — that arrives in Milestone 2 with per-seat auth.
- The `engagement-files` Storage bucket is **private**. Files are accessed via short-lived signed URLs.
- Replacing a file upload removes the prior file from Storage to keep the bucket clean.
