"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
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
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent>
        {current ? (
          <div className="mb-3 rounded-md border bg-muted/40 p-3 text-sm">
            <div className="font-medium">{current.originalFilename}</div>
            <div className="text-xs text-muted-foreground">
              {formatBytes(current.sizeBytes)} · uploaded{" "}
              {new Date(current.uploadedAt).toLocaleString()}
            </div>
          </div>
        ) : (
          <p className="mb-3 text-sm text-muted-foreground">
            No file uploaded yet.
          </p>
        )}
        <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
          <Input
            ref={inputRef}
            type="file"
            accept={accept}
            className="max-w-md"
          />
          <Button type="submit" disabled={isPending}>
            {isPending ? "Uploading…" : current ? "Replace" : "Upload"}
          </Button>
        </form>
        {error ? (
          <p className="mt-2 text-xs text-destructive">{error}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
