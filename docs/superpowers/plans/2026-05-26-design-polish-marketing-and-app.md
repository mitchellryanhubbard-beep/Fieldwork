# Design Polish — Marketing Landing + App Pages Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Apply the Fieldwork visual identity (navy / gold / cream, Fraunces + Inter + JetBrains Mono) to a new public marketing landing at `/` and the existing engagement intake, now moved under `/app/*`.

**Architecture:** Next.js App Router with route groups separating the marketing surface from the auth-gated app surface. Tailwind v4 CSS variables hold the Fieldwork tokens; shadcn semantic tokens (`--primary`, `--background`, etc.) are remapped to point at them so existing components inherit the theme. Marketing page is a Server Component composed of section components. The existing engagement Server Actions, repo layer, and schema are NOT touched — only routes (filesystem location) and visual polish.

**Tech Stack:** Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui (Base UI primitives) · Supabase (server only — unchanged) · Fraunces / Inter / JetBrains Mono via `next/font/google`.

**Spec:** [`docs/superpowers/specs/2026-05-26-design-polish-marketing-and-app.md`](../specs/2026-05-26-design-polish-marketing-and-app.md)

---

## File Structure (created / modified)

```
web/
├── src/
│   ├── app/
│   │   ├── globals.css                                # MODIFY — add Fieldwork tokens
│   │   ├── layout.tsx                                 # MODIFY — swap Geist for Fraunces/Inter/JBM
│   │   ├── (marketing)/                               # CREATE (route group, no URL segment)
│   │   │   ├── layout.tsx                             # CREATE — marketing nav + footer wrapper
│   │   │   └── page.tsx                               # CREATE — marketing landing (composed of sections)
│   │   ├── app/                                       # CREATE (new URL segment for the app)
│   │   │   ├── layout.tsx                             # CREATE — app nav wrapper
│   │   │   ├── page.tsx                               # MOVE — from src/app/page.tsx (engagement list)
│   │   │   └── engagements/                           # MOVE — from src/app/engagements/
│   │   │       ├── actions.ts                         # MOVE (unchanged)
│   │   │       ├── new/page.tsx                       # MOVE
│   │   │       └── [id]/
│   │   │           ├── page.tsx                       # MOVE
│   │   │           └── export/route.ts                # MOVE
│   │   └── page.tsx                                   # DELETE — replaced by (marketing)/page.tsx
│   ├── components/
│   │   ├── site-header.tsx                            # CREATE — nav with marketing|app variants
│   │   ├── site-footer.tsx                            # CREATE — footer (marketing only)
│   │   ├── numbered-section.tsx                       # CREATE — gold-step section for app detail
│   │   ├── marketing/                                 # CREATE — landing page sections
│   │   │   ├── hero.tsx
│   │   │   ├── trust-band.tsx
│   │   │   ├── problem-block.tsx
│   │   │   ├── how-it-works.tsx
│   │   │   ├── product-visual.tsx
│   │   │   ├── trust-compliance.tsx
│   │   │   ├── pricing.tsx
│   │   │   └── cta-band.tsx
│   │   ├── ui/
│   │   │   └── button.tsx                             # MODIFY — add gold / goldOutline variants
│   │   ├── engagement-form.tsx                        # MODIFY — apply new patterns
│   │   └── file-upload.tsx                            # MODIFY — apply new patterns
│   └── lib/
│       └── engagement-repo.ts                         # UNCHANGED
└── scripts/
    └── check-routes.mjs                               # CREATE — route smoke test
```

---

## Task 1: Add Fieldwork design tokens to Tailwind v4

**Files:**
- Modify: `web/src/app/globals.css`

**Context:** Tailwind v4 uses `@theme` for tokens. Add the Fieldwork tokens as new variables AND remap the existing shadcn semantic tokens (`--background`, `--primary`, `--accent`, etc.) to point at them. This lets every existing shadcn component re-skin without per-component changes.

- [ ] **Step 1: Read the current globals.css to find the existing token block**

Run: `cat web/src/app/globals.css | head -80`
Expected: see `@import "tailwindcss";` and a `:root { --background: ...; }` block.

- [ ] **Step 2: Add the Fieldwork token block + remap shadcn semantic tokens**

In `web/src/app/globals.css`, immediately after `@import "tailwindcss";` (and any other `@import` lines, before the `:root` block), add:

```css
@theme {
  --color-fw-navy: #1d3a52;
  --color-fw-navy-soft: #2a4d6b;
  --color-fw-gold: #c8a04a;
  --color-fw-gold-soft: #d9b870;
  --color-fw-cream: #ede5d3;
  --color-fw-cream-deep: #e3d9c2;
  --color-fw-ink: #11202e;
  --color-fw-snow: #ffffff;
  --color-fw-crimson: #8a2f2f;
  --font-display: "Fraunces", ui-serif, Georgia, serif;
  --font-sans: "Inter", ui-sans-serif, system-ui, sans-serif;
  --font-mono: "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, monospace;
}
```

Then locate the existing `:root { ... }` block that defines `--background`, `--foreground`, `--primary`, `--card`, etc., and replace its contents with this remap:

```css
:root {
  --background: var(--color-fw-cream);
  --foreground: var(--color-fw-ink);
  --card: var(--color-fw-snow);
  --card-foreground: var(--color-fw-ink);
  --popover: var(--color-fw-snow);
  --popover-foreground: var(--color-fw-ink);
  --primary: var(--color-fw-navy);
  --primary-foreground: var(--color-fw-snow);
  --secondary: var(--color-fw-cream-deep);
  --secondary-foreground: var(--color-fw-navy);
  --muted: var(--color-fw-cream-deep);
  --muted-foreground: color-mix(in oklab, var(--color-fw-ink) 65%, var(--color-fw-cream));
  --accent: var(--color-fw-gold);
  --accent-foreground: var(--color-fw-navy);
  --destructive: var(--color-fw-crimson);
  --destructive-foreground: var(--color-fw-snow);
  --border: color-mix(in oklab, var(--color-fw-navy) 12%, transparent);
  --input: color-mix(in oklab, var(--color-fw-navy) 20%, transparent);
  --ring: var(--color-fw-gold);
  --radius: 0.75rem;
}
```

If the file has a `.dark { ... }` block, leave it but add `display: none;`-equivalent — actually, replace the `.dark` block entirely with a single CSS comment: `/* Dark mode intentionally not supported in v1 — cream paper is the brand. */`

- [ ] **Step 3: Verify the build still compiles**

