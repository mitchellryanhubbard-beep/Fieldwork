"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { tagUntaggedPyWorkpapersAction } from "@/app/app/engagements/actions";

export function PyUntaggedBanner({
  engagementId,
  count,
}: {
  engagementId: string;
  count: number;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleTag() {
    startTransition(async () => {
      const toastId = toast.loading("Auto-tagging untagged workpapers…");
      const result = await tagUntaggedPyWorkpapersAction(engagementId);
      if (!result.ok) {
        toast.error("Tagging failed", { id: toastId, description: result.error });
        return;
      }
      toast.success(
        `Tagged ${result.tagged ?? 0} workpaper${result.tagged === 1 ? "" : "s"}`,
        { id: toastId },
      );
      router.refresh();
    });
  }

  return (
    <div className="flex items-center justify-between gap-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
      <span>
        {count} workpaper{count === 1 ? "" : "s"} not yet tagged.
      </span>
      <button
        type="button"
        onClick={handleTag}
        disabled={isPending}
        className="font-semibold uppercase tracking-wider text-accent hover:underline disabled:opacity-50"
      >
        {isPending ? "Tagging…" : "Auto-tag with AI"}
      </button>
    </div>
  );
}
