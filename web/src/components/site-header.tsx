import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export type SiteHeaderProps = {
  variant: "marketing" | "app";
};

export function SiteHeader({ variant }: SiteHeaderProps) {
  return (
    <header className="sticky top-0 z-40 border-b border-primary/10 bg-background/90 backdrop-blur supports-[backdrop-filter]:bg-background/70">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center justify-between px-6">
        <Link
          href={variant === "marketing" ? "/" : "/app"}
          className="flex items-center gap-2 text-primary"
        >
          <span className="font-display text-xl font-semibold tracking-tight">
            FIELDWORK
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
            <span className="text-primary/40">Settings</span>
            <span className="text-primary/40">Help</span>
            <span
              aria-label="Account"
              className="grid size-8 place-items-center rounded-full bg-primary text-[11px] font-medium text-primary-foreground"
            >
              MH
            </span>
          </nav>
        )}
      </div>
    </header>
  );
}
