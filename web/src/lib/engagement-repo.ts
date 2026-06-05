import { randomUUID } from "node:crypto";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/ssr";
import {
  EngagementSetupSchema,
  type EngagementSetup,
  type EngagementFormValues,
} from "@/lib/engagement-schema";

const SCHEMA_VERSION = "1.0.0" as const;

type FileKind =
  | "py_audit"
  | "cy_tb"
  | "ar_aging"
  | "py_ar_aging"
  | "subsequent_cash_receipts";

// py_audit is stored as evidence but isn't routed through the intake
// dispatcher (we don't extract structured data from the signed opinion).
function isParseableKind(
  kind: FileKind,
): kind is "ar_aging" | "py_ar_aging" | "cy_tb" | "subsequent_cash_receipts" {
  return (
    kind === "ar_aging" ||
    kind === "py_ar_aging" ||
    kind === "cy_tb" ||
    kind === "subsequent_cash_receipts"
  );
}

export type EngagementSummary = {
  id: string;
  clientName: string;
  fiscalYearEnd: string;
  framework: string;
  industry: string;
  updatedAt: string;
};

export async function listEngagements(): Promise<EngagementSummary[]> {
  const sb = getServerSupabase();
  const user = await getCurrentUser();
  if (!user) return [];
  // Order by creation time so the visible numbering on /app stays static:
  // oldest engagement is #1, second oldest #2, etc. Saving an engagement
  // would otherwise bubble it to the top under an updated_at sort.
  const { data, error } = await sb
    .from("engagements")
    .select(
      "id, client_name, fiscal_year_end, framework, industry, updated_at, created_at",
    )
    .eq("owner_id", user.id)
    .order("created_at", { ascending: true });

  if (error) throw new Error(`listEngagements failed: ${error.message}`);

  return (data ?? []).map((row) => ({
    id: row.id,
    clientName: row.client_name,
    fiscalYearEnd: row.fiscal_year_end,
    framework: row.framework,
    industry: row.industry,
    updatedAt: row.updated_at,
  }));
}

export async function createEngagement(
  values: EngagementFormValues,
): Promise<string> {
  const sb = getServerSupabase();
  const user = await getCurrentUser();
  if (!user) throw new Error("createEngagement: not signed in");
  const id = randomUUID();

  const { error: insertError } = await sb.from("engagements").insert({
    id,
    owner_id: user.id,
    client_name: values.clientName,
    fiscal_year_end: values.fiscalYearEnd,
    reporting_period_start: values.reportingPeriodStart || null,
    framework: values.framework,
    industry: values.industry,
    // Legacy columns required by the DB schema; their data is no longer
    // edited via the form (replaced by planning_questionnaire). Will be
    // dropped in a follow-up migration.
    risk_narrative: null,
    business_changes_narrative: null,
    materiality_currency: "USD",
    overall_materiality: values.overallMateriality,
    performance_materiality: values.performanceMateriality,
    clearly_trivial_threshold: values.clearlyTrivialThreshold,
    materiality_basis: "(not specified)",
    planning_questionnaire: values.planningQuestionnaire,
  });
  if (insertError) throw new Error(`createEngagement failed: ${insertError.message}`);
  return id;
}

export async function updateEngagement(
  id: string,
  values: EngagementFormValues,
): Promise<void> {
  const sb = getServerSupabase();
  const { error } = await sb
    .from("engagements")
    .update({
      client_name: values.clientName,
      fiscal_year_end: values.fiscalYearEnd,
      reporting_period_start: values.reportingPeriodStart || null,
      framework: values.framework,
      industry: values.industry,
      overall_materiality: values.overallMateriality,
      performance_materiality: values.performanceMateriality,
      clearly_trivial_threshold: values.clearlyTrivialThreshold,
      planning_questionnaire: values.planningQuestionnaire,
    })
    .eq("id", id);
  if (error) throw new Error(`updateEngagement failed: ${error.message}`);
}

