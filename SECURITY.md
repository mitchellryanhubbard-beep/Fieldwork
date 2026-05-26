# SECURITY.md

Security rules for this project. These are non-negotiable.

## Secrets & Credentials
- Never log, print, or echo secrets, API keys, tokens, passwords, or session cookies.
- Never hardcode credentials in source, config, comments, tests, or fixtures.
- All secrets live in environment variables, loaded from `.env` (gitignored) locally or from the hosting provider's secret store in production.
- Rotate any secret that touches a public repo, a screenshot, a chat transcript, or an LLM prompt — immediately.

## Environment Variables
- `.env` is gitignored. `.env.example` is committed and contains only placeholder names with no real values.
- Do not commit `.env.local`, `.env.production`, or any variant containing real values.
- Validate required env vars at startup; fail fast with a clear message if any are missing.

## AI / LLM Usage
- The Anthropic API must be called with **zero-retention configuration**. Verify on every code path that sends user or client data.
- Never send secrets, raw credentials, or full PII to any LLM — redact or tokenize first.
- Log prompt + response metadata (token counts, model, latency) but not the raw payloads when they may contain sensitive data.

## Dependencies
- Pin direct dependencies to known-good versions.
- Run `npm audit` (or equivalent) before every release; resolve high/critical findings before shipping.
- Prefer well-maintained packages with recent commits and >1 maintainer.

## Data Handling
- Treat all user-supplied input as untrusted — validate, sanitize, and parameterize.
- Use parameterized queries for every database call. No string-concatenated SQL, ever.
- Encrypt data at rest where the hosting provider offers it; require TLS for all network traffic.

## Access & Auth
- Principle of least privilege for every service account, API token, and DB role.
- Multi-factor authentication on every account with production access.
- Revoke access immediately when someone leaves the project.

## Incident Response
- If a secret leaks: rotate it, audit access logs, document the incident.
- If a vulnerability is found: fix it on a private branch, ship the patch, then disclose.

## Code Review
- Every change touching auth, payments, secret handling, or LLM calls requires a second pair of eyes before merge.
