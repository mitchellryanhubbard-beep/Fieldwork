# Plan — Fieldwork

## Goal
Ship a working **Engagement Setup web app** as Milestone 1 — the data-capture surface that feeds every downstream Fieldwork capability (assertion-risk matrix, workpaper generation, substantive and analytical testing).

## Approach
Build outside-in: capture the inputs first (Engagement Setup), then the planning artifact (Assertion-Risk Matrix), then the workpapers, then the tests. Each milestone produces a real deliverable that can be validated end-to-end against Hartwell Manufacturing FY2024 before the next one starts. The Engagement Setup lives on the web because it's a one-time per-engagement intake; everything downstream lives in Excel via an Office.js add-in, per the Excel-first rule in CLAUDE.md.

## Architecture / Key Decisions
- **Excel-first product, web intake:** Engagement Setup is a small web app; all downstream artifacts (matrix, workpapers, tests) live in Excel via Office.js add-in. Reason: intake is one-time per engagement, but auditors work daily in Excel.
- **Anthropic Claude API, zero-retention:** All AI calls use zero-retention configuration. Reason: client data cannot be stored or trained on — required for firm independence and client trust.
- **Credential-server proxy from day one:** A Fieldwork-owned backend proxies all Claude API calls — auditors never handle Anthropic keys directly. Reason: the beta needs to be production-shaped before anything is sold; firms expect centrally managed credentials.
- **Persistence on Supabase:** All Engagement Setup form data and uploaded files (PY Audit PDFs, CY TBs) live in Supabase (Postgres + Storage). Reason: matches existing project tooling and gives row-level security for per-engagement isolation.
- **Engagement Setup → add-in contract:** Schema lives at `specs/engagement-setup.schema.json` and is the single source of truth for both the web app's output and the add-in's input. Reason: lock the seam early so the two surfaces can be built in parallel without drift.
- **Framework + industry dropdowns:** Engagement Setup selects audit framework (AICPA, IFRS, PCAOB, …) and industry (Manufacturing, SaaS, NFP, Consumer Business, Real Estate, …) to pick the right template variant. Reason: workpapers and assertion mapping differ materially by both.
- **Hartwell FY2024 as canonical test fixture:** Every milestone is validated end-to-end against `C:\Users\mitch\OneDrive\Documents\Fieldwork.ai\Testing`. Reason: CLAUDE.md Definition of Done #2.

## Milestones
1. **Engagement Setup (web app)** — Captures PY Audit, CY TB, CY Risk Profile, CY Significant Business Changes, CY Materiality, Performance Materiality, Clearly Trivial Threshold. Proves: we can intake everything needed to plan an audit.
2. **Assertion-Risk Matrix (Excel, add-in generated)** — From Engagement Setup inputs, generates a matrix mapping every account: account type, CY/PY balances, risks, relevant assertions, PY exceptions, planned testing approach (detail vs. analytic). Proves: we can plan an audit from captured data.
3. **Workpaper generation (Excel)** — From the matrix + Engagement Setup, generates lead sheets, scoping documents, and per-account workpaper shells. Proves: we can stand up the audit binder.
4. **Substantive + analytical testing procedures** — Executes sample selection, tickmarks, ratio/variance analysis, exception flagging on each workpaper. Proves: we can do the work first-year staff does today.

## Work Breakdown

### Milestone 1: Engagement Setup (web app)
- [ ] Write the JSON schema at `specs/engagement-setup.schema.json` — this is the contract for everything downstream
  - **DONE WHEN:** schema file exists and validates a hand-built Hartwell FY2024 sample object with no errors
- [ ] Scaffold Next.js app on Vercel
  - **DONE WHEN:** app is deployed to a Vercel URL, loads without console errors, and is gated behind the email allowlist
- [ ] Provision Supabase project: Postgres tables + Storage buckets for uploaded files
  - **DONE WHEN:** tables and buckets exist, RLS is enabled per-engagement, and a test row + test file can be written and read from the app
- [ ] Build intake form: audit framework dropdown, industry dropdown
  - **DONE WHEN:** both dropdowns render with the full option lists (AICPA/IFRS/PCAOB + Manufacturing/SaaS/NFP/Consumer/Real Estate) and selections persist on save
- [ ] File upload: PY Audit (PDF — signed audit opinion + accompanying issued financial statements only, not the full prior-year binder), CY TB (Excel/CSV) → Supabase Storage
  - **DONE WHEN:** Hartwell PY Audit PDF and CY TB upload successfully, appear in Supabase Storage, and re-download byte-identical
