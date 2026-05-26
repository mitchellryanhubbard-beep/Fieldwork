import { NextResponse } from "next/server";
import { z } from "zod";
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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;

const RequestSchema = z
  .object({
    engagementId: z.string().uuid(),
  })
  .strict();

export async function POST(req: Request) {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json(
      { error: "Body must be valid JSON" },
      { status: 400 },
    );
  }

  const parsed = RequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .join("; "),
      },
      { status: 400 },
    );
  }

  const { engagementId } = parsed.data;

  let engagement;
  try {
    engagement = await exportEngagement(engagementId);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 400;
    return NextResponse.json({ error: message }, { status });
  }

  // Best-effort TB parse — if the file is missing, empty, or unparseable
  // we fall back to the no-TB prompt path. We don't fail the matrix call
  // on a parse failure; the engagement-setup-only flow still produces a
  // reasonable first pass with a clear caveat in `notes`.
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

  let client;
  try {
    client = getClaudeClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  const userMessage = buildAssertionMatrixUserMessage(engagement, trialBalance);

  let response;
  try {
    response = await client.messages.create({
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
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status =
      err && typeof err === "object" && "status" in err && typeof err.status === "number"
        ? err.status
        : 502;
    return NextResponse.json({ error: message }, { status });
  }

  // Extract the JSON text — structured outputs still come back as text blocks.
  const rawText = response.content
    .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
    .map((b) => b.text)
    .join("");

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(rawText);
  } catch (err) {
    return NextResponse.json(
      {
        error: "Claude returned non-JSON output",
        rawText: rawText.slice(0, 2000),
        cause: err instanceof Error ? err.message : String(err),
      },
      { status: 502 },
    );
  }

  // Wrap the model's rows + notes with the metadata we own, then validate.
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
    return NextResponse.json(
      {
        error: "Matrix failed schema validation",
        issues: validated.error.issues
          .map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`)
          .slice(0, 20),
        rawSample: rawText.slice(0, 2000),
      },
      { status: 502 },
    );
  }

  return NextResponse.json({
    ok: true,
    matrix: validated.data,
    tbParsed: trialBalance ? trialBalance.accounts.length : 0,
    tbParseError,
    usage: {
      inputTokens: response.usage.input_tokens,
      outputTokens: response.usage.output_tokens,
      cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
      cacheReadInputTokens: response.usage.cache_read_input_tokens,
    },
  });
}
