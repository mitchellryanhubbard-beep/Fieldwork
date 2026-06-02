"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { setSamplingMethodologyAction } from "@/app/app/engagements/actions";
import { ASSERTION_LABELS } from "@/lib/assertion-matrix";
import type { AssertionKey } from "@/lib/procedure-library";
import {
  METHODOLOGIES,
  type MethodologyId,
  type MethodologyMeta,
} from "@/lib/sampling-methodologies";

export type AssertionRow = {
  assertion: AssertionKey;
  methodologies: MethodologyMeta[];   // first entry is the default
  currentMethodology: MethodologyId;  // either from settings.json or default
};

export type SamplingMethodologyDropdownsProps = {
  engagementId: string;
  acctNum: string;
  rows: AssertionRow[];
};

export function SamplingMethodologyDropdowns({
  engagementId,
  acctNum,
  rows,
}: SamplingMethodologyDropdownsProps) {
  if (rows.length === 0) return null;

  // Summary shows how many assertions have a non-default methodology so the
  // auditor can see at a glance whether anything's been overridden without
  // expanding.
  const overrideCount = rows.filter(
    (r) => r.currentMethodology !== r.methodologies[0]?.id,
  ).length;
  const summary =
    overrideCount > 0
      ? `Sampling methodology · ${overrideCount} override${overrideCount > 1 ? "s" : ""}`
      : `Sampling methodology · ${rows.length} assertion${rows.length > 1 ? "s" : ""}`;

  return (
    <details className="group/sampling border-t border-primary/10 bg-secondary/40">
      <summary className="flex cursor-pointer select-none items-center gap-2 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55 transition-colors hover:text-foreground/80">
        <span className="inline-block transition-transform group-open/sampling:rotate-90">
          ›
        </span>
        {summary}
      </summary>
      <div className="grid gap-2 px-4 pb-3">
        {rows.map((row) => (
          <AssertionMethodologyRow
            key={row.assertion}
            engagementId={engagementId}
            acctNum={acctNum}
            row={row}
          />
        ))}
      </div>
    </details>
  );
}

function AssertionMethodologyRow({
  engagementId,
  acctNum,
  row,
}: {
  engagementId: string;
  acctNum: string;
  row: AssertionRow;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [value, setValue] = useState<MethodologyId>(row.currentMethodology);

  function onChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const next = e.target.value as MethodologyId;
    setValue(next);
    startTransition(async () => {
      const result = await setSamplingMethodologyAction(
        engagementId,
        acctNum,
        row.assertion,
        next,
      );
      if (!result.ok) {
        toast.error("Couldn't update methodology", { description: result.error });
        setValue(row.currentMethodology);
        return;
      }
      toast.success(
        `${ASSERTION_LABELS[row.assertion]} → ${METHODOLOGIES[next].label}`,
        {
          description: "Regenerate the workpaper to apply the new sample.",
        },
      );
      router.refresh();
    });
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,2fr)] items-center gap-3">
      <div className="text-xs font-medium text-foreground">
        {ASSERTION_LABELS[row.assertion]}
      </div>
      <select
        value={value}
        onChange={onChange}
        disabled={isPending}
        className="w-full rounded-md border border-primary/15 bg-background px-2 py-1 text-xs text-foreground focus:border-primary/40 focus:outline-none focus:ring-1 focus:ring-primary/30 disabled:opacity-60"
      >
        {row.methodologies.map((m) => (
          <option key={m.id} value={m.id} disabled={!m.enabled}>
            {m.label}
            {!m.enabled ? " (coming soon)" : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
