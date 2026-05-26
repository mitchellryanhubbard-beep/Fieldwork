import { NextResponse } from "next/server";
import { z } from "zod";
import { generateAssertionMatrix } from "@/lib/assertion-matrix-generator";
import { matrixToXlsx } from "@/lib/matrix-to-xlsx";

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
    const { matrix } = await generateAssertionMatrix(parsed.data.engagementId);
    const xlsxBuffer = await matrixToXlsx(matrix);

    const ts = matrix.generatedAt.replace(/[:.]/g, "-").slice(0, 19);
    const filename = `assertion-matrix-${matrix.engagementId.slice(0, 8)}-${ts}.xlsx`;

    return new NextResponse(new Uint8Array(xlsxBuffer), {
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
