import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAssertionMatrix } from "@/lib/assertion-matrix-generator";

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

  try {
    const result = await generateAssertionMatrix(parsed.data.engagementId);
    return NextResponse.json({
      ok: true,
      matrix: result.matrix,
      tbParsed: result.tbParsed,
      tbParseError: result.tbParseError,
      pyAuditAttached: result.pyAuditAttached,
      pyAuditError: result.pyAuditError,
      usage: result.usage,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
