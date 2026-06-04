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
import { ASSERTIONS } from "@/lib/assertion-matrix";
import type { AssertionKey } from "@/lib/procedure-library";
import {
  METHODOLOGIES,
  type MethodologyId,
} from "@/lib/sampling-methodologies";
import { setAssertionMethodology } from "@/lib/workpaper-settings";
import {
  PARSEABLE_KINDS,
  type ParseableKind,
} from "@/lib/intake/canonical";
import {
  loadVerification,
  saveParsedCanonical,
  saveVerification,
  type VerificationRecord,
} from "@/lib/intake/storage";
import {
  rollUpArAgingCustomers,
  type ArAging,
  type ArInvoice,
} from "@/lib/ar-aging-parser";
import type { TrialBalance, TrialBalanceAccount } from "@/lib/tb-parser";
import type {
  ScrReceipt,
  SubsequentCashReceipts,
} from "@/lib/scr-parser";
import {
  uploadPyWorkpaper,
  deletePyWorkpaper,
  listPyWorkpapers,
  clearPyWorkpaperGeneratedCy,
} from "@/lib/py-workpaper-repo";
import { tagPyWorkpaper } from "@/lib/py-workpaper-tagger";
import { deleteAccountWorkpaperFile } from "@/lib/account-workpaper-generator";
import { deleteConfirmationsFile } from "@/lib/confirmation-requests-generator";

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
  redirect(`/app/engagements/${newId}#section-4`);
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
  const allowedKinds = [
    "py_audit",
    "cy_tb",
    "ar_aging",
    "subsequent_cash_receipts",
  ] as const;
  type AllowedKind = (typeof allowedKinds)[number];
  if (!(allowedKinds as readonly string[]).includes(kindRaw)) {
    return {
      ok: false,
      error: `kind must be one of: ${allowedKinds.join(", ")}`,
    };
  }
  const kind = kindRaw as AllowedKind;
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "file is required" };
  }

  try {
    await uploadEngagementFile(engagementId, kind, file);
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function setSamplingMethodologyAction(
  engagementId: string,
  acctNum: string,
  assertion: string,
  methodology: string,
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };
  if (!acctNum) return { ok: false, error: "acctNum is required" };
  if (!(ASSERTIONS as readonly string[]).includes(assertion)) {
    return { ok: false, error: `Unknown assertion: ${assertion}` };
  }
  if (!Object.prototype.hasOwnProperty.call(METHODOLOGIES, methodology)) {
    return { ok: false, error: `Unknown methodology: ${methodology}` };
  }
  if (!METHODOLOGIES[methodology as MethodologyId].enabled) {
    return {
      ok: false,
      error: `Methodology "${methodology}" is not yet enabled.`,
    };
  }
  try {
    await setAssertionMethodology(
      engagementId,
      acctNum,
      assertion as AssertionKey,
      methodology as MethodologyId,
    );
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// Manual mapping fallback for AR Aging. Takes an auditor-built invoice
// array, rolls up customers + total, persists as the canonical JSON,
// and flips verification to "confirmed" with sourceFormat="manual" so
// the audit trail records it wasn't AI-extracted.
export async function saveManualArAgingAction(
  engagementId: string,
  asOfDate: string | null,
  invoices: unknown[],
  originalFilename: string,
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };

  // Light validation — every invoice must at least have a customer #,
  // customer name, invoice #, and a total. Aging buckets default to 0 so
  // an auditor can leave them blank.
  const parsed: ArInvoice[] = [];
  for (const [i, raw] of invoices.entries()) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `Row ${i + 1}: not an object` };
    }
    const r = raw as Record<string, unknown>;
    const custNum = String(r.custNum ?? "").trim();
    const custName = String(r.custName ?? "").trim();
    const invoiceNum = String(r.invoiceNum ?? "").trim();
    if (!custNum) return { ok: false, error: `Row ${i + 1}: customer # is required` };
    if (!custName) return { ok: false, error: `Row ${i + 1}: customer name is required` };
    if (!invoiceNum) return { ok: false, error: `Row ${i + 1}: invoice # is required` };

    const total = toNum(r.total);
    if (total === null) return { ok: false, error: `Row ${i + 1}: total must be a number` };

    parsed.push({
      custNum,
      custName,
      invoiceNum,
      invoiceDate: optionalIsoDate(r.invoiceDate),
      dueDate: optionalIsoDate(r.dueDate),
      terms: String(r.terms ?? "").trim(),
      salesRep: String(r.salesRep ?? "").trim(),
      total,
      current: toNum(r.current) ?? 0,
      d1_30: toNum(r.d1_30) ?? 0,
      d31_60: toNum(r.d31_60) ?? 0,
      d61_90: toNum(r.d61_90) ?? 0,
      d90_plus: toNum(r.d90_plus) ?? 0,
      credits: toNum(r.credits) ?? 0,
      notes: String(r.notes ?? "").trim(),
    });
  }

  const customers = rollUpArAgingCustomers(parsed);
  const total = parsed.reduce((acc, inv) => acc + inv.total, 0);
  const canonical: ArAging = {
    asOfDate: asOfDate ? optionalIsoDate(asOfDate) : null,
    customers,
    invoices: parsed,
    total,
  };

  try {
    await saveParsedCanonical(engagementId, "ar_aging", canonical);
    const existing = await loadVerification(engagementId, "ar_aging");
    const record: VerificationRecord = {
      status: "confirmed",
      sourceFormat: "manual",
      originalFilename:
        existing?.originalFilename ?? originalFilename ?? "manual-entry",
      sourceHash: existing?.sourceHash ?? "manual",
      parsedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      failureMessage: null,
    };
    await saveVerification(engagementId, "ar_aging", record);
    revalidatePath(`/app/engagements/${engagementId}`);
    revalidatePath(`/app/engagements/${engagementId}/verify/ar_aging`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// Manual mapping fallback for TB.
export async function saveManualTrialBalanceAction(
  engagementId: string,
  clientName: string,
  accounts: unknown[],
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };

  const validSections = new Set([
    "Asset",
    "Liability",
    "Equity",
    "Revenue",
    "Expense",
  ]);
  const parsed: TrialBalanceAccount[] = [];
  for (const [i, raw] of accounts.entries()) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `Row ${i + 1}: not an object` };
    }
    const r = raw as Record<string, unknown>;
    const acctNum = String(r.acctNum ?? "").trim();
    const name = String(r.name ?? "").trim();
    const section = String(r.section ?? "").trim();
    if (!acctNum) return { ok: false, error: `Row ${i + 1}: account # is required` };
    if (!name) return { ok: false, error: `Row ${i + 1}: account name is required` };
    if (!validSections.has(section)) {
      return {
        ok: false,
        error: `Row ${i + 1}: section must be Asset, Liability, Equity, Revenue, or Expense`,
      };
    }
    parsed.push({
      acctNum,
      name,
      section: section as TrialBalanceAccount["section"],
      cyBalance: toNum(r.cyBalance) ?? 0,
      pyBalance: toNum(r.pyBalance) ?? 0,
      materialityScoping: "",
      pyExceptionNote: "",
    });
  }

  const canonical: TrialBalance = {
    clientName: clientName || "Unknown client",
    accounts: parsed,
  };
  return await persistManual(engagementId, "cy_tb", canonical);
}

