"use client";

import { useRouter } from "next/navigation";

// Back-to-engagement link that prefers router.back() so the browser
// restores the user's exact scroll position on the engagement page.
// Falls back to a direct navigation (with the supplied anchor) when
// there's no history to pop — direct visits, deep links, refreshes.
export function EngagementBackLink({
  fallbackHref,
  label,
}: {
  fallbackHref: string;
  label: string;
}) {
  const router = useRouter();

  function handleClick(e: React.MouseEvent<HTMLAnchorElement>) {
    e.preventDefault();
    if (typeof window !== "undefined" && window.history.length > 1) {
      router.back();
    } else {
      router.push(fallbackHref);
    }
  }

  return (
    <a
      href={fallbackHref}
      onClick={handleClick}
      className="text-foreground/60 hover:text-foreground hover:underline"
    >
      ← {label}
    </a>
  );
}