export type EngagementDetail = {
  values: EngagementFormValues;
  pyAuditFile: FileMeta | null;
  cyTrialBalanceFile: FileMeta | null;
  arAgingFile: FileMeta | null;
  pyArAgingFile: FileMeta | null;
  subsequentCashReceiptsFile: FileMeta | null;
  createdAt: string;
  updatedAt: string;
};

export type FileMeta = {
  storagePath: string;
  originalFilename: string;
  contentType: string;
  sizeBytes: number;
  uploadedAt: string;
};

export async function getEngagement(id: string): Promise<EngagementDetail | null> {
  const sb = getServerSupabase();
  const user = await getCurrentUser();
  if (!user) return null;
  const { data: engagement, error } = await sb
    .from("engagements")
    .select("*")
    .eq("id", id)
    .eq("owner_id", user.id)
    .maybeSingle();
  if (error) throw new Error(`getEngagement failed: ${error.message}`);
  if (!engagement) return null;

  const filesRes = await sb
    .from("engagement_files")
    .select(
      "kind, storage_path, original_filename, content_type, size_bytes, uploaded_at",
    )
    .eq("engagement_id", id);
  if (filesRes.error)
    throw new Error(`getEngagement files: ${filesRes.error.message}`);

  const fileByKind = new Map<FileKind, FileMeta>();
  for (const row of filesRes.data ?? []) {
    fileByKind.set(row.kind as FileKind, {
      storagePath: row.storage_path,
      originalFilename: row.original_filename,
      contentType: row.content_type,
      sizeBytes: Number(row.size_bytes),
      uploadedAt: row.uploaded_at,
    });
  }

  const values: EngagementFormValues = {
    clientName: engagement.client_name,
    fiscalYearEnd: engagement.fiscal_year_end,
    reportingPeriodStart: engagement.reporting_period_start ?? "",
    framework: engagement.framework,
    industry: engagement.industry,
    planningQuestionnaire: engagement.planning_questionnaire ?? {},
    overallMateriality: Number(engagement.overall_materiality),
    performanceMateriality: Number(engagement.performance_materiality),
    clearlyTrivialThreshold: Number(engagement.clearly_trivial_threshold),
  };

  return {
    values,
    pyAuditFile: fileByKind.get("py_audit") ?? null,
    cyTrialBalanceFile: fileByKind.get("cy_tb") ?? null,
    arAgingFile: fileByKind.get("ar_aging") ?? null,
    pyArAgingFile: fileByKind.get("py_ar_aging") ?? null,
    subsequentCashReceiptsFile:
      fileByKind.get("subsequent_cash_receipts") ?? null,
    createdAt: engagement.created_at,
    updatedAt: engagement.updated_at,
  };
}

export async function deleteEngagement(id: string): Promise<void> {
  const sb = getServerSupabase();
  const detail = await getEngagement(id);
  if (detail) {
    const pathsToRemove = [
      detail.pyAuditFile?.storagePath,
      detail.cyTrialBalanceFile?.storagePath,
      detail.arAgingFile?.storagePath,
      detail.subsequentCashReceiptsFile?.storagePath,
    ].filter((p): p is string => !!p);
    if (pathsToRemove.length > 0) {
      await sb.storage.from(ENGAGEMENT_FILES_BUCKET).remove(pathsToRemove);
    }
  }
  const { error } = await sb.from("engagements").delete().eq("id", id);
  if (error) throw new Error(`deleteEngagement failed: ${error.message}`);
}

