"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FilePicker } from "@/components/ui/file-picker";
import { uploadFileAction } from "@/app/app/engagements/actions";

export type FileUploadProps = {
  engagementId: string;
  kind: "py_audit" | "cy_tb" | "ar_aging" | "subsequent_cash_receipts";
  title: string;
  description: string;
  accept: string;
  current?: {
    originalFilename: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
  verification?: {
    status: "pending" | "confirmed" | "failed";
  } | null;
};

export function FileUpload({
  engagementId,
  kind,
  title,
  description,
  accept,
  current,
  verification,
}: FileUploadProps) {
  const isParseable =
    kind === "ar_aging" ||
    kind === "cy_tb" ||
    kind === "subsequent_cash_receipts";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    const form = new FormData();
    form.append("engagementId", engagementId);
    form.append("kind", kind);
    form.append("file", file);

    startTransition(async () => {
      const toastId = toast.loading(
        isParseable ? `Parsing ${title}…` : `Uploading ${title}…`,
        {
          description: isParseable
            ? "Extracting structured data — PDFs can take 30-60 seconds."
            : undefined,
        },
      );
      const result = await uploadFileAction(form);
      if (!result.ok) {
        setError(result.error);
        toast.error(isParseable ? "Parsing failed" : "Upload failed", {
          id: toastId,
          description: result.error,
        });
        return;
      }
      toast.success(isParseable ? `${title} parsed` : `${title} uploaded`, {
        id: toastId,
        description: isParseable ? "Open Verify to review extracted data." : undefined,
      });
      if (inputRef.current) inputRef.current.value = "";
      router.refresh();
    });
  }

  return (
    <div className="rounded-xl border border-primary/10 bg-card p-5">
      <h3 className="font-display text-lg font-medium text-primary">{title}</h3>
      <p className="mt-1 text-sm text-foreground/70">{description}</p>
      {current ? (
        <div className="mt-4 rounded-lg border border-primary/10 bg-secondary/40 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium text-primary">
                {current.originalFilename}
              </div>
              <div className="mt-0.5 font-mono text-xs text-foreground/60">
                {formatBytes(current.sizeBytes)} · uploaded{" "}
                {new Date(current.uploadedAt).toLocaleString()}
              </div>
            </div>
            {isParseable ? (
              <div className="flex items-center gap-2">
                <VerificationBadge verification={verification} />
                <Link
                  href={`/app/engagements/${engagementId}/verify/${kind}`}
                  className="text-xs text-accent hover:underline"
                >
                  Verify →
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-foreground/55">No file uploaded yet.</p>
      )}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap gap-2">
        <FilePicker
          ref={inputRef}
          accept={accept}
          className="max-w-md"
        />
        <Button type="submit" disabled={isPending} variant="gold">
          {isPending
            ? isParseable
              ? "Parsing…"
              : "Uploading…"
            : current
              ? "Replace"
              : "Upload"}
        </Button>
      </form>
      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function VerificationBadge({
  verification,
}: {
  verification: FileUploadProps["verification"];
}) {
  if (!verification) {
    return (
      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground/60">
        Not parsed
      </span>
    );
  }
  const map = {
    pending: "bg-amber-100 text-amber-900",
    confirmed: "bg-emerald-100 text-emerald-900",
    failed: "bg-rose-100 text-rose-900",
  } as const;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${map[verification.status]}`}
    >
      {verification.status}
    </span>
  );
}