Run: `cd web && npm run build`
Expected: build succeeds, no warnings about unknown CSS variables.

- [ ] **Step 4: Commit**

```bash
cd web/..
git add web/src/app/globals.css
git commit -m "feat(design): Fieldwork color tokens, shadcn remap

Add navy/gold/cream/ink token scale to Tailwind v4 @theme.
Remap shadcn semantic tokens (--primary, --background, --accent,
etc.) to point at the Fieldwork palette so existing components
re-skin without per-component changes. Dark mode removed.
"
```

---

## Task 2: Swap Geist for Fraunces + Inter + JetBrains Mono

**Files:**
- Modify: `web/src/app/layout.tsx`

- [ ] **Step 1: Read the current layout to see the existing font imports**

Run: `cat web/src/app/layout.tsx`
Expected: see `import { Geist, Geist_Mono } from "next/font/google";` and CSS variables `--font-geist-sans`, `--font-geist-mono` applied to `<html>`.

- [ ] **Step 2: Replace Geist with Fraunces / Inter / JetBrains Mono**

Replace the contents of `web/src/app/layout.tsx` with:

```tsx
import type { Metadata } from "next";
import { Fraunces, Inter, JetBrains_Mono } from "next/font/google";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  axes: ["opsz"],
  display: "swap",
});

const inter = Inter({
  variable: "--font-sans",
  subsets: ["latin"],
  display: "swap",
});

const jetbrainsMono = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Fieldwork — First Pass on Autopilot",
  description:
    "An Excel-native audit copilot. Generates workpapers, designs samples, runs analytics, and flags exceptions — without leaving the workbook.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col bg-background text-foreground font-sans">
        {children}
        <Toaster richColors closeButton position="top-right" />
      </body>
    </html>
  );
}
```

- [ ] **Step 3: Verify the build compiles and fonts load**

Run: `cd web && npm run build`
Expected: build succeeds. Look for "Generating route types" and "Compiled successfully". Any unresolved font axis will fail loudly.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/layout.tsx
git commit -m "feat(design): swap Geist for Fraunces + Inter + JetBrains Mono

Fraunces (variable, opsz) → display headings.
Inter → UI / body.
JetBrains Mono → numbers + dates + balances.
"
```

---

## Task 3: Move app routes under /app

**Files:**
- Move: `web/src/app/engagements/` → `web/src/app/app/engagements/`
- Move: `web/src/app/page.tsx` → `web/src/app/app/page.tsx`
- Create: `web/src/app/app/layout.tsx` (passthrough for now; nav added in Task 5)

**Context:** Plain filesystem move; the engagement list page becomes `/app`, new becomes `/app/engagements/new`, etc. The marketing landing replaces the root `/` later. After the move, two internal references must be updated: the Server Action's redirect target and the engagement list page's "+ New engagement" link.

- [ ] **Step 1: Move the page directories**

Run (from repo root):

```bash
mkdir -p web/src/app/app
git mv web/src/app/engagements web/src/app/app/engagements
git mv web/src/app/page.tsx web/src/app/app/page.tsx
```

Expected: `git status` shows three renames staged.

- [ ] **Step 2: Add a thin /app layout (placeholder for now — nav arrives in Task 5)**

Create `web/src/app/app/layout.tsx`:

```tsx
export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
```

- [ ] **Step 3: Update the Server Action redirect target**

Open `web/src/app/app/engagements/actions.ts`. Find the line that calls `redirect("/engagements/${newId}")` (or similar) and update it to `/app/engagements/${newId}`. Also update any other internal redirects in this file.

Run: `cd web && grep -nE "redirect\([\"\`'/]" src/app/app/engagements/actions.ts`
Expected: every redirect path starts with `/app/`.

If a redirect is missed, the create flow lands on a 404. Fix any matches that don't include `/app/`.

- [ ] **Step 4: Update the engagement-list links**

Open `web/src/app/app/page.tsx`. Find every `href="/engagements/...` (there are at least two: the `+ New engagement` link and the per-row `Link` to `/engagements/[id]`). Update them to `/app/engagements/...`.

Also open `web/src/app/app/engagements/[id]/page.tsx` and update:
- The breadcrumb `<Link href="/">` (the "← Engagements" link) → `<Link href="/app">`
- The `<Link href={\`/engagements/${id}/export\`}>` → `<Link href={\`/app/engagements/${id}/export\`}>`

Open `web/src/app/app/engagements/new/page.tsx` and update the breadcrumb `<Link href="/">` → `<Link href="/app">`.

Run: `cd web && grep -rn "href=\"/engagements" src/app/`
Expected: zero matches.

Run: `cd web && grep -rn "href=\"/\"" src/app/app/`
Expected: zero matches (the breadcrumbs should now point at `/app`).

- [ ] **Step 5: Add a TEMPORARY redirect from / to /app so we don't break local testing before Task 6 lands the marketing page**

Create `web/src/app/page.tsx` (yes, the path we just moved away from — this is a temporary placeholder until Task 6):

```tsx
import { redirect } from "next/navigation";

export default function RootPlaceholder() {
  redirect("/app");
}
```

- [ ] **Step 6: Verify routes still serve**

Restart the dev server (kill the running one first):

```bash
cd web && npm run build
```

Expected: build succeeds with the new route table — `/`, `/app`, `/app/engagements/new`, `/app/engagements/[id]`, `/app/engagements/[id]/export` all present in the route summary.

If dev server is running, hit:

```bash
curl -s -o /dev/null -w "%{http_code} %{redirect_url}\n" http://localhost:3000/
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/app
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3000/app/engagements/new
```

Expected:
- `/` → 307 redirect to `/app` (or 200 if Next handled it server-side — both fine)
- `/app` → 200
- `/app/engagements/new` → 200

- [ ] **Step 7: Verify the Hartwell smoke test still passes**

Run: `cd web && node scripts/hartwell-smoke.mjs`
Expected: `ALL SMOKE TESTS PASSED`

- [ ] **Step 8: Commit**

```bash
git add -A web/src/app/
git commit -m "refactor: move engagement intake under /app/* route group

Marketing landing at / arrives in a later task; / temporarily
redirects to /app to keep the local flow walkable. All internal
links and the create-engagement redirect updated.
"
```

---

## Task 4: Add gold + goldOutline variants to Button

**Files:**
- Modify: `web/src/components/ui/button.tsx`

- [ ] **Step 1: Read the current Button to find the variants block**

Run: `cat web/src/components/ui/button.tsx`
Expected: see `const buttonVariants = cva(...)` with a `variant: { default, outline, secondary, ghost, destructive, link }` object.

