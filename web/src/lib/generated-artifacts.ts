import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";

// Persists generated artifacts (audit binders, assertion matrices)
// under a stable engagement folder so the UI can list and re-download
// without re-running the heavy generation step.
//
// Layout:
//   engagements/{engagementId}/generated/{kind}/{ISO-timestamp}_{filename}
//
// `kind` is the artifact type ("binder" or "matrix"); the timestamp is
// embedded in the path so listings can be sorted by recency, and the
// original filename is preserved for download.

export type ArtifactKind = "binder" | "matrix";

export type GeneratedArtifact = {
  path: string;
  filename: string;
  generatedAt: string; // ISO timestamp
  sizeBytes: number;
};

export function artifactFolder(
  engagementId: string,
  kind: ArtifactKind,
): string {
  return `engagements/${engagementId}/generated/${kind}`;
}

export async function saveGeneratedArtifact(args: {
  engagementId: string;
  kind: ArtifactKind;
  buffer: Buffer;
  filename: string;
  contentType: string;
}): Promise<GeneratedArtifact> {
  const sb = getServerSupabase();
  const generatedAt = new Date().toISOString();
  // Strip ':' from timestamp so the path stays portable.
  const safeStamp = generatedAt.replace(/[:]/g, "-");
  const path = `${artifactFolder(args.engagementId, args.kind)}/${safeStamp}_${args.filename}`;
  const { error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(path, args.buffer, {
      contentType: args.contentType,
      upsert: false,
    });
  if (error) {
    throw new Error(`Save ${args.kind} artifact failed: ${error.message}`);
  }
  return {
    path,
    filename: args.filename,
    generatedAt,
    sizeBytes: args.buffer.length,
  };
}

export async function listGeneratedArtifacts(
  engagementId: string,
  kind: ArtifactKind,
): Promise<GeneratedArtifact[]> {
  const sb = getServerSupabase();
  const folder = artifactFolder(engagementId, kind);
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .list(folder, { limit: 100, sortBy: { column: "created_at", order: "desc" } });
  if (error || !data) return [];
  const artifacts: GeneratedArtifact[] = [];
  for (const f of data) {
    if (!f.name) continue;
    // Parse the leading ISO timestamp out of the filename.
    const m = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z)_(.+)$/.exec(
      f.name,
    );
    const generatedAt = m
      ? m[1].replace(/T(\d{2})-(\d{2})-(\d{2})/, "T$1:$2:$3")
      : f.created_at ?? "";
    const filename = m ? m[2] : f.name;
    artifacts.push({
      path: `${folder}/${f.name}`,
      filename,
      generatedAt,
      sizeBytes: f.metadata?.size ?? 0,
    });
  }
  artifacts.sort((a, b) => b.generatedAt.localeCompare(a.generatedAt));
  return artifacts;
}

export async function downloadGeneratedArtifact(args: {
  engagementId: string;
  kind: ArtifactKind;
  path: string;
}): Promise<{ buffer: Buffer; filename: string; contentType: string } | null> {
  // Guard: path must live under this engagement's folder for this kind.
  const expectedPrefix = `${artifactFolder(args.engagementId, args.kind)}/`;
  if (!args.path.startsWith(expectedPrefix)) return null;

  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(args.path);
  if (error || !data) return null;

  const bytes = Buffer.from(await data.arrayBuffer());
  const name = args.path.slice(args.path.lastIndexOf("/") + 1);
  const m = /^(\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(?:\.\d+)?Z)_(.+)$/.exec(name);
  const filename = m ? m[2] : name;
  return {
    buffer: bytes,
    filename,
    contentType:
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  };
}
