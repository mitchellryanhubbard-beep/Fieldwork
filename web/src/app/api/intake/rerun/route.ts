import { NextResponse } from "next/server";
import { z } from "zod";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { runIntakeOnUpload } from "@/lib/intake/dispatch";
import { PARSEABLE_KINDS, type ParseableKind } from "@/lib/intake/canonical";
import { loadParsedCanonical } from "@/lib/intake/storage";

// Force-runs the intake dispatcher against an existing supporting-schedule
// upload. Useful when:
//   - a file was uploaded before the intake layer existed
//   - the parser improved and the auditor wants a fresh extraction
//   - testing PDF/CSV flows without re-uploading
//
// Auth note (M3): currently service-role only — server-side execution
// inside Next. v1+M3 will add proper per-firm auth.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const BodySchema = z
  .object({
    engagementId: z.string().uuid(),
    kind: z.enum(["ar_aging", "cy_tb", "subsequent_cash_receipts"]),
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

  const parsed = BodySchema.safeParse(body);
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
  const { engagementId, kind } = parsed.data;
  if (!(PARSEABLE_KINDS as string[]).includes(kind)) {
    return NextResponse.json({ error: `Unknown kind: ${kind}` }, { status: 400 });
  }

  const sb = getServerSupabase();
  const { data: row, error: rowError } = await sb
    .from("engagement_files")
    .select("storage_path, original_filename, content_type")
    .eq("engagement_id", engagementId)
    .eq("kind", kind)
    .maybeSingle();
  if (rowError || !row) {
    return NextResponse.json(
      { error: `No ${kind} file found for this engagement.` },
      { status: 404 },
    );
  }

  const dl = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(row.storage_path);
  if (dl.error || !dl.data) {
    return NextResponse.json(
      { error: `Storage download failed: ${dl.error?.message ?? "no data"}` },
      { status: 500 },
    );
  }
  const bytes = Buffer.from(await dl.data.arrayBuffer());

  const result = await runIntakeOnUpload({
    engagementId,
    kind: kind as ParseableKind,
    originalFilename: row.original_filename,
    mime: row.content_type ?? null,
    bytes,
  });

  const summary: Record<string, unknown> = {
    ok: result.ok,
    verification: result.verification,
  };
  if (result.ok) {
    const canonical = await loadParsedCanonical(
      engagementId,
      kind as ParseableKind,
    );
    if (kind === "ar_aging" && canonical) {
      const c = canonical as {
        asOfDate: string | null;
        customers: unknown[];
        invoices: unknown[];
        total: number;
      };
      summary.summary = {
        asOfDate: c.asOfDate,
        customers: c.customers.length,
        invoices: c.invoices.length,
        total: c.total,
      };
    }
  }
  return NextResponse.json(summary, { status: 200 });
}