- [ ] **Step 2: Add two new variants — gold and goldOutline**

In `web/src/components/ui/button.tsx`, inside the `variant: { ... }` object, append (alongside `link`):

```ts
        gold:
          "bg-accent text-primary border-accent shadow-sm hover:brightness-105 active:brightness-95 font-medium",
        goldOutline:
          "border-accent text-primary bg-transparent hover:bg-accent/10 active:bg-accent/15",
```

The full variants object should end up looking like:

```ts
      variant: {
        default: "bg-primary text-primary-foreground [a]:hover:bg-primary/80",
        outline:
          "border-border bg-background hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-secondary/80 aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "bg-destructive/10 text-destructive hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
        gold:
          "bg-accent text-primary border-accent shadow-sm hover:brightness-105 active:brightness-95 font-medium",
        goldOutline:
          "border-accent text-primary bg-transparent hover:bg-accent/10 active:bg-accent/15",
      },
```

- [ ] **Step 3: Verify the build compiles**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ui/button.tsx
git commit -m "feat(ui): add gold + goldOutline Button variants"
```

---

## Task 5: Build SiteHeader with marketing + app variants

**Files:**
- Create: `web/src/components/site-header.tsx`
- Modify: `web/src/app/app/layout.tsx` (use the header)

**Context:** One `<SiteHeader />` component, props-driven. Marketing variant: full top nav with trial CTA. App variant: same wordmark, in-app nav items, account chip, no trial CTA. Both share the wordmark + cream-bg + sticky behavior. No client JS yet — sticky shadow is a future enhancement; for now, a static border.

- [ ] **Step 1: Create the SiteHeader component**

Create `web/src/components/site-header.tsx`:

```tsx
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
```

- [ ] **Step 2: Wire the header into the app layout**

Replace the contents of `web/src/app/app/layout.tsx`:

```tsx
import { SiteHeader } from "@/components/site-header";

export default function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader variant="app" />
      {children}
    </>
  );
}
```

- [ ] **Step 3: Verify the header renders on every app route**

Run: `cd web && npm run build`
Expected: build succeeds.

If dev server is running:

```bash
curl -s http://localhost:3000/app | grep -c "FIELDWORK"
curl -s http://localhost:3000/app/engagements/new | grep -c "FIELDWORK"
```

Expected: `1` and `1`.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/site-header.tsx web/src/app/app/layout.tsx
git commit -m "feat(ui): SiteHeader with marketing + app variants

App layout now wraps every /app route with the app-variant header.
Marketing layout (next task) wraps / with the marketing variant.
"
```

---

## Task 6: Build the marketing landing at /

**Files:**
- Create: `web/src/app/(marketing)/layout.tsx`
- Create: `web/src/app/(marketing)/page.tsx`
- Create: `web/src/components/marketing/hero.tsx`
- Create: `web/src/components/marketing/trust-band.tsx`
- Create: `web/src/components/marketing/problem-block.tsx`
- Create: `web/src/components/marketing/how-it-works.tsx`
- Create: `web/src/components/marketing/product-visual.tsx`
- Create: `web/src/components/marketing/trust-compliance.tsx`
- Create: `web/src/components/marketing/pricing.tsx`
- Create: `web/src/components/marketing/cta-band.tsx`
- Create: `web/src/components/site-footer.tsx`
- Delete: `web/src/app/page.tsx` (the temporary redirect from Task 3)

**Context:** Server Components only. Each section is a focused single-file component composed into the page. Route group `(marketing)` is invisible in the URL, just lets us scope a separate layout.

- [ ] **Step 1: Delete the temporary root redirect**

Run: `cd web && rm src/app/page.tsx`

- [ ] **Step 2: Create the marketing route-group layout (wraps with header + footer)**

Create `web/src/app/(marketing)/layout.tsx`:

```tsx
import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";

export default function MarketingLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <SiteHeader variant="marketing" />
      {children}
      <SiteFooter />
    </>
  );
}
```

- [ ] **Step 3: Create the Hero section**

Create `web/src/components/marketing/hero.tsx`:

```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 pb-20 pt-16 sm:pt-24">
      <p className="mb-6 text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        First Pass on Autopilot
      </p>
      <h1 className="max-w-3xl font-display text-5xl font-medium leading-[1.05] tracking-tight text-primary sm:text-6xl">
        Audit fieldwork that lives inside Excel.
      </h1>
      <p className="mt-6 max-w-xl text-lg leading-relaxed text-foreground/80">
        A copilot for staff auditors. Generates workpapers, designs samples,
        runs analytics, and flags exceptions — without leaving the workbook.
      </p>
      <div className="mt-8 flex flex-wrap gap-3">
        <Link
          href="/app/engagements/new"
          className={buttonVariants({ variant: "gold", size: "lg" })}
        >
          Start free trial
        </Link>
        <Link
          href="#cta"
          className={buttonVariants({ variant: "goldOutline", size: "lg" })}
        >
          Book a demo
        </Link>
      </div>
      <p className="mt-10 text-xs font-semibold uppercase tracking-[0.18em] text-primary/60">
        AICPA &middot; IFRS &middot; PCAOB
      </p>
    </section>
  );
}
```

- [ ] **Step 4: Create the Trust band**

Create `web/src/components/marketing/trust-band.tsx`:

```tsx
export function TrustBand() {
  return (
    <section className="border-y border-primary/10 bg-secondary/40">
      <div className="mx-auto w-full max-w-6xl px-6 py-8 text-center">
        <p className="text-sm font-medium text-primary">
          Built for AICPA, IFRS, and PCAOB engagements.
        </p>
        <p className="mt-2 text-xs uppercase tracking-[0.18em] text-primary/50">
          Mid-tier firm logos coming as beta partners onboard.
        </p>
      </div>
    </section>
  );
}
```

- [ ] **Step 5: Create the Problem block**

Create `web/src/components/marketing/problem-block.tsx`:

