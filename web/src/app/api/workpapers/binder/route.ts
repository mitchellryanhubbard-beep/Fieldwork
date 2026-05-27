import { NextResponse } from "next/server";
import { z } from "zod";
import { generateBinder } from "@/lib/workpaper-binder-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

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
    const { buffer, filename } = await generateBinder(parsed.data.engagementId);
    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${filename}"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const status = message.includes("not found") ? 404 : 502;
    return NextResponse.json({ error: message }, { status });
  }
}
