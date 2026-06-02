"use client";

import { createBrowserClient } from "@supabase/ssr";

// Browser-side Supabase client — uses the anon key (safe to ship to the
// browser) and relies on cookies for session storage so the same login
// state is visible to server components, server actions, and middleware.
export function getBrowserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
    );
  }
  return createBrowserClient(url, anonKey);
}
