import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";

// Auth gate for everything under /app. Refreshes the session on each
// request so cookies stay live, then redirects unauthenticated traffic
// to /login. Auth-related routes (login, callback, etc.) and public
// landing pages pass through untouched.

const PROTECTED_PREFIX = "/app";
const PUBLIC_AUTH_PATHS = new Set(["/login", "/auth/callback", "/auth/logout"]);

export async function middleware(req: NextRequest) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // If Supabase env vars aren't set the middleware can't enforce
  // anything — pass through so dev mode without auth still works.
  if (!url || !anonKey) return NextResponse.next();

  const res = NextResponse.next();
  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return req.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          res.cookies.set(name, value, options);
        }
      },
    },
  });
  // Force a session refresh so cookies are renewed before downstream
  // handlers read them.
  const { data } = await supabase.auth.getUser();
  const user = data?.user ?? null;

  const path = req.nextUrl.pathname;
  if (path.startsWith(PROTECTED_PREFIX) && !user) {
    const loginUrl = req.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", path + req.nextUrl.search);
    return NextResponse.redirect(loginUrl);
  }

  // Already-signed-in users hitting /login bounce straight to /app.
  if (PUBLIC_AUTH_PATHS.has(path) && user && path === "/login") {
    const dest = req.nextUrl.clone();
    dest.pathname = "/app";
    dest.search = "";
    return NextResponse.redirect(dest);
  }

  return res;
}

// Run on everything except Next.js internals + static assets. The body
// of the middleware decides whether to redirect.
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
