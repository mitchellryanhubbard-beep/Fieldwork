# CLAUDE.md — First-Pass

## Product
First-pass audit automation that lives natively in Excel. Replaces staff-auditor grunt work on workpaper design, scoping, lead sheets, risk and assertion mapping, substantive detail testing, and analytical procedures. Flags exceptions for human review — never auto-concludes.

## Tech Stack
- **Primary surface:** Excel (workbooks, named ranges, structured tables)
- **Automation layer:** Office.js task pane add-in (the "copilot pane")
- **AI backend:** Anthropic Claude API, called directly from the add-in (zero-retention configuration required)
- **Licensing:** Per-seat
- **Audit frameworks:** AICPA, IFRS, and PCAOB — selected per engagement in Engagement Setup
- **Landing page (optional):** Static site on Vercel
- **Test client:** Hartwell Manufacturing Co. (FY2024)

## Coding Style
- Indentation: 2 spaces
- Modules: ES modules (`import` / `export`) — no CommonJS
- Async: `async` / `await` — no `.then()` chains
- Naming: descriptive; single letters only for loop counters
- Comments: only when the WHY is non-obvious

## Project Rules
- **Excel-first:** every feature must be usable inside Excel — no separate web UI required for v1
- **Never auto-conclude:** AI flags exceptions; auditors form opinions
- **Cite sources:** every automated cell links to the source data, prompt, and reasoning used
- **Zero-retention API only:** the Anthropic API must be called with zero-retention configuration — Anthropic must not store or train on client data. Verify the setting on every code path that sends client content.
- **Audit trail required:** every test, sample selection, and exception must be reproducible from the workpaper alone
- **Validate against Hartwell FY2024:** every new capability is tested end-to-end on the Hartwell Manufacturing test client before it's called done

## Definition of Done
1. Behavior matches the PRD
2. Works end-to-end against the Hartwell Manufacturing FY2024 test workbook
3. No console or Excel errors
4. Generated workpaper passes a senior-review eye test
5. Changes committed via `/commit`
