import { NextResponse } from "next/server";
import { z } from "zod";
import {
  generateAccountWorkpaperById,
  loadAccountWorkpaperById,
} from "@/lib/account-workpaper-generator";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const RequestSchema = z
  .object({
    engagementId: z.string().uuid(),
    acctNum: z.string().min(1).max(40),
  })
  .strict();

const QuerySchema = z.object({
  engagementId: z.string().uuid(),
  acctNum: z.string().min(1).max(40),
});

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
    const { buffer, filename } = await generateAccountWorkpaperById(
      parsed.data.engagementId,
      parsed.data.acctNum,
    );
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
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    engagementId: url.searchParams.get("engagementId") ?? "",
    acctNum: url.searchParams.get("acctNum") ?? "",
  });
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
    const { buffer, filename } = await loadAccountWorkpaperById(
      parsed.data.engagementId,
      parsed.data.acctNum,
    );
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
    const status = /No stored workpaper/.test(message) ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  }
}
