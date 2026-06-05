import Anthropic from "@anthropic-ai/sdk";

// Default model for First-Pass. Picked deliberately: assertion-risk mapping,
// workpaper generation, and exception flagging are all judgment-adjacent
// reasoning tasks where higher capability pays off, and the per-engagement
// volume is moderate. Override per call site if a workflow genuinely benefits
// from Sonnet (e.g. high-volume rote extraction).
export const DEFAULT_CLAUDE_MODEL = "claude-opus-4-7" as const;

let cached: Anthropic | null = null;

// Lazy singleton — defer construction until first use so build / dev start
// doesn't fail when ANTHROPIC_API_KEY is intentionally absent (e.g. CI types
// check, marketing-only routes).
export function getClaudeClient(): Anthropic {
  if (cached) return cached;

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not configured. Set it in web/.env.local. " +
        "See web/.env.example for the required variable + the zero-retention requirement.",
    );
  }

  // Retry generously. The SDK default is 2; we bump to 6 because
  // Anthropic's 529 "overloaded" responses are bursty during high-
  // traffic windows and a single failure on a long workpaper-gen
  // call wastes minutes. Backoff is exponential with jitter by
  // default (~0.5s → 1s → 2s → 4s → 8s → 16s ≈ 30s total cap).
  cached = new Anthropic({ apiKey, maxRetries: 6 });
  return cached;
}

// CRITICAL — zero-retention reminder.
//
// Anthropic's zero-retention setting is configured at the ORGANIZATION level
// in the Anthropic Console (Settings → Privacy → "Do not store or train on
// my data"). It applies to every API call made with keys from that org, and
// cannot be toggled per-request.
//
// PRD.md and CLAUDE.md both require zero-retention for any code path that
// sends client engagement data to Claude. Verify the org-level setting in
// the Console before pointing this key at a real client engagement.
//
// If zero-retention is not enabled, this app must NOT be used with real
// client data. There is no way to detect the org setting from the SDK
// response — the verification is manual and operational.
export const ZERO_RETENTION_NOTE =
  "Verify zero-retention is enabled at https://console.anthropic.com/settings/privacy " +
  "before sending any client engagement data through this app.";
