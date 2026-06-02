"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

export type GenerateCyWorkpaperButtonProps = {
  pyWorkpaperId: string;
  pyFilename: string;
  alreadyGenerated: boolean;
};

// Per-row button on the PY workpaper list. Kicks off the hybrid roll-
// forward pipeline; on success, refreshes the page so the new CY row
// shows up in the Current-year column with its own Download button.
// (When alreadyGenerated is true the parent hides this button entirely.)
export function GenerateCyWorkpaperButton({
  pyWorkpaperId,
  pyFilename,
  alreadyGenerated,
}: GenerateCyWorkpaperButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  if (alreadyGenerated) return null;

  async function handleClick() {
    if (isPending) return;
    setIsPending(true);
    const toastId = toast.loading(`Generating CY for ${pyFilename}…`, {
      description:
        "Rolling forward dates, materiality, and balances. About 30-60 seconds.",
    });

    try {
      const res = await fetch("/api/py-workpapers/generate-cy", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ pyWorkpaperId }),
      });

      if (!res.ok) {
        const errorBody = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(errorBody.error ?? `HTTP ${res.status}`);
      }

      const patchCount = res.headers.get("X-Patch-Count");
      toast.success("CY workpaper generated", {
        id: toastId,
        description: patchCount
          ? `${patchCount} cells updated. Find it in the Current-year column.`
          : "Find it in the Current-year column.",
      });

      router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("CY generation failed", { id: toastId, description: message });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPending}
      className="rounded-md bg-accent/90 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-primary transition-colors hover:bg-accent disabled:opacity-60"
    >
      {isPending ? "Generating…" : "Generate CY"}
    </button>
  );
}
