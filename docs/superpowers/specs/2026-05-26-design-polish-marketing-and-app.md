# Design polish — marketing landing + engagement-setup app

**Date:** 2026-05-26
**Status:** Approved for planning
**Author:** brainstorm with Mitch + Claude

## Goal

Apply the Fieldwork visual identity (extracted from the Series A Executive Summary deck) to two surfaces:

1. **`/`** — a public marketing landing page that sells the per-seat Excel copilot positioning
2. **`/app/*`** — the existing engagement-intake flow, repolished against the same design system

The downstream artifacts (assertion-risk matrix, workpapers, testing) live in Excel via the Office.js add-in and are out of scope for this spec.

## Non-goals

- No authentication / per-seat licensing yet — `/app` remains effectively open in dev; gating arrives in M2 alongside the credential-server proxy.
- No marketing analytics, A/B testing, or CMS — copy is hard-coded for now.
- No managed-service messaging anywhere on the marketing site (that's the investor framing; customers buy the copilot).
- No motion / parallax — keep the surface respectable for Big-4 audience.
- No dark mode — `prefers-color-scheme` is ignored; cream paper is the brand.

## Brand basis

Source: [Executive Summary deck (Spring 2026)](attached to brainstorm conversation).

### Palette

| Token | Hex | Use |
|---|---|---|
| `--fw-navy` | `#1d3a52` | Wordmark, headlines, table headers, dark blocks |
| `--fw-gold` | `#c8a04a` | Logo swoosh, primary CTAs, step numbers, accents |
| `--fw-cream` | `#ede5d3` | Page background — gives a paper / fine-stationery feel |
| `--fw-ink` | `#11202e` | Body text on cream |
| `--fw-snow` | `#ffffff` | Cards on cream |
| `--fw-crimson` | TBD | Destructive actions (Delete) — to be picked during implementation |

### Type system

- **Display (serif):** Fraunces (variable, optical-size axis) — page titles, hero headline, client names in cards. Reads as a workpaper / firm-grade brochure without feeling stuffy.
- **UI (sans):** Inter — body, form labels, navigation, button text.
- **Numbers (mono):** JetBrains Mono — materiality figures, dates, balances, file sizes. Mono prevents column-misalignment in card layouts and signals "this is data."

### Voice

- Tagline (one place only, near the hero kicker): *First Pass on Autopilot*
- Positioning: **per-seat Excel copilot for staff auditors**. Never imply Fieldwork performs the audit on the firm's behalf.
- Frame: faster, not different. Auditors keep judgment; we eat the rote work.

## Surface 1 — Marketing landing (`/`)

A single-route static-ish page (Next.js Server Component, no client JS except the nav). Sections, top to bottom:

### 1. Nav bar

- Wordmark left (logo mark + FIELDWORK type)
- Right: `Product · Pricing · Trust · Sign in` and a gold-filled **Start free trial** CTA
- Sticky, cream background, subtle navy-tint shadow on scroll

### 2. Hero

- Gold small-caps kicker: *FIRST PASS ON AUTOPILOT*
- Serif headline (~60px on desktop): *Audit fieldwork that lives inside Excel.*
- Sans sub (~18px, max 540px wide): *A copilot for staff auditors. Generates workpapers, designs samples, runs analytics, and flags exceptions — without leaving the workbook.*
- Two CTAs: **Start free trial** (gold) and **Book a demo** (navy outline)
- Framework chips row: *AICPA · IFRS · PCAOB* in navy small caps

### 3. Trust band

- Single-line subtitle: *Built for AICPA, IFRS, and PCAOB engagements.*
- Logo strip placeholder (firms TBD) — keep the strip but show a single line *"Mid-tier firm logos coming as beta partners onboard."* placeholder for v1

### 4. The Problem

Heading: *What first-year staff actually spend time on.*
Four small stat cards across (compact, navy stat + ink label):

- *~40%* — Hours on sample selection + tickmarks
- *~25%* — Hours on analytical procedures
- *~15%* — Hours on exception consolidation
- *~20%* — Hours on workpaper formatting

(Stats are illustrative — replace with sourced numbers when available. Note in spec that these are placeholders pending real data.)

### 5. How it works

Heading: *From engagement setup to signed exception report.*
Four cards mirroring the milestone plan:

1. **Engagement Setup** — capture client, framework, industry, materiality, PY audit, CY TB.
2. **Assertion-Risk Matrix** — AI maps every significant account to risks, assertions, and a planned approach. You review.
3. **Workpaper generation** — lead sheets, scoping, and per-account workpaper shells, all in Excel.
4. **Substantive + analytical testing** — samples, tickmarks, variance flagging, exception report. You sign.

Each card: gold step number, serif step title, short sans description.

### 6. Product visual

A single Excel screenshot showing the task pane open, the matrix visible, and an exception flagged. Placeholder image for v1 (`/public/product-shot-placeholder.png`).

### 7. Trust & compliance

Heading: *Built for firm-grade trust.*
Four short bullets:

- Zero-retention Anthropic API — client data is never stored or trained on.
- Audit trail on every cell — source, prompt, and reasoning saved.
- Never auto-concludes — exceptions go to you for judgment.
- Framework templates for AICPA, IFRS, and PCAOB.

### 8. Pricing

Three cards, gold border on the recommended (Pro) tier:

- **Starter** — $249/user/mo — 1–5 users — limited engagements + AI runs
- **Pro** — $499/user/mo — full workflows + integrations — *visually marked as "Most popular" with a gold ribbon at the top of the card*
- **Enterprise** — Custom — SSO, audit logs, dedicated support

Foot: *14-day free trial, no card during beta. 30-day money-back guarantee on paid plans.*

### 9. CTA band

Navy block, gold CTA: *"Start your 14-day trial. No card during beta."*

### 10. Footer

Three columns: Product (Features, Pricing, Trust, Changelog) · Company (About, Careers, Press) · Legal (Privacy, Terms, DPA). Bottom row: copyright, address placeholder.

## Surface 2 — App polish (`/app/*`)

### Route restructure

```
BEFORE                              AFTER
/                                   /                          (marketing)
/engagements/new                    /app                       (engagement list)
/engagements/[id]                   /app/engagements/new
/engagements/[id]/export            /app/engagements/[id]
                                    /app/engagements/[id]/export
```

Apply via filesystem move; preserve every server action / repo / schema import.

### App nav

Same wordmark + cream bar as marketing, but right side becomes: `Engagements · Settings · Help` and an account chip (initials in a navy circle). No trial CTA.

### Engagement list — `/app`

- Page kicker: *ENGAGEMENTS* (gold small caps)
- Page title: *FY2024 Audits* (serif, navy) — derived from the most-recent FYE in the list; "All engagements" if mixed
- Header right: gold **+ New engagement** CTA
- Card per engagement: serif client name, navy chips for industry + framework, mono row for FYE / PM / CTT, footnote line for "Updated …"
- Empty state: white card centered, friendly copy, single CTA inside

### Engagement detail — `/app/engagements/[id]`

- Breadcrumb: `← Engagements`
- Header: serif client name (navy), inline chips (framework, industry), mono FYE
- Header right: **Export JSON** (gold outline) + **Delete** (crimson outline)
- Body: numbered sections in order: **1 Source files**, **2 Client + framework**, **3 Materiality**, **4 Risk profile**, **5 Business changes**
- Each section: gold step number (24px circle), small-caps navy section label, white card with the inputs
- Bottom: sticky **Save changes** CTA in gold
- Toast on save (existing sonner setup), repolished to match the palette

### Engagement create — `/app/engagements/new`

Same structure as detail page but without the file-upload section (files require an engagement id) and without the delete/export buttons. Single **Create engagement** CTA at the bottom; redirects to detail page on success (existing Server Action behavior).

### Design patterns table

| Element | Treatment |
|---|---|
| Page headings | Serif, navy, large |
| Section labels | Gold 24px step number + navy small-caps text |
| Cards | White on cream, 1px navy@10% border, 12px radius, subtle shadow |
| Inputs | White, navy@20% border, focus = 2px gold ring |
| Primary buttons | Gold fill, navy text |
| Secondary buttons | Navy outline, navy text, transparent fill |
| Chips | Navy outline, small caps |
| Numbers (money, dates) | JetBrains Mono, ink |
| Body text | Inter, ink |
| Destructive | Crimson outline, no fill |

## Architecture / build approach

1. **Tokens** — add CSS variables in `globals.css` (`--fw-navy`, `--fw-gold`, etc.). Map shadcn semantic tokens (`--primary`, `--accent`, `--background`) to point at the Fieldwork tokens so the existing shadcn components inherit the theme without per-component rewrites.
2. **Type** — add Source Serif Pro, Inter, JetBrains Mono via `next/font/google` in the root layout. Replace Geist.
3. **Component primitives** — extend the shadcn components only where the Fieldwork pattern needs more than the existing variants (e.g., add a `gold` and `goldOutline` variant to `Button`; add a numbered `<Section>` component for the detail page).
4. **Routes move** — physically move `src/app/engagements/*` to `src/app/app/engagements/*`. Update internal links + the Server Action redirect target.
5. **Marketing landing** — new `src/app/page.tsx` written from scratch as a Server Component composing the 10 sections above.
6. **Nav** — single `<SiteHeader />` component that renders the marketing variant or the app variant based on the route segment (server-side prop from the layout).

## Testing

- Existing Hartwell smoke test (`web/scripts/hartwell-smoke.mjs`) keeps passing after the routes move.
- New `web/scripts/check-routes.mjs` — curl `/`, `/app`, `/app/engagements/new` and assert 200.
- Manual: walk all four marketing screens at 1440 / 1024 / 390 widths to confirm responsive behavior.

## Risks / unknowns

- **Stat card numbers in section 4 are illustrative.** Real numbers from primary research would land harder. Acceptable for v1; flag for replacement before any paid acquisition spend.
- **Product screenshot is a placeholder.** Real Excel screenshot blocked on the add-in being built (M2).
- **Crimson hex isn't locked.** Pick during implementation, tasteful and not too saturated.
- **No auth gate on `/app` yet.** Plan still says "behind email allowlist" pre-launch; out of scope for this design polish, but won't ship publicly without it.
- **Pricing copy is straight from the PRD.** If pricing changes before launch, every CTA copy needs an audit.

## Open questions

None — all resolved during brainstorm.
