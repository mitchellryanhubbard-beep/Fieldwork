"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { uploadFileAction } from "@/app/app/engagements/actions";

export type FileUploadProps = {
  engagementId: string;
  kind: "py_audit" | "cy_tb";
  title: string;
  description: string;
  accept: string;
  current?: {
    originalFilename: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
};

export function FileUpload({
  engagementId,
  kind,
  title,
  description,
  accept,
  current,
}: FileUploadProps) {
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
      const result = await uploadFileAction(form);
      if (!result.ok) {
        setError(result.error);
        toast.error("Upload failed", { description: result.error });
        return;
      }
      toast.success(`${title} uploaded`);
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
          <div className="font-medium text-primary">
            {current.originalFilename}
          </div>
          <div className="mt-0.5 font-mono text-xs text-foreground/60">
            {formatBytes(current.sizeBytes)} · uploaded{" "}
            {new Date(current.uploadedAt).toLocaleString()}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-foreground/55">No file uploaded yet.</p>
      )}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap gap-2">
        <Input
          ref={inputRef}
          type="file"
          accept={accept}
          className="max-w-md"
        />
        <Button type="submit" disabled={isPending} variant="gold">
          {isPending ? "Uploading…" : current ? "Replace" : "Upload"}
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
