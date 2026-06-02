"use client";

import { useRef, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import {
  tagUntaggedPyWorkpapersAction,
  uploadPyWorkpaperAction,
} from "@/app/app/engagements/actions";
import { Button } from "@/components/ui/button";
import { FilePicker } from "@/components/ui/file-picker";

// Compact PY upload form for the right column of the Workpapers section.
// Handles upload + auto-tagging in one transition.
export function PyUploadForm({ engagementId }: { engagementId: string }) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [isPending, startTransition] = useTransition();

  function handleUpload(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const files = Array.from(inputRef.current?.files ?? []);
    if (files.length === 0) {
      toast.error("Choose at least one Excel file");
      return;
    }
    const form = new FormData();
    form.append("engagementId", engagementId);
    for (const f of files) form.append("files", f);
    startTransition(async () => {
      const result = await uploadPyWorkpaperAction(form);
      if (!result.ok) {
        toast.error("Upload failed", { description: result.error });
        return;
      }
      const toastId = toast.success(
        files.length === 1
          ? `${files[0].name} uploaded`
          : `${files.length} PY workpapers uploaded`,
        { description: "Auto-tagging by FSLI…" },
      );
      if (inputRef.current) inputRef.current.value = "";
      const tagResult = await tagUntaggedPyWorkpapersAction(engagementId);
      if (tagResult.ok) {
        toast.success(`Tagged ${tagResult.tagged ?? 0} workpaper${tagResult.tagged === 1 ? "" : "s"}`, {
          id: toastId,
        });
      }
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleUpload}
      className="flex flex-wrap items-center gap-2 rounded-xl border border-primary/10 bg-card p-3"
    >
      <FilePicker
        ref={inputRef}
        accept=".xlsx,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,application/vnd.ms-excel"
        multiple
        label="Choose Files"
        className="max-w-xs"
      />
      <Button type="submit" disabled={isPending} variant="gold" size="sm">
        {isPending ? "Uploading…" : "Upload"}
      </Button>
    </form>
  );
}
