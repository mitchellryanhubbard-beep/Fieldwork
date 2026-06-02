import { NextResponse } from "next/server";
import { z } from "zod";
import {
  listGeneratedArtifacts,
  type ArtifactKind,
} from "@/lib/generated-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z
  .object({
    engagementId: z.string().uuid(),
    kind: z.enum(["binder", "matrix"]),
  })
  .strict();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    engagementId: url.searchParams.get("engagementId"),
    kind: url.searchParams.get("kind"),
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
  const artifacts = await listGeneratedArtifacts(
    parsed.data.engagementId,
    parsed.data.kind as ArtifactKind,
  );
  return NextResponse.json(
    { artifacts },
    { headers: { "Cache-Control": "no-store" } },
  );
}
