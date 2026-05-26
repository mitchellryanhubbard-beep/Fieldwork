import { randomUUID } from "node:crypto";
import {
  ENGAGEMENT_FILES_BUCKET,
  getServerSupabase,
} from "@/lib/supabase/server";
import {
  EngagementSetupSchema,
  type EngagementSetup,
  type EngagementFormValues,
} from "@/lib/engagement-schema";

const SCHEMA_VERSION = "1.0.0" as const;

type FileKind = "py_audit" | "cy_tb";

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
  const { data, error } = await sb
    .from("engagements")
    .select("id, client_name, fiscal_year_end, framework, industry, updated_at")
    .order("updated_at", { ascending: false });

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
  const id = randomUUID();

  const { error: insertError } = await sb.from("engagements").insert({
    id,
    client_name: values.clientName,
    fiscal_year_end: values.fiscalYearEnd,
    reporting_period_start: values.reportingPeriodStart || null,
    framework: values.framework,
    industry: values.industry,
    risk_narrative: values.riskNarrative ?? null,
    business_changes_narrative: values.businessChangesNarrative ?? null,
    materiality_currency: "USD",
    overall_materiality: values.overallMateriality,
    performance_materiality: values.performanceMateriality,
    clearly_trivial_threshold: values.clearlyTrivialThreshold,
    materiality_basis: values.materialityBasis,
  });
  if (insertError) throw new Error(`createEngagement failed: ${insertError.message}`);

  await replaceRiskItems(id, values.riskItems);
  await replaceBusinessChangeItems(id, values.businessChangeItems);
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
      risk_narrative: values.riskNarrative ?? null,
      business_changes_narrative: values.businessChangesNarrative ?? null,
      overall_materiality: values.overallMateriality,
      performance_materiality: values.performanceMateriality,
      clearly_trivial_threshold: values.clearlyTrivialThreshold,
      materiality_basis: values.materialityBasis,
    })
    .eq("id", id);
  if (error) throw new Error(`updateEngagement failed: ${error.message}`);

  await replaceRiskItems(id, values.riskItems);
  await replaceBusinessChangeItems(id, values.businessChangeItems);
}

async function replaceRiskItems(
  engagementId: string,
  items: EngagementFormValues["riskItems"],
) {
  const sb = getServerSupabase();
  const { error: deleteError } = await sb
    .from("engagement_risk_items")
    .delete()
    .eq("engagement_id", engagementId);
  if (deleteError) throw new Error(`replaceRiskItems delete failed: ${deleteError.message}`);

  if (items.length === 0) return;
  const rows = items.map((item, position) => ({
    engagement_id: engagementId,
    category: item.category,
    description: item.description,
    position,
  }));
  const { error: insertError } = await sb
    .from("engagement_risk_items")
    .insert(rows);
  if (insertError) throw new Error(`replaceRiskItems insert failed: ${insertError.message}`);
}

async function replaceBusinessChangeItems(
  engagementId: string,
  items: EngagementFormValues["businessChangeItems"],
) {
  const sb = getServerSupabase();
  const { error: deleteError } = await sb
    .from("engagement_business_changes")
    .delete()
    .eq("engagement_id", engagementId);
  if (deleteError)
    throw new Error(
      `replaceBusinessChangeItems delete failed: ${deleteError.message}`,
    );

  if (items.length === 0) return;
  const rows = items.map((item, position) => ({
    engagement_id: engagementId,
    category: item.category,
    description: item.description,
    position,
  }));
  const { error: insertError } = await sb
    .from("engagement_business_changes")
    .insert(rows);
  if (insertError)
    throw new Error(
      `replaceBusinessChangeItems insert failed: ${insertError.message}`,
    );
}

export type EngagementDetail = {
  values: EngagementFormValues;
  pyAuditFile: FileMeta | null;
  cyTrialBalanceFile: FileMeta | null;
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
  const { data: engagement, error } = await sb
    .from("engagements")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw new Error(`getEngagement failed: ${error.message}`);
  if (!engagement) return null;

  const [riskItemsRes, businessChangeItemsRes, filesRes] = await Promise.all([
    sb
      .from("engagement_risk_items")
      .select("category, description, position")
      .eq("engagement_id", id)
      .order("position", { ascending: true }),
    sb
      .from("engagement_business_changes")
      .select("category, description, position")
      .eq("engagement_id", id)
      .order("position", { ascending: true }),
    sb
      .from("engagement_files")
      .select("kind, storage_path, original_filename, content_type, size_bytes, uploaded_at")
      .eq("engagement_id", id),
  ]);
  if (riskItemsRes.error)
    throw new Error(`getEngagement risk items: ${riskItemsRes.error.message}`);
  if (businessChangeItemsRes.error)
    throw new Error(
      `getEngagement business changes: ${businessChangeItemsRes.error.message}`,
    );
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
    riskNarrative: engagement.risk_narrative ?? "",
    riskItems: (riskItemsRes.data ?? []).map((row) => ({
      category: row.category,
      description: row.description,
    })),
    businessChangesNarrative: engagement.business_changes_narrative ?? "",
    businessChangeItems: (businessChangeItemsRes.data ?? []).map((row) => ({
      category: row.category,
      description: row.description,
    })),
    overallMateriality: Number(engagement.overall_materiality),
    performanceMateriality: Number(engagement.performance_materiality),
    clearlyTrivialThreshold: Number(engagement.clearly_trivial_threshold),
    materialityBasis: engagement.materiality_basis,
  };

  return {
    values,
    pyAuditFile: fileByKind.get("py_audit") ?? null,
    cyTrialBalanceFile: fileByKind.get("cy_tb") ?? null,
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
  const safeName = file.name.replace(/[^A-Za-z0-9._-]/g, "_");
  const storagePath = `engagements/${engagementId}/${kind}-${Date.now()}-${safeName}`;
  const arrayBuffer = await file.arrayBuffer();

  const { error: uploadError } = await sb.storage
    .from(ENGAGEMENT_FILES_BUCKET)
    .upload(storagePath, arrayBuffer, {
      contentType: file.type || "application/octet-stream",
      upsert: false,
    });
  if (uploadError) throw new Error(`uploadEngagementFile failed: ${uploadError.message}`);

  const existing = await sb
    .from("engagement_files")
    .select("storage_path")
    .eq("engagement_id", engagementId)
    .eq("kind", kind)
    .maybeSingle();

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
    cyRiskProfile: {
      ...(v.riskNarrative ? { narrative: v.riskNarrative } : {}),
      items: v.riskItems,
    },
    cyBusinessChanges: {
      ...(v.businessChangesNarrative
        ? { narrative: v.businessChangesNarrative }
        : {}),
      items: v.businessChangeItems,
    },
    materiality: {
      currency: "USD",
      overallMateriality: v.overallMateriality,
      performanceMateriality: v.performanceMateriality,
      clearlyTrivialThreshold: v.clearlyTrivialThreshold,
      basis: v.materialityBasis,
    },
    createdAt: detail.createdAt,
    updatedAt: detail.updatedAt,
  };

  // Validate before returning so the contract is enforced at every export.
  return EngagementSetupSchema.parse(result);
}
