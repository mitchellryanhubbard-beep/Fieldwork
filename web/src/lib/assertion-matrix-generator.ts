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
import { parseTrialBalance, type TrialBalance } from "@/lib/tb-parser";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";

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

  // Best-effort TB parse — fall back to engagement-setup-only prompt path
  // if the file is missing or unparseable. Surface the error on the response
  // so the caller can flag it.
  let trialBalance: TrialBalance | undefined;
  let tbParseError: string | null = null;
  if (engagement.cyTrialBalanceFile.sizeBytes > 0) {
    try {
      const sb = getServerSupabase();
      const { data, error } = await sb.storage
        .from(ENGAGEMENT_FILES_BUCKET)
        .download(engagement.cyTrialBalanceFile.storagePath);
      if (error || !data) {
        throw new Error(`storage download: ${error?.message ?? "no data"}`);
      }
      const buffer = Buffer.from(await data.arrayBuffer());
      trialBalance = await parseTrialBalance(buffer);
    } catch (err) {
      tbParseError = err instanceof Error ? err.message : String(err);
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