```tsx
const STATS = [
  { value: "~40%", label: "Hours on sample selection + tickmarks" },
  { value: "~25%", label: "Hours on analytical procedures" },
  { value: "~15%", label: "Hours on exception consolidation" },
  { value: "~20%", label: "Hours on workpaper formatting" },
];

export function ProblemBlock() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <h2 className="max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight text-primary sm:text-4xl">
        What first-year staff actually spend time on.
      </h2>
      <p className="mt-3 max-w-xl text-foreground/70">
        Most of fieldwork is rote work that doesn&apos;t need judgment. Illustrative breakdown of a typical mid-market private audit.
      </p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <li
            key={s.label}
            className="rounded-xl border border-primary/10 bg-card p-5"
          >
            <p className="font-mono text-3xl font-medium text-primary">
              {s.value}
            </p>
            <p className="mt-2 text-sm text-foreground/70">{s.label}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 6: Create the How-it-works section**

Create `web/src/components/marketing/how-it-works.tsx`:

```tsx
const STEPS = [
  {
    n: "01",
    title: "Engagement Setup",
    body: "Capture client, framework, industry, materiality, PY audit, and CY trial balance.",
  },
  {
    n: "02",
    title: "Assertion-Risk Matrix",
    body: "AI maps every significant account to risks, assertions, and a planned approach. You review.",
  },
  {
    n: "03",
    title: "Workpaper generation",
    body: "Lead sheets, scoping documents, and per-account workpaper shells, all in Excel.",
  },
  {
    n: "04",
    title: "Substantive + analytical testing",
    body: "Sample selection, tickmarks, ratio + variance flagging, and an exception report you sign.",
  },
];

