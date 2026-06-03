import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-primary/10 bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <p className="font-display text-lg font-semibold text-primary">
            first-pass<span className="text-accent">.io</span>
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-primary/60">
            AI-Native Audit Testing
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            { label: "Features", href: "/#product" },
            { label: "Pricing", href: "/#pricing" },
            { label: "Trust", href: "/#trust" },
            { label: "Changelog", href: "#" },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { label: "About", href: "/about" },
            { label: "Careers", href: "#" },
            { label: "Press", href: "#" },
          ]}
        />
        <FooterCol
          title="Legal"
          links={[
            { label: "Privacy", href: "#" },
            { label: "Terms", href: "#" },
            { label: "DPA", href: "#" },
          ]}
        />
      </div>
      <div className="border-t border-primary/10">
        <p className="mx-auto w-full max-w-6xl px-6 py-4 text-xs text-foreground/60">
          © {new Date().getFullYear()} First-Pass. All rights reserved.
        </p>
      </div>
    </footer>
  );
}

function FooterCol({
  title,
  links,
}: {
  title: string;
  links: { label: string; href: string }[];
}) {
  return (
    <div>
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">
        {title}
      </p>
      <ul className="mt-3 space-y-2 text-sm">
        {links.map((l) => (
          <li key={l.label}>
            <Link href={l.href} className="text-primary hover:underline">
              {l.label}
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
