import { NextResponse } from "next/server";
import { z } from "zod";
import {
  downloadGeneratedArtifact,
  type ArtifactKind,
} from "@/lib/generated-artifacts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z
  .object({
    engagementId: z.string().uuid(),
    kind: z.enum(["binder", "matrix"]),
    path: z.string().min(1),
  })
  .strict();

export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    engagementId: url.searchParams.get("engagementId"),
    kind: url.searchParams.get("kind"),
    path: url.searchParams.get("path"),
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
  const result = await downloadGeneratedArtifact({
    engagementId: parsed.data.engagementId,
    kind: parsed.data.kind as ArtifactKind,
    path: parsed.data.path,
  });
  if (!result) {
    return NextResponse.json(
      { error: "Artifact not found or path is outside this engagement" },
      { status: 404 },
    );
  }
  return new NextResponse(new Uint8Array(result.buffer), {
    status: 200,
    headers: {
      "Content-Type": result.contentType,
      "Content-Disposition": `attachment; filename="${result.filename}"`,
      "Cache-Control": "no-store",
    },
  });
}
