import { randomUUID } from "node:crypto";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";

// Repository for prior-year workpapers — one row per uploaded PY xlsx.
// Lives in its own table (engagement_py_workpapers) because the existing
// engagement_files table is keyed on (engagement_id, kind) and PY
// workpapers are many-per-engagement.
//
// Per the py-rollforward memory: PY workpapers are templates we preserve,
// not data we normalize into canonical JSON. They route around the
// intake layer entirely.

export type PyWorkpaper = {
  id: string;
  storagePath: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  fsli: string | null;
  fsliTaggedAt: string | null;
  generatedCyStoragePath: string | null;
  generatedCyAt: string | null;
  uploadedAt: string;
};

export async function uploadPyWorkpaper(
  engagementId: string,
  file: File,
): Promise<PyWorkpaper> {
  const sb = getServerSupabase();
  const id = randomUUID();
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `engagements/${engagementId}/py-workpapers/${id}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) {
    throw new Error(`PY workpaper upload failed: ${uploadError.message}`);
  }

  const { data, error } = await sb
    .from("engagement_py_workpapers")
    .insert({
      id,
      engagement_id: engagementId,
      storage_path: storagePath,
      original_filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    })
    .select()
    .single();
  if (error) throw new Error(`PY workpaper insert failed: ${error.message}`);

  return rowToPyWorkpaper(data);
}

export async function listPyWorkpapers(
  engagementId: string,
): Promise<PyWorkpaper[]> {
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("engagement_py_workpapers")
    .select("*")
    .eq("engagement_id", engagementId)
    .order("uploaded_at", { ascending: true });
  if (error) throw new Error(`listPyWorkpapers failed: ${error.message}`);
  return (data ?? []).map(rowToPyWorkpaper);
}

export async function getPyWorkpaper(
  id: string,
): Promise<{ engagementId: string; wp: PyWorkpaper } | null> {
  const sb = getServerSupabase();
  const { data, error } = await sb
    .from("engagement_py_workpapers")
    .select("*, engagement_id")
    .eq("id", id)
    .maybeSingle();
  if (error || !data) return null;
  return {
    engagementId: data.engagement_id,
    wp: rowToPyWorkpaper(data),
  };
}

export async function deletePyWorkpaper(id: string): Promise<void> {
  const sb = getServerSupabase();
  const existing = await getPyWorkpaper(id);
  if (!existing) return;
  const pathsToRemove = [
    existing.wp.storagePath,
    existing.wp.generatedCyStoragePath,
  ].filter((p): p is string => !!p);
  if (pathsToRemove.length > 0) {
    await sb.storage.from(ENGAGEMENT_FILES_BUCKET).remove(pathsToRemove);
  }
  const { error } = await sb
    .from("engagement_py_workpapers")
    .delete()
    .eq("id", id);
  if (error) throw new Error(`deletePyWorkpaper failed: ${error.message}`);
}

export async function setPyWorkpaperFsli(
  id: string,
  fsli: string | null,
): Promise<void> {
  const sb = getServerSupabase();
  const { error } = await sb
    .from("engagement_py_workpapers")
    .update({
      fsli,
      fsli_tagged_at: fsli ? new Date().toISOString() : null,
    })
    .eq("id", id);
  if (error) throw new Error(`setPyWorkpaperFsli failed: ${error.message}`);
}

// Removes ONLY the generated CY workpaper for a PY file — leaves the PY
// row + storage intact so the auditor can re-roll-forward.
export async function clearPyWorkpaperGeneratedCy(id: string): Promise<void> {
  const sb = getServerSupabase();
  const existing = await getPyWorkpaper(id);
  if (!existing) return;
  if (existing.wp.generatedCyStoragePath) {
    await sb.storage
      .from(ENGAGEMENT_FILES_BUCKET)
      .remove([existing.wp.generatedCyStoragePath]);
  }
  const { error } = await sb
    .from("engagement_py_workpapers")
    .update({
      generated_cy_storage_path: null,
      generated_cy_at: null,
    })
    .eq("id", id);
  if (error)
    throw new Error(`clearPyWorkpaperGeneratedCy failed: ${error.message}`);
}

export async function setPyWorkpaperGeneratedCy(
  id: string,
  storagePath: string,
): Promise<void> {
  const sb = getServerSupabase();
  const { error } = await sb
    .from("engagement_py_workpapers")
    .update({
      generated_cy_storage_path: storagePath,
      generated_cy_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error)
    throw new Error(`setPyWorkpaperGeneratedCy failed: ${error.message}`);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToPyWorkpaper(row: any): PyWorkpaper {
  return {
    id: row.id,
    storagePath: row.storage_path,
    originalFilename: row.original_filename,
    contentType: row.content_type,
    sizeBytes: Number(row.size_bytes),
    fsli: row.fsli,
    fsliTaggedAt: row.fsli_tagged_at,
    generatedCyStoragePath: row.generated_cy_storage_path,
    generatedCyAt: row.generated_cy_at,
    uploadedAt: row.uploaded_at,
  };
}
