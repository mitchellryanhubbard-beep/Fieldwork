import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/supabase/ssr";

export type SiteHeaderProps = {
  variant: "marketing" | "app";
};

export async function SiteHeader({ variant }: SiteHeaderProps) {
  const user = variant === "app" ? await getCurrentUser() : null;
  const initials = user?.email
    ? user.email
        .split("@")[0]
        .split(/[._-]/)
        .map((p) => p[0]?.toUpperCase() ?? "")
        .join("")
        .slice(0, 2) || user.email[0]?.toUpperCase()
    : "MH";
  return (
    <header className="sticky top-0 z-40 border-b border-primary/10 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        {/* Wordmark always returns to the public landing page, matching the
            SaaS convention (Stripe, Vercel, Linear). Use the in-nav
            "Engagements" link to get back to /app from within the app. */}
        <Link
          href="/"
          className="flex items-center gap-2.5 font-display text-lg font-semibold tracking-tight text-primary"
        >
          <img
            src="/logo-icon.svg"
            alt=""
            aria-hidden="true"
            className="size-7"
          />
          <span>
            FIRST-PASS<span className="text-accent">.IO</span>
          </span>
        </Link>

        {variant === "marketing" ? (
          <nav className="flex items-center gap-6 text-sm text-primary">
            <Link href="#product" className="hover:underline">
              Product
            </Link>
            <Link href="#pricing" className="hover:underline">
              Pricing
            </Link>
            <Link href="#trust" className="hover:underline">
              Trust
            </Link>
            <Link href="/app" className="hover:underline">
              Sign in
            </Link>
            <Link
              href="/app/engagements/new"
              className={buttonVariants({ variant: "gold", size: "sm" })}
            >
              Start free trial
            </Link>
          </nav>
        ) : (
          <nav className="flex items-center gap-6 text-sm text-primary">
            <Link href="/app" className="hover:underline">
              Engagements
            </Link>
            <button
              type="button"
              disabled
              className="cursor-not-allowed text-primary/55 disabled:opacity-100"
            >
              Settings
            </button>
            <button
              type="button"
              disabled
              className="cursor-not-allowed text-primary/55 disabled:opacity-100"
            >
              Help
            </button>
            <form action="/auth/logout" method="post">
              <button
                type="submit"
                aria-label={user?.email ? `Sign out ${user.email}` : "Sign out"}
                title={user?.email ? `Sign out ${user.email}` : "Sign out"}
                className="grid size-8 place-items-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground hover:bg-primary/85"
              >
                {initials}
              </button>
            </form>
          </nav>
        )}
      </div>
    </header>
  );
}
