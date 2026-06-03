"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export type DeleteEngagementButtonProps = {
  clientName: string;
  action: () => Promise<void>;
};

// Thin client wrapper around the server delete action so we can gate it
// behind a native confirm() before firing. Server components can't attach
// onClick handlers directly, so the page hands us the bound server action
// and we own the click.
export function DeleteEngagementButton({
  clientName,
  action,
}: DeleteEngagementButtonProps) {
  const [isPending, startTransition] = useTransition();
  return (
    <Button
      type="button"
      variant="destructive"
      disabled={isPending}
      onClick={() => {
        const confirmed = window.confirm(
          `Delete ${clientName} and all uploaded files? This cannot be undone.`,
        );
        if (!confirmed) return;
        startTransition(() => {
          action();
        });
      }}
    >
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
