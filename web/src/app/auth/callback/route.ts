import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";

// Magic-link landing — Supabase appends a `code` query param to the
// redirect URL after the user clicks the link in their email. We
// exchange it for a session here (which sets the auth cookies), then
// run a one-time claim step if the signed-in user matches the configured
// admin email, and finally bounce to the requested `next` path.

const ADMIN_CLAIM_EMAIL = process.env.ADMIN_CLAIM_EMAIL ?? "";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const next = url.searchParams.get("next") ?? "/app";
  const redirectTo = new URL(next, url.origin);

  if (!code) {
    redirectTo.pathname = "/login";
    return NextResponse.redirect(redirectTo);
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return NextResponse.json(
      { error: "Supabase env vars missing" },
      { status: 500 },
    );
  }

  const response = NextResponse.redirect(redirectTo);
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const { data, error } = await supabase.auth.exchangeCodeForSession(code);
  if (error || !data.session) {
    const back = new URL("/login", url.origin);
    back.searchParams.set("error", error?.message ?? "Sign-in failed");
    return NextResponse.redirect(back);
  }

  // One-time legacy-data claim: if this is the configured admin email,
  // assign any owner-less engagements to the user. Idempotent — re-runs
  // are no-ops once everything has an owner.
  if (
    ADMIN_CLAIM_EMAIL &&
    data.user?.email?.toLowerCase() === ADMIN_CLAIM_EMAIL.toLowerCase()
  ) {
    await claimUnownedEngagements(data.user.id);
  }

  return response;
}

async function claimUnownedEngagements(userId: string): Promise<void> {
  try {
    const sb = getServerSupabase();
    await sb
      .from("engagements")
      .update({ owner_id: userId })
      .is("owner_id", null);
    // No need to touch child tables — the policy reads through the
    // engagement, and the child rows already FK to it. The bucket
    // doesn't need re-keying either because storage is engagement-
    // scoped, not user-scoped.
    void ENGAGEMENT_FILES_BUCKET;
  } catch {
    // best-effort; surface failures via logs only — don't block sign-in
  }
}