- [ ] Forms: CY Risk Profile, CY Significant Business Changes, Materiality, PM, CTT
  - **DONE WHEN:** every field captures, validates (numeric where required), and round-trips on reload
- [ ] Persist captured data + uploaded files keyed by engagement
  - **DONE WHEN:** reopening an engagement returns all form data + file references identical to what was saved
- [ ] Export captured engagement matching `engagement-setup.schema.json`
  - **DONE WHEN:** exported JSON for a Hartwell engagement validates against the schema and is non-empty for every required field
- [ ] Validate end-to-end against Hartwell Manufacturing FY2024 (manually compare captured data to `Hartwell Manufacturing Engagement Setup.xlsx`)
  - **DONE WHEN:** every field in the captured Hartwell engagement matches the reference workbook, with any deltas explicitly explained

### Milestone 2: Assertion-Risk Matrix
- [ ] **Credential-server proxy:** stand up the Fieldwork backend that holds the Anthropic key, enforces zero-retention, and authenticates per-seat callers
  - **DONE WHEN:** authenticated callers get a Claude response, unauthenticated callers get 401, and every outbound request is verified to carry the zero-retention header
- [ ] Office.js add-in scaffold (manifest, task pane, dev cert)
  - **DONE WHEN:** add-in sideloads in Excel desktop, task pane opens without errors, and dev cert is trusted locally
- [ ] Wire add-in to read Engagement Setup output from Supabase via the credential server
  - **DONE WHEN:** add-in displays the Hartwell engagement (framework, industry, materiality, PM, CTT) pulled live from Supabase
- [ ] Add-in → credential server → Claude (no direct Anthropic calls from the add-in)
  - **DONE WHEN:** a grep of the add-in bundle returns zero matches for `api.anthropic.com` or the Anthropic SDK, and a test call succeeds through the proxy
- [ ] Prompt: generate assertion-risk matrix from engagement inputs
  - **DONE WHEN:** prompt returns structured JSON with one row per significant account, each row containing account type, CY/PY balances, risks, relevant assertions, PY exceptions, and planned approach
- [ ] Render matrix into a structured Excel sheet (table with named ranges)
  - **DONE WHEN:** matrix appears as a real Excel Table with named ranges, on a sheet that survives save/close/reopen without losing structure
- [ ] Cite source for each row (which input drove which assertion/risk)
  - **DONE WHEN:** every matrix row has a non-empty citation column pointing to the specific Engagement Setup input that drove it
- [ ] Validate against `Hartwell Assertion Plan FY2024.xlsx`
  - **DONE WHEN:** generated matrix matches the Hartwell reference on account coverage, with assertion/risk deltas explicitly reviewed and accepted

### Milestone 3: Workpaper generation
- [ ] Lead sheet generator (one per significant FSLI)
  - **DONE WHEN:** every Hartwell significant FSLI has a generated lead sheet that ties to the TB total
- [ ] Scoping document generator (materiality, PM, CTT, account selection)
  - **DONE WHEN:** scoping doc shows all three thresholds + the account-selection list, and the math reproduces from Engagement Setup inputs
- [ ] Per-account workpaper shells driven by matrix
  - **DONE WHEN:** one shell exists per matrix row, pre-populated with account, balances, assertions, and planned approach
- [ ] PBC (Prepared By Client) request list generator — driven by the matrix's planned testing approach (one entry per item the client must provide)
  - **DONE WHEN:** PBC list has one entry per testing item in the matrix, each citing the workpaper that needs it
- [ ] PBC request email drafter — generates ready-to-send emails grouped by client contact, citing each requested item back to the workpaper that needs it
  - **DONE WHEN:** drafts open one email per client contact, each listing only their items with workpaper citations, ready to send without edits
- [ ] Senior-review eye test on Hartwell output (workpapers + PBC list + draft emails)
  - **DONE WHEN:** senior-review pass produces zero structural rework notes (content notes are fine)

### Milestone 4: Substantive + analytical testing
- [ ] Sample selection routines (per testing approach in matrix)
  - **DONE WHEN:** each matrix row marked for detail testing gets a reproducible sample (same seed → same selection) sized per the approach
- [ ] Tickmark application
  - **DONE WHEN:** every tested item carries a tickmark, and the tickmark legend on each workpaper resolves every symbol used