export function HowItWorks() {
  return (
    <section id="product" className="bg-secondary/40 py-20">
      <div className="mx-auto w-full max-w-6xl px-6">
        <h2 className="max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight text-primary sm:text-4xl">
          From engagement setup to signed exception report.
        </h2>
        <ol className="mt-10 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((s) => (
            <li
              key={s.n}
              className="rounded-xl border border-primary/10 bg-card p-6"
            >
              <p className="font-mono text-sm font-semibold text-accent">
                {s.n}
              </p>
              <h3 className="mt-3 font-display text-xl font-medium text-primary">
                {s.title}
              </h3>
              <p className="mt-2 text-sm text-foreground/70">{s.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
```

- [ ] **Step 7: Create the Product visual section**

Create `web/src/components/marketing/product-visual.tsx`:

```tsx
export function ProductVisual() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="rounded-2xl border border-primary/10 bg-primary p-2 shadow-lg">
        <div
          aria-label="Excel + Fieldwork task pane (placeholder)"
          className="grid h-72 place-items-center rounded-xl bg-[repeating-linear-gradient(135deg,theme(colors.primary/0.05)_0,theme(colors.primary/0.05)_8px,transparent_8px,transparent_16px)] text-sm font-medium text-primary-foreground/70 sm:h-96"
        >
          Product screenshot — Excel with the Fieldwork task pane
        </div>
      </div>
      <p className="mt-3 text-center text-xs uppercase tracking-[0.18em] text-primary/50">
        Real screenshot lands with the Office.js add-in (Milestone 2)
      </p>
    </section>
  );
}
```

- [ ] **Step 8: Create the Trust + compliance section**

Create `web/src/components/marketing/trust-compliance.tsx`:

```tsx
const BULLETS = [
  {
    title: "Zero-retention API",
    body: "Client data is never stored or trained on. Verified at every code path that sends client content.",
  },
  {
    title: "Audit trail on every cell",
    body: "Source, prompt, and reasoning saved with each generated workpaper cell.",
  },
  {
    title: "Never auto-concludes",
    body: "Fieldwork flags exceptions; auditors form opinions. By design.",
  },
  {
    title: "Framework templates",
    body: "Distinct templates for AICPA, IFRS, and PCAOB engagements.",
  },
];

export function TrustCompliance() {
  return (
    <section id="trust" className="mx-auto w-full max-w-6xl px-6 py-20">
      <h2 className="max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight text-primary sm:text-4xl">
        Built for firm-grade trust.
      </h2>
      <ul className="mt-10 grid gap-6 sm:grid-cols-2">
        {BULLETS.map((b) => (
          <li
            key={b.title}
            className="border-l-2 border-accent pl-5"
          >
            <h3 className="font-display text-xl font-medium text-primary">
              {b.title}
            </h3>
            <p className="mt-2 text-sm text-foreground/75">{b.body}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
```

- [ ] **Step 9: Create the Pricing section**

Create `web/src/components/marketing/pricing.tsx`:

```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

type Tier = {
  name: string;
  price: string;
  cadence: string;
  desc: string;
  cta: string;
  ctaHref: string;
  ctaVariant: "gold" | "goldOutline";
  featured?: boolean;
};

const TIERS: Tier[] = [
  {
    name: "Starter",
    price: "$249",
    cadence: "/user/mo",
    desc: "For small CPA firms with 1–5 users. Limited engagements and AI runs.",
    cta: "Start free trial",
    ctaHref: "/app/engagements/new",
    ctaVariant: "goldOutline",
  },
  {
    name: "Pro",
    price: "$499",
    cadence: "/user/mo",
    desc: "Full testing workflows and integrations. The full Fieldwork.",
    cta: "Start free trial",
    ctaHref: "/app/engagements/new",
    ctaVariant: "gold",
    featured: true,
  },
  {
    name: "Enterprise",
    price: "Custom",
    cadence: "",
    desc: "SSO, audit logs, advanced controls, and dedicated support for large firms.",
    cta: "Talk to sales",
    ctaHref: "#cta",
    ctaVariant: "goldOutline",
  },
];

export function Pricing() {
  return (
    <section id="pricing" className="bg-secondary/40 py-20">
      <div className="mx-auto w-full max-w-6xl px-6">
        <h2 className="max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight text-primary sm:text-4xl">
          Per-seat pricing.
        </h2>
        <p className="mt-3 max-w-xl text-foreground/70">
          14-day free trial. No card required during beta. 30-day money-back
          guarantee on paid plans.
        </p>
        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {TIERS.map((t) => (
            <div
              key={t.name}
              className={`relative flex flex-col rounded-xl border bg-card p-6 ${
                t.featured ? "border-accent shadow-lg" : "border-primary/10"
              }`}
            >
              {t.featured ? (
                <span className="absolute -top-3 left-6 rounded-full bg-accent px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.15em] text-primary">
                  Most popular
                </span>
              ) : null}
              <h3 className="font-display text-2xl font-medium text-primary">
                {t.name}
              </h3>
              <p className="mt-3 font-mono text-3xl text-primary">
                {t.price}
                <span className="text-base text-foreground/60">
                  {t.cadence}
                </span>
              </p>
              <p className="mt-3 text-sm text-foreground/75">{t.desc}</p>
              <Link
                href={t.ctaHref}
                className={`mt-6 ${buttonVariants({
                  variant: t.ctaVariant,
                  size: "default",
                })}`}
              >
                {t.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 10: Create the CTA band**

Create `web/src/components/marketing/cta-band.tsx`:

```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export function CtaBand() {
  return (
    <section id="cta" className="bg-primary py-16">
      <div className="mx-auto w-full max-w-6xl px-6 text-center">
        <h2 className="font-display text-3xl font-medium leading-tight text-primary-foreground sm:text-4xl">
          Start your 14-day trial.
        </h2>
        <p className="mx-auto mt-3 max-w-md text-primary-foreground/70">
          No card during beta. Walk one engagement through Fieldwork and decide
          if it pays for itself.
        </p>
        <div className="mt-7 flex flex-wrap justify-center gap-3">
          <Link
            href="/app/engagements/new"
            className={buttonVariants({ variant: "gold", size: "lg" })}
          >
            Start free trial
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 11: Create the site footer**

Create `web/src/components/site-footer.tsx`:

```tsx
import Link from "next/link";

export function SiteFooter() {
  return (
    <footer className="border-t border-primary/10 bg-background">
      <div className="mx-auto grid w-full max-w-6xl gap-10 px-6 py-12 sm:grid-cols-2 md:grid-cols-4">
        <div>
          <p className="font-display text-lg font-semibold text-primary">
            FIELDWORK
          </p>
          <p className="mt-2 text-xs uppercase tracking-[0.18em] text-primary/60">
            First Pass on Autopilot
          </p>
        </div>
        <FooterCol
          title="Product"
          links={[
            { label: "Features", href: "#product" },
            { label: "Pricing", href: "#pricing" },
            { label: "Trust", href: "#trust" },
          ]}
        />
        <FooterCol
          title="Company"
          links={[
            { label: "About", href: "#" },
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
          © {new Date().getFullYear()} Fieldwork. All rights reserved.
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
```

- [ ] **Step 12: Compose the marketing landing page**

Create `web/src/app/(marketing)/page.tsx`:

```tsx
import { Hero } from "@/components/marketing/hero";
import { TrustBand } from "@/components/marketing/trust-band";
import { ProblemBlock } from "@/components/marketing/problem-block";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { ProductVisual } from "@/components/marketing/product-visual";
import { TrustCompliance } from "@/components/marketing/trust-compliance";
import { Pricing } from "@/components/marketing/pricing";
import { CtaBand } from "@/components/marketing/cta-band";

export default function MarketingHome() {
  return (
    <main>
      <Hero />
      <TrustBand />
      <ProblemBlock />
      <HowItWorks />
      <ProductVisual />
      <TrustCompliance />
      <Pricing />
      <CtaBand />
    </main>
  );
}
```

- [ ] **Step 13: Verify build + critical content presence**

Run: `cd web && npm run build`
Expected: build succeeds; route table includes `/`, `/app`, `/app/engagements/new`, etc.

Restart dev server if needed, then:

```bash
curl -s "http://localhost:3000/" > /tmp/landing.html
grep -c "FIELDWORK" /tmp/landing.html
grep -c "First Pass on Autopilot" /tmp/landing.html
grep -c "Audit fieldwork that lives inside Excel" /tmp/landing.html
grep -c "Engagement Setup" /tmp/landing.html
grep -c "Assertion-Risk Matrix" /tmp/landing.html
grep -c "\\$249" /tmp/landing.html
grep -c "\\$499" /tmp/landing.html
grep -c "Most popular" /tmp/landing.html
grep -c "Zero-retention API" /tmp/landing.html
```

Expected: every grep returns at least `1`. Any zero is a missing section — go back and fix the offending component.

- [ ] **Step 14: Commit**

```bash
git add -A web/src/app/\(marketing\)/ web/src/components/marketing/ web/src/components/site-footer.tsx
git rm web/src/app/page.tsx 2>/dev/null || true
git commit -m "feat(marketing): landing page at /

10 sections: Hero, Trust band, Problem, How it works, Product
visual placeholder, Trust + compliance, Pricing (3 tiers from
PRD), CTA band, Footer. Server-rendered, Tailwind only.
"
```

---

## Task 7: Polish the engagement list page

**Files:**
- Modify: `web/src/app/app/page.tsx`

**Context:** Apply the new visual patterns — page kicker (gold small-caps), serif display title, card layout per spec, mono numbers (PM, CTT). Remove the `Database not reachable` error card styling drift; keep the actual error handling.

- [ ] **Step 1: Read the current /app page**

Run: `cat web/src/app/app/page.tsx`
Expected: see the existing list/empty/error rendering.

- [ ] **Step 2: Rewrite the engagement list with the new patterns**

Replace `web/src/app/app/page.tsx` entirely:

```tsx
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { listEngagements } from "@/lib/engagement-repo";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";

export const dynamic = "force-dynamic";

const USD_COMPACT = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export default async function AppHome() {
  let engagements: Awaited<ReturnType<typeof listEngagements>> = [];
  let loadError: string | null = null;

  try {
    engagements = await listEngagements();
  } catch (err) {
    loadError = err instanceof Error ? err.message : String(err);
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
        Engagements
      </p>
      <div className="mt-2 flex flex-wrap items-end justify-between gap-4">
        <h1 className="font-display text-4xl font-medium tracking-tight text-primary">
          FY2024 Audits
        </h1>
        <Link
          href="/app/engagements/new"
          className={buttonVariants({ variant: "gold" })}
        >
          + New engagement
        </Link>
      </div>

      <div className="mt-10">
        {loadError ? (
          <Card>
            <CardHeader>
              <CardTitle>Database not reachable</CardTitle>
              <CardDescription>
                Supabase credentials are missing or invalid. Set{" "}
                <code>SUPABASE_URL</code> and{" "}
                <code>SUPABASE_SERVICE_ROLE_KEY</code> in{" "}
                <code>.env.local</code> and apply the migration in{" "}
                <code>web/supabase/migrations/</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="overflow-x-auto rounded bg-muted p-3 font-mono text-xs">
                {loadError}
              </pre>
            </CardContent>
          </Card>
        ) : engagements.length === 0 ? (
          <Card>
            <CardHeader>
              <CardTitle>No engagements yet</CardTitle>
              <CardDescription>
                Create one to capture client info, materiality, risk profile,
                and the prior-year audit + current-year trial balance.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Link
                href="/app/engagements/new"
                className={buttonVariants({ variant: "gold" })}
              >
                + New engagement
              </Link>
            </CardContent>
          </Card>
        ) : (
          <ul className="grid gap-3">
            {engagements.map((e) => (
              <li key={e.id}>
                <Link
                  href={`/app/engagements/${e.id}`}
                  className="block rounded-xl border border-primary/10 bg-card p-5 transition-colors hover:bg-secondary/50"
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
                    <span className="font-display text-xl font-medium text-primary">
                      {e.clientName}
                    </span>
                    <span className="text-xs uppercase tracking-[0.14em] text-foreground/50">
                      Updated {new Date(e.updatedAt).toLocaleString()}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    <Chip>
                      {INDUSTRY_LABELS[
                        e.industry as keyof typeof INDUSTRY_LABELS
                      ] ?? e.industry}
                    </Chip>
                    <Chip>
                      {FRAMEWORK_LABELS[
                        e.framework as keyof typeof FRAMEWORK_LABELS
                      ] ?? e.framework}
                    </Chip>
                    <span className="font-mono text-sm text-foreground/70">
                      FYE {e.fiscalYearEnd}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}

function Chip({ children }: { children: React.ReactNode }) {
  return (
    <span className="rounded-full border border-primary/30 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
      {children}
    </span>
  );
}
```

- [ ] **Step 3: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 4: Verify rendered content**

```bash
curl -s "http://localhost:3000/app" > /tmp/app.html
grep -c "FY2024 Audits" /tmp/app.html
grep -c "New engagement" /tmp/app.html
```

Expected: both `≥ 1`.

- [ ] **Step 5: Commit**

```bash
git add web/src/app/app/page.tsx
git commit -m "feat(app): polish engagement list with Fieldwork patterns

Gold kicker, serif title, navy chips, mono dates. Empty state
gets a friendlier CTA panel. Error state keeps its diagnostic
mode but adopts the new card treatment.
"
```

---

## Task 8: Numbered Section component for the detail page

**Files:**
- Create: `web/src/components/numbered-section.tsx`

- [ ] **Step 1: Create the component**

Create `web/src/components/numbered-section.tsx`:

```tsx
import type { ReactNode } from "react";

export type NumberedSectionProps = {
  n: number;
  title: string;
  description?: string;
  children: ReactNode;
};

export function NumberedSection({
  n,
  title,
  description,
  children,
}: NumberedSectionProps) {
  return (
    <section className="space-y-3">
      <header className="flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-accent font-mono text-xs font-semibold text-primary">
          {String(n).padStart(2, "0")}
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {title}
        </h2>
      </header>
      {description ? (
        <p className="ml-10 max-w-2xl text-sm text-foreground/70">
          {description}
        </p>
      ) : null}
      <div className="ml-0 sm:ml-10">{children}</div>
    </section>
  );
}
```

- [ ] **Step 2: Verify it imports cleanly**

Run: `cd web && npm run build`
Expected: build succeeds (component is unused yet; just confirm no syntax errors).

- [ ] **Step 3: Commit**

```bash
git add web/src/components/numbered-section.tsx
git commit -m "feat(ui): NumberedSection — gold step number + small-caps label"
```

---

## Task 9: Apply polish to the engagement detail page

**Files:**
- Modify: `web/src/app/app/engagements/[id]/page.tsx`
- Modify: `web/src/components/engagement-form.tsx`
- Modify: `web/src/components/file-upload.tsx`

**Context:** Use `NumberedSection` to wrap each region. Move the file uploads inside the same numbered flow as the form sections so the page reads top-to-bottom as 1→5. The form component currently bundles every section into its own `<Card>` — keep `Card`-as-container but wrap each in `NumberedSection`. Header gets the serif client name + chips + mono FYE.

- [ ] **Step 1: Update the detail page header to use the new patterns**

Replace the contents of `web/src/app/app/engagements/[id]/page.tsx`:

```tsx
import Link from "next/link";
import { notFound } from "next/navigation";
import { EngagementForm } from "@/components/engagement-form";
import { FileUpload } from "@/components/file-upload";
import { NumberedSection } from "@/components/numbered-section";
import { Button, buttonVariants } from "@/components/ui/button";
import { getEngagement } from "@/lib/engagement-repo";
import type { EngagementFormValues } from "@/lib/engagement-schema";
import {
  FRAMEWORK_LABELS,
  INDUSTRY_LABELS,
} from "@/lib/engagement-schema";
import {
  deleteEngagementAction,
  updateEngagementAction,
} from "../actions";

export const dynamic = "force-dynamic";

type Params = { id: string };

export default async function EditEngagementPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id } = await params;
  const detail = await getEngagement(id);
  if (!detail) notFound();

  async function handleUpdate({ values }: { values: EngagementFormValues }) {
    "use server";
    return updateEngagementAction(id, values);
  }

  async function handleDelete() {
    "use server";
    await deleteEngagementAction(id);
  }

  const v = detail.values;

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm">
        <Link
          href="/app"
          className="text-foreground/60 hover:text-foreground hover:underline"
        >
          ← Engagements
        </Link>
      </nav>

      <header className="mb-10 flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl font-medium tracking-tight text-primary">
            {v.clientName || "Untitled engagement"}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground/70">
            <span className="rounded-full border border-primary/30 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              {FRAMEWORK_LABELS[v.framework]}
            </span>
            <span className="rounded-full border border-primary/30 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
              {INDUSTRY_LABELS[v.industry]}
            </span>
            <span className="font-mono text-sm">FYE {v.fiscalYearEnd}</span>
          </div>
        </div>
        <div className="flex gap-2">
          <Link
            href={`/app/engagements/${id}/export`}
            className={buttonVariants({ variant: "goldOutline" })}
          >
            Export JSON
          </Link>
          <form action={handleDelete}>
            <Button type="submit" variant="destructive">
              Delete
            </Button>
          </form>
        </div>
      </header>

      <div className="space-y-12">
        <NumberedSection
          n={1}
          title="Source files"
          description="Prior-year signed audit opinion (PDF) and current-year trial balance (Excel or CSV). Replacing an upload removes the prior file from storage."
        >
          <div className="space-y-4">
            <FileUpload
              engagementId={id}
              kind="py_audit"
              title="PY Audit (PDF)"
              description="Signed audit opinion + accompanying issued financial statements only — not the full PY binder."
              accept="application/pdf,.pdf"
              current={detail.pyAuditFile}
            />
            <FileUpload
              engagementId={id}
              kind="cy_tb"
              title="CY Trial Balance (Excel or CSV)"
              description="Current-year trial balance as exported from the client's GL."
              accept=".xlsx,.xls,.csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel,text/csv"
              current={detail.cyTrialBalanceFile}
            />
          </div>
        </NumberedSection>

        <EngagementForm
          mode="edit"
          defaultValues={detail.values}
          onSubmitAction={handleUpdate}
        />
      </div>
    </main>
  );
}
```

- [ ] **Step 2: Update EngagementForm to use NumberedSection (and drop the per-section `Card` chrome it currently uses)**

In `web/src/components/engagement-form.tsx`:

1. Add at the top, alongside the existing imports:

```tsx
import { NumberedSection } from "@/components/numbered-section";
```

2. Find the four `<Card>` blocks (Client + Framework, Materiality, CY Risk Profile, CY Significant Business Changes) and the final submit `<div className="flex justify-end gap-3">`.

3. Wrap the four sections in `<NumberedSection>` instead of `<Card>`, numbered 2 through 5 (Source Files is `1` on the detail page; on the create page we still want 2-5 since there is no Source Files step yet — that's fine, the create page uses `<NumberedSection n={...}>` directly from this component, the numbering is consistent across both modes once the user creates the engagement).

Concretely, transform each section. Example — the first card (`Client + Framework`) currently looks like:

```tsx
      <Card>
        <CardHeader>
          <CardTitle>Client + Framework</CardTitle>
          <CardDescription>
            Drives industry-specific templates and assertion-risk mapping downstream.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          {/* fields */}
        </CardContent>
      </Card>
```

Becomes:

```tsx
      <NumberedSection
        n={2}
        title="Client + Framework"
        description="Drives industry-specific templates and assertion-risk mapping downstream."
      >
        <div className="grid gap-4 rounded-xl border border-primary/10 bg-card p-5 sm:grid-cols-2">
          {/* fields */}
        </div>
      </NumberedSection>
```

Apply the same transform to the other three: Materiality (n={3}), CY Risk Profile (n={4}), CY Significant Business Changes (n={5}). Reuse the existing field markup inside each transformed block; only swap the container.

Also remove the unused `Card`, `CardContent`, `CardDescription`, `CardHeader`, `CardTitle` imports from `engagement-form.tsx` if they're no longer used.

4. Find the existing submit row and re-skin to use the gold variant:

```tsx
      <div className="flex justify-end gap-3 pt-2">
        <Button type="submit" disabled={isPending} variant="gold">
          {isPending
            ? "Saving…"
            : mode === "create"
              ? "Create engagement"
              : "Save changes"}
        </Button>
      </div>
```

- [ ] **Step 3: Update FileUpload to drop its outer `Card` (since NumberedSection now provides framing)**

Replace `web/src/components/file-upload.tsx` entirely:

```tsx
"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadFileAction } from "@/app/app/engagements/actions";

export type FileUploadProps = {
  engagementId: string;
  kind: "py_audit" | "cy_tb";
  title: string;
  description: string;
  accept: string;
  current?: {
    originalFilename: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
};

export function FileUpload({
  engagementId,
  kind,
  title,
  description,
  accept,
  current,
}: FileUploadProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    const form = new FormData();
    form.append("engagementId", engagementId);
    form.append("kind", kind);
    form.append("file", file);

    startTransition(async () => {
      const result = await uploadFileAction(form);
      if (!result.ok) {
        setError(result.error);
        toast.error("Upload failed", { description: result.error });
        return;
      }
      toast.success(`${title} uploaded`);
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-primary/10 bg-card p-5">
      <p className="font-display text-lg font-medium text-primary">{title}</p>
      <p className="mt-1 text-sm text-foreground/70">{description}</p>
      {current ? (
        <div className="mt-4 rounded-lg border border-primary/10 bg-secondary/40 p-3 text-sm">
          <div className="font-medium text-primary">
            {current.originalFilename}
          </div>
          <div className="mt-0.5 font-mono text-xs text-foreground/60">
            {formatBytes(current.sizeBytes)} · uploaded{" "}
            {new Date(current.uploadedAt).toLocaleString()}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-foreground/55">No file uploaded yet.</p>
      )}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap gap-2">
        <Input
          ref={inputRef}
          type="file"
          accept={accept}
          className="max-w-md"
        />
        <Button type="submit" disabled={isPending} variant="gold">
          {isPending ? "Uploading…" : current ? "Replace" : "Upload"}
        </Button>
      </form>
      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
```

Notice the import path: `@/app/app/engagements/actions` (since actions moved under `/app`).

- [ ] **Step 4: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 5: Verify content of detail page (against an existing engagement via the smoke test)**

Run the smoke test which creates + tears down a Hartwell engagement:

```bash
cd web && node scripts/hartwell-smoke.mjs
```

Expected: `ALL SMOKE TESTS PASSED`.

Then create a Hartwell engagement manually through the app to eyeball — or use any existing engagement. If one exists, `curl` it:

```bash
curl -s "http://localhost:3000/app" > /tmp/list.html
grep -oE '/app/engagements/[0-9a-f-]{36}' /tmp/list.html | head -1
# copy that path, then:
curl -s "http://localhost:3000/app/engagements/<UUID>" | grep -c "Source files"
curl -s "http://localhost:3000/app/engagements/<UUID>" | grep -c "Materiality"
```

Expected: `1` for both.

- [ ] **Step 6: Commit**

```bash
git add web/src/app/app/engagements/[id]/page.tsx \
        web/src/components/engagement-form.tsx \
        web/src/components/file-upload.tsx
git commit -m "feat(app): polish engagement detail with NumberedSection

Detail page now reads 01→05: Source files, Client + framework,
Materiality, Risk profile, Business changes. File upload card
drops its outer Card chrome since NumberedSection frames the
group. Save + Upload buttons go gold.
"
```

---

## Task 10: Polish the engagement create page

**Files:**
- Modify: `web/src/app/app/engagements/new/page.tsx`

**Context:** Same patterns as the detail page header but no file-upload section (files require an engagement id). The form itself is already numbered 2–5 from Task 9; create page is fine starting at 2 (visually consistent with the detail page's 1=Source Files step appearing first only when there's an engagement to attach files to).

- [ ] **Step 1: Replace the new-engagement page**

Replace `web/src/app/app/engagements/new/page.tsx`:

```tsx
import Link from "next/link";
import { EngagementForm } from "@/components/engagement-form";
import type { EngagementFormValues } from "@/lib/engagement-schema";
import { createEngagementAction } from "../actions";

export default function NewEngagementPage() {
  async function handleCreate({ values }: { values: EngagementFormValues }) {
    "use server";
    return createEngagementAction(values);
  }

  return (
    <main className="mx-auto w-full max-w-4xl px-6 py-12">
      <nav className="mb-6 text-sm">
        <Link
          href="/app"
          className="text-foreground/60 hover:text-foreground hover:underline"
        >
          ← Engagements
        </Link>
      </nav>

      <header className="mb-10">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          New engagement
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium tracking-tight text-primary">
          Capture the engagement.
        </h1>
        <p className="mt-3 max-w-xl text-sm text-foreground/70">
          Client + framework, materiality, current-year risk picture, and
          significant business changes. Source files (PY Audit + CY Trial
          Balance) are uploaded on the next screen.
        </p>
      </header>

      <EngagementForm mode="create" onSubmitAction={handleCreate} />
    </main>
  );
}
```

- [ ] **Step 2: Verify the build**

Run: `cd web && npm run build`
Expected: build succeeds.

- [ ] **Step 3: Verify content presence**

```bash
curl -s http://localhost:3000/app/engagements/new > /tmp/new.html
grep -c "Capture the engagement" /tmp/new.html
grep -c "Client + Framework" /tmp/new.html
grep -c "Materiality" /tmp/new.html
grep -c "CY Risk Profile" /tmp/new.html
grep -c "CY Significant Business Changes" /tmp/new.html
```

Expected: all `≥ 1`.

- [ ] **Step 4: Commit**

```bash
git add web/src/app/app/engagements/new/page.tsx
git commit -m "feat(app): polish new-engagement page header to match detail"
```

---

## Task 11: Routes smoke test script

**Files:**
- Create: `web/scripts/check-routes.mjs`
- Modify: `web/package.json` (add `check:routes` script)

- [ ] **Step 1: Create the script**

Create `web/scripts/check-routes.mjs`:

```js
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
```

- [ ] **Step 2: Add the npm script**

Open `web/package.json`. In the `scripts` block, add the line below alongside the existing `probe` and `ensure-bucket` entries:

```json
"check:routes": "node scripts/check-routes.mjs"
```

The block ends up looking like:

```json
  "scripts": {
    "dev": "next dev",
    "build": "next build",
    "start": "next start",
    "lint": "eslint",
    "probe": "node scripts/probe.mjs",
    "ensure-bucket": "node scripts/ensure-bucket.mjs",
    "check:routes": "node scripts/check-routes.mjs"
  },
```

- [ ] **Step 3: Run the check (dev server must be up)**

Run: `cd web && npm run check:routes`
Expected:

```
OK    /  status=200  contains=3
OK    /app  status=200  contains=2
OK    /app/engagements/new  status=200  contains=2

All routes OK
```

If any line says `FAIL`, the body of that page didn't include the expected snippet — fix the offending component before continuing.

- [ ] **Step 4: Commit**

```bash
git add web/scripts/check-routes.mjs web/package.json
git commit -m "test: add check:routes smoke test

Confirms /, /app, and /app/engagements/new each return 200 and
contain the critical content markers (wordmark, tagline, hero
headline, page kicker). Cheap regression net for the polish pass.
"
```

---

## Task 12: Final verification — full Hartwell flow + design diff

**Files:**
- None (verification only)

- [ ] **Step 1: Run all smoke tests in order**

```bash
cd web
npm run probe
npm run check:routes
node scripts/hartwell-smoke.mjs
```

Expected:
- `probe`: `DB CHECK OK`, `STORAGE CHECK OK`.
- `check:routes`: `All routes OK`.
- `hartwell-smoke`: `ALL SMOKE TESTS PASSED`.

- [ ] **Step 2: Schema validation still passes**

Run (from repo root): `npm run validate:hartwell`
Expected: `OK — sample validates against schema`.

- [ ] **Step 3: Manual visual eyeball pass**

With the dev server up, open these four URLs in a browser at 1440px width and confirm the design matches the spec:

- http://localhost:3000/ — hero loads in serif, gold kicker visible, two CTAs, framework chips, 10 sections scroll
- http://localhost:3000/app — gold "Engagements" kicker, serif "FY2024 Audits" title, gold + New engagement CTA
- http://localhost:3000/app/engagements/new — gold "New engagement" kicker, "Capture the engagement." headline, numbered 2–5 sections
- http://localhost:3000/app/engagements/{any existing id} — serif client name, navy chips, mono FYE, gold Export JSON + crimson Delete, 01 Source files through 05 Business changes

If any page renders with the old Geist font, or any heading is still sans-serif where it should be Fraunces, restart the dev server (`npm run dev`) to force-reload the font cache and re-check.

- [ ] **Step 4: Commit any final tweaks if needed; otherwise just confirm clean tree**

Run: `git status`
Expected: `nothing to commit, working tree clean`.

If there are pending changes from visual tweaks, commit them:

```bash
git add -A
git commit -m "fix(design): visual tweaks from final eyeball pass"
```

---

## Self-review checklist (already run)

**Spec coverage:**
- Palette tokens → Task 1 ✓
- Type system → Task 2 ✓
- Marketing nav → Task 5 + Task 6 ✓
- All 10 marketing sections → Task 6 ✓
- Trust band logos placeholder → Task 6 step 4 ✓
- Pricing tiers from PRD → Task 6 step 9 ✓
- Route restructure → Task 3 ✓
- App nav → Task 5 ✓
- App list page polish → Task 7 ✓
- Numbered section pattern → Task 8 ✓
- Detail page polish → Task 9 ✓
- Create page polish → Task 10 ✓
- Routes smoke test → Task 11 ✓
- Hartwell smoke test still passes → Task 3 step 7, Task 9 step 5, Task 12 step 1 ✓
- Gold + goldOutline Button variants → Task 4 ✓
- Crimson destructive treatment → Task 1 (token) + Task 9 (used) ✓

**Placeholder scan:** None — every step contains complete code or a runnable command.

**Type consistency:** `FRAMEWORK_LABELS` / `INDUSTRY_LABELS` exports already exist in `engagement-schema.ts` and are used unchanged. `NumberedSection` shape matches its only caller (the detail page in Task 9). Button `gold` / `goldOutline` variant names are consistent across Tasks 4, 5, 6, 7, 9, 10.

**Risks from spec carried forward:**
- Crimson hex chosen in Task 1 as `#8a2f2f`. Adjust during Task 12 visual pass if it reads too red.
- Stat cards in `ProblemBlock` are illustrative — flagged in spec; not blocking.
- Product screenshot is a striped placeholder — flagged; replace in M2.
