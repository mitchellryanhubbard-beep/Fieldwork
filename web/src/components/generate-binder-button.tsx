"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";

export type GenerateBinderButtonProps = {
  engagementId: string;
  clientName: string;
};

export function GenerateBinderButton({
  engagementId,
  clientName,
}: GenerateBinderButtonProps) {
  const [isPending, setIsPending] = useState(false);

  async function handleClick() {
    if (isPending) return;
    setIsPending(true);
    const toastId = toast.loading("Building workpaper binder…", {
      description:
        "Generating scoping memo, assertion plan, and lead sheets. About 60–90 seconds.",
    });

    try {
      const res = await fetch("/api/workpapers/binder", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId }),
      });

      if (!res.ok) {
        const errorBody = await res
          .json()
          .catch(() => ({ error: res.statusText }));
        throw new Error(errorBody.error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeClient = clientName
        .replace(/[^A-Za-z0-9-]+/g, "_")
        .slice(0, 40);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeClient}-workpaper-binder.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("Workpaper binder downloaded", {
        id: toastId,
        description: "Open in Excel to review the scoping memo + lead sheets.",
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Binder generation failed", {
        id: toastId,
        description: message,
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <Button
      type="button"
      variant="gold"
      onClick={handleClick}
      disabled={isPending}
    >
      {isPending ? "Building binder… (60-90s)" : "Generate Workpaper Binder"}
    </Button>
  );
}