// Manual mapping fallback for Subsequent Cash Receipts.
export async function saveManualScrAction(
  engagementId: string,
  periodLabel: string | null,
  receipts: unknown[],
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };

  const parsed: ScrReceipt[] = [];
  for (const [i, raw] of receipts.entries()) {
    if (!raw || typeof raw !== "object") {
      return { ok: false, error: `Row ${i + 1}: not an object` };
    }
    const r = raw as Record<string, unknown>;
    const receiptNum = String(r.receiptNum ?? "").trim();
    const customerName = String(r.customerName ?? "").trim();
    const invoiceNum = String(r.invoiceNum ?? "").trim();
    if (!receiptNum) return { ok: false, error: `Row ${i + 1}: receipt # is required` };
    if (!customerName) return { ok: false, error: `Row ${i + 1}: customer is required` };
    if (!invoiceNum) return { ok: false, error: `Row ${i + 1}: invoice # is required` };

    const amountReceived = toNum(r.amountReceived) ?? 0;
    const invoiceAmount = toNum(r.invoiceAmount) ?? 0;
    parsed.push({
      receiptNum,
      customerName,
      invoiceNum,
      invoiceDate: optionalIsoDate(r.invoiceDate),
      invoiceAmount,
      receiptDate: optionalIsoDate(r.receiptDate),
      amountReceived,
      appliedInFull:
        typeof r.appliedInFull === "boolean"
          ? r.appliedInFull
          : /^yes|^y$|^true$/i.test(String(r.appliedInFull ?? "")),
      remainingBalance: toNum(r.remainingBalance) ?? 0,
      notes: String(r.notes ?? "").trim(),
    });
  }

  const canonical: SubsequentCashReceipts = {
    periodLabel: periodLabel?.trim() || null,
    receipts: parsed,
    totalReceived: parsed.reduce((acc, r) => acc + r.amountReceived, 0),
  };
  return await persistManual(engagementId, "subsequent_cash_receipts", canonical);
}

