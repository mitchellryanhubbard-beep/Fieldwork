# First-Pass — PRD

## Problem
Staff auditors at mid-tier firms spend the majority of their time on repetitive, non-judgment work: building workpapers, mapping risks to assertions, designing sample selections, performing detail tests, and running analytical procedures. The work is slow, error-prone, expensive, and a poor use of trained accountants — but it has to happen on every engagement.

## Goals
- Automate the non-judgment portions of audit fieldwork — workpaper design, sample selection, detail testing, analytical procedures
- Live where the work already happens: natively inside Excel
- Surface exceptions for human auditor review — never auto-conclude
- Reduce first-year staff hours on a typical mid-market private audit by 60%+

## Target Users
- **Primary:** Staff auditors (1–3 years experience) at mid-tier public accounting firms running standard private-company audits
- **Secondary:** Senior associates reviewing first-pass workpapers; audit managers scoping engagements

## Scope

**In scope (v1):**
- Delivered as an Excel copilot task pane (Office.js add-in) — the auditor never leaves Excel
- AICPA, IFRS, and PCAOB frameworks — selectable per engagement in Engagement Setup
- Excel-native workpaper generation from a chart of accounts + trial balance
- Lead sheet creation by financial statement line item
- Scoping documents: materiality calculation, performance materiality, account selection thresholds
- Risk and assertion mapping per significant account
- Substantive detail testing: sample selection, tickmark application, exception flagging
- Analytical procedures: ratio analysis, period-over-period variance, threshold-based flagging
- Drafting PBC (Prepared By Client) request emails based on the planned tests
- Exception report consolidating flagged items for auditor review

**Out of scope (v1):**
- SOX / ICFR controls testing
- IT general controls
- Multi-currency engagements
- Group audits and component auditor coordination
- Final report and opinion drafting
- Engagement acceptance and independence procedures

## Success Criteria
- A staff auditor completes first-pass fieldwork on a typical mid-market private audit in ≤50% of current hours
- ≥90% of generated workpapers pass senior review without rework of automated sections
- Exception flagging catches ≥95% of items a senior would have flagged manually (validated against Hartwell Manufacturing FY2024)
- Auditor review time is spent on exceptions, not on re-performing every test

## Risks
- **AI hallucinates audit conclusions** — mitigation: never auto-conclude; only flag exceptions for human review; cite source data on every test
- **Excel is brittle as a host for AI workflows** — mitigation: keep AI logic in an add-in or external service; Excel is the presentation and interaction layer only
- **Client data flows directly to Anthropic** (Claude API called from the add-in) — mitigation: require zero-retention API configuration; explicit per-engagement opt-in disclosure to firms; never train on client data; document data flow for firm independence review
- **No audit trail for automated work** — mitigation: every automated cell links to its source, prompt, and reasoning
- **Mid-tier firms slow to adopt new tools** — mitigation: ride the existing Excel workflow — no new UI to learn

## Key v1 Decisions (resolved)
- **Distribution:** Excel copilot task pane (Office.js add-in)
- **AI backend:** Claude API called through a First-Pass-owned credential-server proxy — auditors never handle Anthropic keys directly; zero-retention enforced server-side
- **Pricing:** Per-seat licensing — Starter $249/user/mo (1–5 users), Professional $499/user/mo, Enterprise custom. 14-day free trial (no card during beta), 30-day money-back guarantee
- **Frameworks:** AICPA, IFRS, and PCAOB — selected per engagement in Engagement Setup; templates differ by framework and industry
- **Templates:** Industry-specific variants in v1 — Engagement Setup selects framework + industry (Manufacturing, SaaS, NFP, Consumer Business, Real Estate, …) to drive workpaper and assertion-mapping templates

## Open Questions
None — all resolved as of 2026-05-26.
