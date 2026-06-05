"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { confirmIntakeAction } from "@/app/app/engagements/actions";
import { Button } from "@/components/ui/button";
import type { ParseableKind } from "@/lib/intake/canonical";

export function ConfirmIntakeButton({
  engagementId,
  kind,
  disabled,
}: {
  engagementId: string;
  kind: ParseableKind;
  disabled?: boolean;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  function handleClick() {
    if (isPending || disabled) return;
    startTransition(async () => {
      const result = await confirmIntakeAction(engagementId, kind);
      if (!result.ok) {
        toast.error("Couldn't confirm", { description: result.error });
        return;
      }
      toast.success("Confirmed — parsed data is now live", {
        description: "Downstream tests will use this canonical data.",
      });
      // Land the user back on the section they came from — Source
      // files (4) for CY TB, Support and Workpapers (6) for the FSLI
      // supporting schedules (ar_aging + subsequent_cash_receipts).
      const anchor = kind === "cy_tb" ? "section-4" : "section-6";
      router.push(`/app/engagements/${engagementId}#${anchor}`);
    });
  }

  return (
    <Button
      type="button"
      variant="gold"
      onClick={handleClick}
      disabled={disabled || isPending}
    >
      {isPending ? "Confirming…" : "Confirm and use"}
    </Button>
  );
}