// Shared persistence path for manual entries: save canonical JSON + flip
// verification to confirmed with sourceFormat="manual". Used by AR Aging,
// TB, and SCR manual save actions.
async function persistManual(
  engagementId: string,
  kind: ParseableKind,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canonical: any,
): Promise<ActionResult> {
  try {
    await saveParsedCanonical(engagementId, kind, canonical);
    const existing = await loadVerification(engagementId, kind);
    const record: VerificationRecord = {
      status: "confirmed",
      sourceFormat: "manual",
      originalFilename: existing?.originalFilename ?? "manual-entry",
      sourceHash: existing?.sourceHash ?? "manual",
      parsedAt: new Date().toISOString(),
      confirmedAt: new Date().toISOString(),
      failureMessage: null,
    };
    await saveVerification(engagementId, kind, record);
    revalidatePath(`/app/engagements/${engagementId}`);
    revalidatePath(`/app/engagements/${engagementId}/verify/${kind}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v.replace(/[,$]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function optionalIsoDate(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  const s = String(v).trim();
  // Accept YYYY-MM-DD as-is; anything else gets parsed.
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString().slice(0, 10);
}

export async function uploadPyWorkpaperAction(
  formData: FormData,
): Promise<ActionResult> {
  const engagementId = String(formData.get("engagementId") ?? "");
  const files = formData.getAll("files");
  if (!engagementId) return { ok: false, error: "engagementId is required" };
  if (files.length === 0) {
    return { ok: false, error: "Choose at least one file" };
  }

  for (const f of files) {
    if (!(f instanceof File) || f.size === 0) {
      return { ok: false, error: "All entries must be non-empty files" };
    }
    const lower = f.name.toLowerCase();
    if (!lower.endsWith(".xlsx") && !lower.endsWith(".xls")) {
      return {
        ok: false,
        error: `${f.name}: PY workpapers must be Excel (.xlsx / .xls)`,
      };
    }
  }

  try {
    for (const f of files) {
      await uploadPyWorkpaper(engagementId, f as File);
    }
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// Tag every PY workpaper that doesn't have an FSLI yet. Runs Claude per
// file sequentially — small numbers per engagement (typically < 30), so
// no need for concurrency for v1.
export async function tagUntaggedPyWorkpapersAction(
  engagementId: string,
): Promise<ActionResult & { tagged?: number }> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };
  try {
    const all = await listPyWorkpapers(engagementId);
    const untagged = all.filter((wp) => !wp.fsli);
    let tagged = 0;
    for (const wp of untagged) {
      try {
        await tagPyWorkpaper(wp);
        tagged += 1;
      } catch {
        // Per-file failures shouldn't block the batch — they'll stay
        // Unsorted and the auditor can override manually.
      }
    }
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true, tagged };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deletePyWorkpaperAction(
  engagementId: string,
  id: string,
): Promise<ActionResult> {
  try {
    await deletePyWorkpaper(id);
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteAccountWorkpaperAction(
  engagementId: string,
  acctNum: string,
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };
  if (!acctNum) return { ok: false, error: "acctNum is required" };
  try {
    await deleteAccountWorkpaperFile(engagementId, acctNum);
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function deleteConfirmationsAction(
  engagementId: string,
  acctNum: string,
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };
  if (!acctNum) return { ok: false, error: "acctNum is required" };
  try {
    await deleteConfirmationsFile(engagementId, acctNum);
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

// Wipes only the rolled-forward CY file — the PY upload + FSLI tag stay,
// so the auditor can re-run Generate CY.
export async function clearPyRolledCyAction(
  engagementId: string,
  pyWorkpaperId: string,
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };
  if (!pyWorkpaperId) return { ok: false, error: "pyWorkpaperId is required" };
  try {
    await clearPyWorkpaperGeneratedCy(pyWorkpaperId);
    revalidatePath(`/app/engagements/${engagementId}`);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: errorMessage(err) };
  }
}

export async function confirmIntakeAction(
  engagementId: string,
  kind: string,
): Promise<ActionResult> {
  if (!engagementId) return { ok: false, error: "engagementId is required" };
  if (!(PARSEABLE_KINDS as string[]).includes(kind)) {
    return { ok: false, error: `Unknown intake kind: ${kind}` };
  }
  const parseableKind = kind as ParseableKind;
  try {
    const current = await loadVerification(engagementId, parseableKind);
    if (!current) {
      return {
        ok: false,
        error: "No verification record exists — re-upload the file.",
      };
    }
    if (current.status === "failed") {
      return {
        ok: false,
        error: "Parse failed — use manual mapping before confirming.",
      };
    }
    await saveVerification(engagementId, parseableKind, {
      ...current,
      status: "confirmed",
      confirmedAt: new Date().toISOString(),
    });
    revalidatePath(`/app/engagements/${engagementId}`);
    revalidatePath(`/app/engagements/${engagementId}/verify/${kind}`);
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
