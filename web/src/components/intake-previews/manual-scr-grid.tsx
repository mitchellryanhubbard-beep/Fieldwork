"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { saveManualScrAction } from "@/app/app/engagements/actions";
import { Button } from "@/components/ui/button";

// Editable grid for Subsequent Cash Receipts.

type Draft = {
  receiptNum: string;
  customerName: string;
  invoiceNum: string;
  invoiceDate: string;
  invoiceAmount: string;
  receiptDate: string;
  amountReceived: string;
  appliedInFull: boolean;
  remainingBalance: string;
  notes: string;
};

const EMPTY_ROW: Draft = {
  receiptNum: "",
  customerName: "",
  invoiceNum: "",
  invoiceDate: "",
  invoiceAmount: "",
  receiptDate: "",
  amountReceived: "",
  appliedInFull: true,
  remainingBalance: "",
  notes: "",
};

export type ManualScrGridProps = {
  engagementId: string;
  initialPeriodLabel: string;
  initialReceipts: Draft[];
};

export function ManualScrGrid({
  engagementId,
  initialPeriodLabel,
  initialReceipts,
}: ManualScrGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [periodLabel, setPeriodLabel] = useState(initialPeriodLabel);
  const [rows, setRows] = useState<Draft[]>(
    initialReceipts.length > 0 ? initialReceipts : [{ ...EMPTY_ROW }],
  );

  function update<K extends keyof Draft>(idx: number, field: K, value: Draft[K]) {
    setRows((prev) => {
      const next = prev.slice();
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  }
  function addRow() {
    setRows((prev) => [...prev, { ...EMPTY_ROW }]);
  }
  function removeRow(idx: number) {
    setRows((prev) => (prev.length === 1 ? prev : prev.filter((_, i) => i !== idx)));
  }

  function handleSave() {
    startTransition(async () => {
      const result = await saveManualScrAction(
        engagementId,
        periodLabel || null,
        rows,
      );
      if (!result.ok) {
        toast.error("Couldn't save manual mapping", { description: result.error });
        return;
      }
      toast.success(
        "Subsequent Cash Receipts saved — verification confirmed",
        { description: "Downstream tests will use this canonical data." },
      );
      router.push(
        `/app/engagements/${engagementId}/verify/subsequent_cash_receipts`,
      );
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-primary/10 bg-card p-4">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
            Period (optional)
          </span>
          <input
            type="text"
            placeholder="e.g. January 1-31, 2025"
            value={periodLabel}
            onChange={(e) => setPeriodLabel(e.target.value)}
            className="mt-1 w-72 rounded-md border border-primary/15 bg-background px-2 py-1 text-sm focus:border-primary/40 focus:outline-none"
          />
        </label>
        <div className="text-xs text-foreground/60">
          {rows.length} receipt{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-primary/10 bg-card">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary text-left text-[10px] uppercase tracking-wide text-foreground/55 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
            <tr>
              {[
                "Receipt #",
                "Customer",
                "Invoice #",
                "Inv Date",
                "Inv Amt",
                "Receipt Date",
                "Amount Rcvd",
                "Full?",
                "Remaining",
                "Notes",
                "",
              ].map((h) => (
                <th key={h} className="whitespace-nowrap px-2 py-2 font-medium">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-primary/10">
            {rows.map((row, idx) => (
              <tr key={idx}>
                <Cell value={row.receiptNum} onChange={(v) => update(idx, "receiptNum", v)} w="w-24" mono />
                <Cell value={row.customerName} onChange={(v) => update(idx, "customerName", v)} w="w-44" />
                <Cell value={row.invoiceNum} onChange={(v) => update(idx, "invoiceNum", v)} w="w-28" mono />
                <Cell value={row.invoiceDate} onChange={(v) => update(idx, "invoiceDate", v)} w="w-28" type="date" />
                <Cell value={row.invoiceAmount} onChange={(v) => update(idx, "invoiceAmount", v)} w="w-24" type="number" />
                <Cell value={row.receiptDate} onChange={(v) => update(idx, "receiptDate", v)} w="w-28" type="date" />
                <Cell value={row.amountReceived} onChange={(v) => update(idx, "amountReceived", v)} w="w-24" type="number" />
                <td className="px-1 py-1">
                  <input
                    type="checkbox"
                    checked={row.appliedInFull}
                    onChange={(e) => update(idx, "appliedInFull", e.target.checked)}
                    className="h-4 w-4"
                  />
                </td>
                <Cell value={row.remainingBalance} onChange={(v) => update(idx, "remainingBalance", v)} w="w-24" type="number" />
                <Cell value={row.notes} onChange={(v) => update(idx, "notes", v)} w="w-48" />
                <td className="px-2 py-1">
                  <button
                    type="button"
                    onClick={() => removeRow(idx)}
                    className="text-[10px] uppercase tracking-wider text-destructive hover:underline"
                    disabled={rows.length === 1}
                  >
                    Remove
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button type="button" variant="goldOutline" size="sm" onClick={addRow}>
          + Add receipt
        </Button>
        <Button
          type="button"
          variant="gold"
          onClick={handleSave}
          disabled={isPending}
        >
          {isPending ? "Saving…" : "Save and confirm"}
        </Button>
      </div>
    </div>
  );
}

function Cell({
  value,
  onChange,
  w,
  type = "text",
  mono,
}: {
  value: string;
  onChange: (v: string) => void;
  w: string;
  type?: "text" | "number" | "date";
  mono?: boolean;
}) {
  return (
    <td className="px-1 py-1">
      <input
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`${w} rounded border border-primary/10 bg-background px-1.5 py-0.5 text-xs focus:border-primary/40 focus:outline-none ${
          mono ? "font-mono" : ""
        }`}
      />
    </td>
  );
}