export async function uploadEngagementFile(
  engagementId: string,
  kind: FileKind,
  file: File,
): Promise<FileMeta> {
  const sb = getServerSupabase();

  // Each receptacle holds exactly one file; replacement (same name or
  // not) is the only path. No uniqueness check needed — we just swap
  // the storage path + metadata below.
  const existing = await sb
    .from("engagement_files")
    .select("storage_path")
    .eq("engagement_id", engagementId)
    .eq("kind", kind)
    .maybeSingle();

  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `engagements/${engagementId}/${kind}-${Date.now()}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();
  const bytes = Buffer.from(arrayBuffer);

  const { error: uploadError } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) throw new Error(`uploadEngagementFile failed: ${uploadError.message}`);

  if (existing.data) {
    await sb.storage
      .from(ENGAGEMENT_FILES_BUCKET)
      .remove([existing.data.storage_path]);
    const { error: updateError } = await sb
      .from("engagement_files")
      .update({
        storage_path: storagePath,
        original_filename: file.name,
        content_type: file.type || "application/octet-stream",
        size_bytes: file.size,
        uploaded_at: new Date().toISOString(),
      })
      .eq("engagement_id", engagementId)
      .eq("kind", kind);
    if (updateError) throw new Error(`uploadEngagementFile update failed: ${updateError.message}`);
  } else {
    const { error: insertError } = await sb.from("engagement_files").insert({
      engagement_id: engagementId,
      kind,
      storage_path: storagePath,
      original_filename: file.name,
      content_type: file.type || "application/octet-stream",
      size_bytes: file.size,
    });
    if (insertError) throw new Error(`uploadEngagementFile insert failed: ${insertError.message}`);
  }

  // Intake: for parseable kinds (ar_aging, cy_tb, subsequent_cash_receipts)
  // we eagerly extract the canonical shape on upload, cache the JSON
  // alongside the original, and mark verification as pending. Replaces any
  // prior parse/verification sidecars so the auditor sees a fresh state.
  if (isParseableKind(kind)) {
    const { runIntakeOnUpload } = await import("@/lib/intake/dispatch");
    const { deleteParseSidecar } = await import("@/lib/intake/storage");
    await deleteParseSidecar(engagementId, kind);
    // Don't throw on parse failure — the verification record is written
    // either way, and the UI surfaces the failure path (manual mapping).
    await runIntakeOnUpload({
      engagementId,
      kind,
      originalFilename: file.name,
      mime: file.type || null,
      bytes,
    });
  }

  return {
    storagePath,
    originalFilename: file.name,
    contentType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    uploadedAt: new Date().toISOString(),
  };
}

export async function getEngagementFileSignedUrl(
  storagePath: string,
  expiresInSeconds = 300,
): Promise<string> {
  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .createSignedUrl(storagePath, expiresInSeconds);
  if (error || !data?.signedUrl)
    throw new Error(`signed URL failed: ${error?.message ?? "unknown"}`);
  return data.signedUrl;
}

export async function downloadEngagementFile(
  storagePath: string,
): Promise<Buffer> {
  const sb = getServerSupabase();
  const { data, error } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .download(storagePath);
  if (error || !data)
    throw new Error(`download failed: ${error?.message ?? "unknown"}`);
  return Buffer.from(await data.arrayBuffer());
}

// Produces a schema-conformant export object. Throws if required files are missing.
export async function exportEngagement(id: string): Promise<EngagementSetup> {
  const detail = await getEngagement(id);
  if (!detail) throw new Error(`Engagement ${id} not found`);
  if (!detail.pyAuditFile)
    throw new Error("Cannot export — PY Audit file has not been uploaded yet");
  if (!detail.cyTrialBalanceFile)
    throw new Error("Cannot export — CY Trial Balance file has not been uploaded yet");

  const v = detail.values;
  const result: EngagementSetup = {
    schemaVersion: SCHEMA_VERSION,
    engagementId: id,
    client: {
      name: v.clientName,
      fiscalYearEnd: v.fiscalYearEnd,
      ...(v.reportingPeriodStart
        ? { reportingPeriodStart: v.reportingPeriodStart }
        : {}),
    },
    framework: v.framework,
    industry: v.industry,
    pyAuditFile: detail.pyAuditFile,
    cyTrialBalanceFile: detail.cyTrialBalanceFile,
    planningQuestionnaire: v.planningQuestionnaire,
    materiality: {
      currency: "USD",
      overallMateriality: v.overallMateriality,
      performanceMateriality: v.performanceMateriality,
      clearlyTrivialThreshold: v.clearlyTrivialThreshold,
    },
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };

  // Validate before returning so the contract is enforced at every export.
  return EngagementSetupSchema.parse(result);
}
