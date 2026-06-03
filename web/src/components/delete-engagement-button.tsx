"use client";

import { useTransition } from "react";
import { Button } from "@/components/ui/button";

export type DeleteEngagementButtonProps = {
  clientName: string;
  action: () => Promise<void>;
  // Overrides the default Button styling — when set, renders a raw
  // <button> with the given classes so the caller can shape the button
  // as a full-fill panel (e.g. the slide-in delete column on the
  // engagements list).
  className?: string;
};

// Thin client wrapper around the server delete action so we can gate it
// behind a native confirm() before firing. Server components can't attach
// onClick handlers directly, so the page hands us the bound server action
// and we own the click.
export function DeleteEngagementButton({
  clientName,
  action,
  className,
}: DeleteEngagementButtonProps) {
  const [isPending, startTransition] = useTransition();
  const handleClick = () => {
    const confirmed = window.confirm(
      `Delete ${clientName} and all uploaded files? This cannot be undone.`,
    );
    if (!confirmed) return;
    startTransition(() => {
      action();
    });
  };

  if (className) {
    return (
      <button
        type="button"
        disabled={isPending}
        className={className}
        onClick={handleClick}
      >
        {isPending ? "Deleting…" : "Delete"}
      </button>
    );
  }

  return (
    <Button
      type="button"
      variant="destructive"
      disabled={isPending}
      onClick={handleClick}
    >
      {isPending ? "Deleting…" : "Delete"}
    </Button>
  );
}
