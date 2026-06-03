import { DEFAULT_CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";
import {
  downloadEngagementFile,
  exportEngagement,
} from "@/lib/engagement-repo";
import {
  ASSERTION_MATRIX_JSON_SCHEMA,
  AssertionMatrixSchema,
  type AssertionMatrix,
} from "@/lib/assertion-matrix";
import {
  ASSERTION_MATRIX_SYSTEM_PROMPT,
  buildAssertionMatrixUserMessage,
  type PyAuditAttachment,
} from "@/lib/assertion-matrix-prompt";
import type { TrialBalance } from "@/lib/tb-parser";
import { loadTrialBalanceForEngagement } from "@/lib/intake/load-canonical";

export type MatrixGenerationResult = {
  matrix: AssertionMatrix;
  tbParsed: number;
  tbParseError: string | null;
  pyAuditAttached: boolean;
  pyAuditError: string | null;
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

  // PY audit attachment — pulled from storage and handed to Claude as a
  // document block so the signed opinion + financials feed every matrix
  // generation. PDF only; other types fall through with a surfaced note.
  let pyAudit: PyAuditAttachment | undefined;
  let pyAuditError: string | null = null;
  const pyMeta = engagement.pyAuditFile;
  if (pyMeta.contentType === "application/pdf") {
    try {
      const bytes = await downloadEngagementFile(pyMeta.storagePath);
      pyAudit = {
        bytes,
        contentType: pyMeta.contentType,
        filename: pyMeta.originalFilename,
      };
    } catch (err) {
      pyAuditError = `PY audit download failed: ${err instanceof Error ? err.message : String(err)}`;
    }
  } else {
    pyAuditError = `PY audit content-type ${pyMeta.contentType} not supported — upload a PDF to feed it into the matrix.`;
  }

  const client = getClaudeClient();
  const userContent = buildAssertionMatrixUserMessage(
    engagement,
    trialBalance,
    pyAudit,
  );

  const response = await client.messages.create({
    model: DEFAULT_CLAUDE_MODEL,
    max_tokens: 16_000,
    system: ASSERTION_MATRIX_SYSTEM_PROMPT,
    messages: [{ role: "user", content: userContent }],
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
    pyAuditAttached: !!pyAudit,
    pyAuditError,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens,
    },
  };
}
