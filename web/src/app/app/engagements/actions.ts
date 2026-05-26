"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import type { ZodError } from "zod";
import { EngagementFormSchema } from "@/lib/engagement-schema";
import {
  createEngagement,
  deleteEngagement,
  updateEngagement,
  uploadEngagementFile,
} from "@/lib/engagement-repo";

export type ActionResult =
  | { ok: true }
  | { ok: false; error: string };

export async function createEngagementAction(
  rawValues: unknown,
): Promise<ActionResult> {
  const parsed = EngagementFormSchema.safeParse(rawValues);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  let newId: string;
  try {
    newId = await createEngagement(parsed.data);
    revalidatePath("/app");
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect(`/app/engagements/${newId}`);
}

export async function updateEngagementAction(
  id: string,
  rawValues: unknown,
): Promise<ActionResult> {
  const parsed = EngagementFormSchema.safeParse(rawValues);
  if (!parsed.success) {
    return { ok: false, error: formatZodError(parsed.error) };
  }
  try {
    await updateEngagement(id, parsed.data);
    revalidatePath("/app");
    revalidatePath(`/app/engagements/${id}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteEngagementAction(id: string): Promise<ActionResult> {
  try {
    await deleteEngagement(id);
    revalidatePath("/app");
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
  redirect("/app");
}

export async function uploadFileAction(
  formData: FormData,
): Promise<ActionResult> {
  const engagementId = String(formData.get("engagementId") ?? "");
  const kindRaw = String(formData.get("kind") ?? "");
  const file = formData.get("file");

  if (!engagementId) return { ok: false, error: "engagementId is required" };
  if (kindRaw !== "py_audit" && kindRaw !== "cy_tb") {
    return { ok: false, error: "kind must be 'py_audit' or 'cy_tb'" };
  }
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "file is required" };
  }

  try {
    await uploadEngagementFile(engagementId, kindRaw, file);
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function formatZodError(err: ZodError): string {
  return err.issues
    .map((i) => `${i.path.length ? i.path.join(".") : "(root)"}: ${i.message}`)
    .join("; ");
}
