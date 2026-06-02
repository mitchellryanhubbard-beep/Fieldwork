import { DEFAULT_CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";
import { exportEngagement } from "@/lib/engagement-repo";
import {
  ASSERTION_MATRIX_JSON_SCHEMA,
  AssertionMatrixSchema,
  type AssertionMatrix,
} from "@/lib/assertion-matrix";
import {
  ASSERTION_MATRIX_SYSTEM_PROMPT,
  buildAssertionMatrixUserMessage,
} from "@/lib/assertion-matrix-prompt";
import type { TrialBalance } from "@/lib/tb-parser";
import { loadTrialBalanceForEngagement } from "@/lib/intake/load-canonical";

export type MatrixGenerationResult = {
  matrix: AssertionMatrix;
  tbParsed: number;
  tbParseError: string | null;
  usage: {
    inputTokens: number;
    outputTokens: number;
    cacheCreationInputTokens: number | null;
    cacheReadInputTokens: number | null;
  };
};

// Single source of truth for generating a matrix from an engagement.
// Both the JSON endpoint and the xlsx endpoint call this — the only difference
// is what they do with the result.
export async function generateAssertionMatrix(
  engagementId: string,
): Promise<MatrixGenerationResult> {
  const engagement = await exportEngagement(engagementId);

  // Best-effort canonical-TB load — falls back to engagement-setup-only
  // prompt path if not parsed. Surface a hint on the response so the
  // caller can flag the gap.
  let trialBalance: TrialBalance | undefined;
  let tbParseError: string | null = null;
  if (engagement.cyTrialBalanceFile.sizeBytes > 0) {
    const loaded = await loadTrialBalanceForEngagement(engagementId);
    if (loaded) {
      trialBalance = loaded;
    } else {
      tbParseError =
        "TB not available — confirm the upload on the Verify page or re-upload.";
    }
  }

  const client = getClaudeClient();
  const userMessage = buildAssertionMatrixUserMessage(engagement, trialBalance);

  const response = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: 16_000,
    system: ASSERTION_MATRIX_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userMessage }],
    output_config: {
      format: {
        type: "json_schema",
        schema: ASSERTION_MATRIX_JSON_SCHEMA,
      },
    },
  });

  const rawText = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    throw new Error(
      `Claude returned non-JSON output: ${err instanceof Error ? err.message : String(err)}`,
    );
  }

  const candidate: AssertionMatrix = {
    engagementId,
    generatedAt: new Date().toISOString(),
    modelVersion: response.model,
    rows: (parsedJson as { rows?: unknown }).rows as never,
    ...((parsedJson as { notes?: string }).notes
      ? { notes: (parsedJson as { notes: string }).notes }
      : {}),
  };

  const validated = AssertionMatrixSchema.safeParse(candidate);
  if (!validated.success) {
    throw new Error(
      `Matrix failed schema validation: ${validated.error.issues
        .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
        .slice(0, 10)
        .join("; ")}`,
    );
  }

  return {
    matrix: validated.data,
    tbParsed: trialBalance ? trialBalance.accounts.length : 0,
    tbParseError,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens,
    },
  };
}
