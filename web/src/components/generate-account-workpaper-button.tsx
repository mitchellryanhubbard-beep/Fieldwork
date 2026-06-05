"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type GenerateAccountWorkpaperButtonProps = {
  engagementId: string;
  acctNum: string;
  accountName: string;
  alreadyGenerated: boolean;
  // When the verification gate is blocking new generation, this short
  // reason is shown as the button tooltip and the button is disabled.
  // "View" stays enabled even when blocked — viewing an already-generated
  // workpaper doesn't read from canonical data.
  generationBlockedReason?: string;
};

export function GenerateAccountWorkpaperButton({
  engagementId,
  acctNum,
  accountName,
  alreadyGenerated,
  generationBlockedReason,
}: GenerateAccountWorkpaperButtonProps) {
  const router = useRouter();
  const [isPending, setIsPending] = useState(false);

  // Once generated, the row's Download button handles re-fetch; no need to
  // render this control at all.
  if (alreadyGenerated) return null;

  async function handleClick() {
    if (isPending) return;
    setIsPending(true);

    const isView = alreadyGenerated;
    const toastId = toast.loading(
      isView
        ? `Fetching workpaper — ${accountName}…`
        : `Building workpaper — ${accountName}…`,
      {
        description: isView
          ? "Downloading the previously generated workpaper."
          : "Generating cover + assertion tabs from the procedure library. About 60–90 seconds.",
      },
    );

    try {
      const res = isView
        ? await fetch(
            `/api/workpapers/account?engagementId=${encodeURIComponent(engagementId)}&acctNum=${encodeURIComponent(acctNum)}`,
          )
        : await fetch("/api/workpapers/account", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ engagementId, acctNum }),
          });

      if (!res.ok) {
        const errorBody = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(errorBody.error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const cd = res.headers.get("Content-Disposition") ?? "";
      const match = /filename="?([^"]+)"?/i.exec(cd);
      const filename = match?.[1] ?? `WP-${acctNum}.xlsx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(isView ? "Workpaper downloaded" : "Workpaper generated", {
        id: toastId,
        description: `Open ${filename} in Excel.`,
      });

      // First generation: refresh the page so the button flips to "View".
      if (!isView) router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        isView ? "Workpaper download failed" : "Workpaper generation failed",
        { id: toastId, description: message },
      );
    } finally {
      setIsPending(false);
    }
  }

  const label = alreadyGenerated
    ? isPending
      ? "Fetching…"
      : "View workpaper"
    : isPending
      ? "Building…"
      : "Generate New Workpaper";

  // Block only the new-generation path. Viewing an existing workpaper is
  // always safe — it reads bytes from storage, not the canonical data.
  const isBlocked = !alreadyGenerated && !!generationBlockedReason;

  return (
    <div className="flex flex-col items-start gap-1">
      <Button
        type="button"
        variant={alreadyGenerated ? "gold" : "goldOutline"}
        onClick={handleClick}
        disabled={isPending || isBlocked}
        size="sm"
        title={isBlocked ? generationBlockedReason : undefined}
      >
        {label}
      </Button>
      {isBlocked ? (
        <p className="text-xs text-destructive">
          {generationBlockedReason}
        </p>
      ) : null}
    </div>
  );
}
