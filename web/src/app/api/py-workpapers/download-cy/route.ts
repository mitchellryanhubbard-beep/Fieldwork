import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { getPyWorkpaper } from "@/lib/py-workpaper-repo";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const QuerySchema = z.object({
  pyWorkpaperId: z.string().uuid(),
});

// Streams the previously-generated CY workpaper from storage so the auditor
// can re-download without re-running the generator (same pattern as
// loadAccountWorkpaperById on the per-account workpaper side).
export async function GET(req: Request) {
  const url = new URL(req.url);
  const parsed = QuerySchema.safeParse({
    pyWorkpaperId: url.searchParams.get("pyWorkpaperId") ?? "",
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

  const ref = await getPyWorkpaper(parsed.data.pyWorkpaperId);
  if (!ref || !ref.wp.generatedCyStoragePath) {
    return NextResponse.json(
      { error: "No CY workpaper has been generated for this PY file yet." },
      { status: 404 },
    );
  }

  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(ref.wp.generatedCyStoragePath);
  if (error || !data) {
    return NextResponse.json(
      { error: `Storage download failed: ${error?.message ?? "no data"}` },
      { status: 500 },
    );
  }
  const buffer = Buffer.from(await data.arrayBuffer());
  const safeBase = ref.wp.originalFilename.replace(/\.[a-z0-9]+$/i, "");
  return new NextResponse(new Uint8Array(buffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${safeBase}_CY.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