- [ ] Ratio + period-over-period variance with threshold flagging
  - **DONE WHEN:** ratios + variances compute on Hartwell, anything exceeding threshold is flagged, and thresholds trace to Engagement Setup
- [ ] Exception report consolidation
  - **DONE WHEN:** a single exception report lists every flagged item across all workpapers with workpaper back-reference
- [ ] Validate exception coverage ≥95% on Hartwell vs. manual senior review
  - **DONE WHEN:** measured coverage ≥95% against the manual senior-review baseline, with any misses documented

## Risks
- **Scope creep on Engagement Setup:** It's tempting to keep adding fields. Mitigation: lock the v1 input list to what the assertion-risk matrix actually needs — anything else waits.
- **Web app ↔ Excel handoff is the seam:** If the intake output and the add-in's expected input drift, nothing works. Mitigation: define the JSON schema once, store it in `specs/`, and treat it as the contract.
- **Claude output quality on assertion mapping:** Could hallucinate assertions or miss risks. Mitigation: cite source for every row, never auto-conclude, build the validator against `Hartwell Assertion Plan FY2024.xlsx` early.
- **Excel add-in cert + sideload friction:** Office.js dev/distribution has setup pain. Mitigation: budget time for it in Milestone 2 — don't discover it late.
- **Zero-retention configuration regression:** Easy to miss on a new code path. Mitigation: a single Claude client wrapper that's the only way the codebase calls the API; assert zero-retention in the wrapper.

## Test Plan
- **Unit:** Input validators (TB file shape, materiality math), Claude client wrapper (zero-retention header present)
- **Integration:** Engagement Setup → JSON contract → add-in read; matrix generation against Hartwell inputs produces matrix matching `Hartwell Assertion Plan FY2024.xlsx`
- **Manual:** Senior-review eye test on every generated workpaper; full Hartwell FY2024 run-through at the end of each milestone

## Rollout
- **Pre-launch:** Hartwell-only; no real client data; web app behind email allowlist
- **Launch (v1 beta):** 3–5 friendly mid-tier firms; per-seat trial; Claude calls proxied through Fieldwork credential server
- **Post-launch:** Watch for senior-review rework rate, exception miss rate, API error rate, time-to-first-workpaper

## Pricing + Trial Structure

### Initial Pricing Strategy (MVP / Early Access)

Fieldwork will initially use a per-seat SaaS pricing model targeted at audit firms and internal audit departments.

#### Pricing Tiers

| Tier | Target Customer | Monthly Price | Notes |
|---|---|---|---|
| Starter | Small CPA firms (1–5 users) | $249/user/month | Limited engagements and AI runs |
| Professional | Mid-sized firms | $499/user/month | Full testing workflows and integrations |
| Enterprise | Large firms / PE-backed platforms | Custom pricing | SSO, audit logs, advanced controls, dedicated support |

### Usage Assumptions

- Each paid seat represents a staff auditor, senior, manager, or reviewer.
- Pricing is justified through:
  - reduced testing hours
  - lower realization leakage
  - reduced "eating time"
  - increased engagement capacity
  - improved audit documentation consistency

### Free Trial Structure

Fieldwork will offer:

- 14-day free trial
- No credit card required initially during beta phase
- Guided onboarding with sample audit engagement data
- Limited AI testing runs during trial period

The trial objective is to demonstrate:
- first-pass testing acceleration
- workpaper preparation efficiency
- reviewer workflow improvements

### Money-Back Guarantee

During early commercialization:

- 30-day money-back guarantee
- Intended to reduce adoption friction for smaller firms
- Enterprise contracts may instead use pilot-based proof-of-value engagements

### Enterprise Pilot Strategy

For larger firms:

- 30–90 day paid pilot engagements
- White-glove onboarding
- Success metrics established upfront:
  - reduction in audit hours
  - reduction in review notes
  - increase in engagement throughput
  - reduction in staff burnout indicators

### Long-Term Monetization Expansion

Potential future monetization layers include:

- engagement-based pricing
- AI compute usage tiers
- reviewer workflow modules
- ERP integrations
- Office.js Excel add-ins
- audit analytics packages
- industry-specific testing templates

### Strategic Pricing Philosophy

Fieldwork is positioned as a high-value professional infrastructure platform rather than a low-cost commodity AI tool.

Pricing strategy emphasizes:
- measurable ROI
- audit quality enhancement
- operational leverage
- workflow integration
- enterprise trust and governance

## Open Questions
None — all resolved as of 2026-05-26.
