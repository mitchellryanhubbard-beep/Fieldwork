import { NextResponse } from "next/server";
import { z } from "zod";
import { DEFAULT_CLAUDE_MODEL, getClaudeClient } from "@/lib/claude";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Minimal passthrough shape — enough to smoke-test the wiring and serve as
// the building block for typed endpoints (assertion matrix, workpaper
// generation, etc.). Per-feature endpoints will lock down their own
// request/response schemas and stop accepting freeform prompts.
const RequestSchema = z
  .object({
    prompt: z.string().min(1).max(50_000),
    system: z.string().max(50_000).optional(),
    model: z.string().min(1).optional(),
    maxTokens: z.number().int().positive().max(64_000).optional(),
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
      { error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") },
      { status: 400 },
    );
  }

  const { prompt, system, model, maxTokens } = parsed.data;

  let client;
  try {
    client = getClaudeClient();
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }

  try {
    const response = await client.messages.create({
      model: model ?? DEFAULT_CLAUDE_MODEL,
      max_tokens: maxTokens ?? 4096,
      ...(system ? { system } : {}),
      messages: [{ role: "user", content: prompt }],
    });

    const text = response.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("");

    return NextResponse.json({
      ok: true,
      model: response.model,
      stopReason: response.stop_reason,
      text,
      usage: {
        inputTokens: response.usage.input_tokens,
        outputTokens: response.usage.output_tokens,
        cacheCreationInputTokens: response.usage.cache_creation_input_tokens,
        cacheReadInputTokens: response.usage.cache_read_input_tokens,
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
}
