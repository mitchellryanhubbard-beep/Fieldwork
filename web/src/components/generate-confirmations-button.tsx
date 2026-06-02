"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type GenerateConfirmationsButtonProps = {
  engagementId: string;
  acctNum: string;
  accountName: string;
  alreadyGenerated: boolean;
  // If true, the button is disabled with an explanatory tooltip. Confirmations
  // depend on a prior workpaper generation (which locks the sample).
  disabledReason?: string;
};

export function GenerateConfirmationsButton({
  engagementId,
  acctNum,
  accountName,
  alreadyGenerated,
  disabledReason,
}: GenerateConfirmationsButtonProps) {
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
        ? `Fetching confirmations — ${accountName}…`
        : `Building confirmations — ${accountName}…`,
      {
        description: isView
          ? "Downloading the previously generated request workbook."
          : "Generating one letter per sampled customer. About 5-10 seconds.",
      },
    );

    try {
      const res = isView
        ? await fetch(
            `/api/workpapers/account/confirmations?engagementId=${encodeURIComponent(engagementId)}&acctNum=${encodeURIComponent(acctNum)}`,
          )
        : await fetch("/api/workpapers/account/confirmations", {
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
      const filename = match?.[1] ?? `WP-${acctNum}-Confirmations.xlsx`;
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success(
        isView ? "Confirmations downloaded" : "Confirmations generated",
        { id: toastId, description: `Open ${filename} in Excel.` },
      );

      if (!isView) router.refresh();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error(
        isView ? "Couldn't download confirmations" : "Couldn't generate confirmations",
        { id: toastId, description: message },
      );
    } finally {
      setIsPending(false);
    }
  }

  const label = alreadyGenerated
    ? isPending
      ? "Fetching…"
      : "View confirmations"
    : isPending
      ? "Building…"
      : "Generate confirmations";

  return (
    <Button
      type="button"
      variant={alreadyGenerated ? "navyOutline" : "goldOutline"}
      onClick={handleClick}
      disabled={isPending || !!disabledReason}
      size="sm"
      title={disabledReason}
    >
      {label}
    </Button>
  );
}
