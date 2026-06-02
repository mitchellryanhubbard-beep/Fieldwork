import { cookies } from "next/headers";
import { createServerClient } from "@supabase/ssr";

// User-scoped Supabase client for server-side use (server components,
// server actions, route handlers). Reads session from the request's
// cookies and routes queries through the anon key + RLS policies, so
// authenticated users only see their own data.
//
// For trusted background tasks (intake parsing, generation pipelines)
// keep using getServerSupabase from "./server" — that one uses the
// service-role key and bypasses RLS by design.

export async function getUserSupabase() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set",
    );
  }
  const cookieStore = await cookies();
  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // setAll inside a server component throws — callers that need
          // to mutate cookies (login callback, logout) wrap this in a
          // route handler where cookie mutation is allowed.
        }
      },
    },
  });
}

// Returns the currently authenticated user, or null when there is no
// session. Centralizes session reads so callers can short-circuit on
// null without each one duplicating the auth wiring.
export async function getCurrentUser() {
  const sb = await getUserSupabase();
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) return null;
  return data.user;
}
