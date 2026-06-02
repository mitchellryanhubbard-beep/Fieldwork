"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { GeneratedArtifactHistory } from "@/components/generated-artifact-history";

export type GenerateMatrixButtonProps = {
  engagementId: string;
  clientName: string;
};

export function GenerateMatrixButton({
  engagementId,
  clientName,
}: GenerateMatrixButtonProps) {
  const [isPending, setIsPending] = useState(false);
  const [historyKey, setHistoryKey] = useState(0);

  async function handleClick() {
    if (isPending) return;
    setIsPending(true);
    const toastId = toast.loading("Generating assertion matrix…", {
      description: "Claude is reasoning over the engagement + trial balance. About 60–90 seconds.",
    });

    try {
      const res = await fetch("/api/claude/assertion-matrix/xlsx", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ engagementId }),
      });

      if (!res.ok) {
        const errorBody = await res.json().catch(() => ({ error: res.statusText }));
        throw new Error(errorBody.error ?? `HTTP ${res.status}`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const safeClient = clientName
        .replace(/[^A-Za-z0-9-]+/g, "_")
        .slice(0, 40);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${safeClient}-assertion-matrix.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);

      toast.success("Assertion matrix downloaded", {
        id: toastId,
        description: "Open the xlsx in Excel to review.",
      });
      setHistoryKey((k) => k + 1);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      toast.error("Matrix generation failed", {
        id: toastId,
        description: message,
      });
    } finally {
      setIsPending(false);
    }
  }

  return (
    <div className="flex flex-col">
      <Button
        type="button"
        variant="gold"
        onClick={handleClick}
        disabled={isPending}
      >
        {isPending ? "Generating… (60-90s)" : "Generate Assertion Matrix"}
      </Button>
      <GeneratedArtifactHistory
        engagementId={engagementId}
        kind="matrix"
        refreshKey={historyKey}
        label="Prior matrices:"
      />
    </div>
  );
}
