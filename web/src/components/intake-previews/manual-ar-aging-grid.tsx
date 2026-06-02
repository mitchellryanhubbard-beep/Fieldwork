"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { saveManualArAgingAction } from "@/app/app/engagements/actions";
import { Button } from "@/components/ui/button";

// Editable grid for AR Aging invoices — the fallback when AI extraction
// can't read the source. Same canonical shape downstream tests already
// consume; the auditor just fills it by hand. Save flips the verification
// to confirmed with sourceFormat="manual".

type Draft = {
  custNum: string;
  custName: string;
  invoiceNum: string;
  invoiceDate: string;
  dueDate: string;
  terms: string;
  salesRep: string;
  total: string;
  current: string;
  d1_30: string;
  d31_60: string;
  d61_90: string;
  d90_plus: string;
  credits: string;
  notes: string;
};

const EMPTY_ROW: Draft = {
  custNum: "",
  custName: "",
  invoiceNum: "",
  invoiceDate: "",
  dueDate: "",
  terms: "",
  salesRep: "",
  total: "",
  current: "",
  d1_30: "",
  d31_60: "",
  d61_90: "",
  d90_plus: "",
  credits: "",
  notes: "",
};

export type ManualArAgingGridProps = {
  engagementId: string;
  initialInvoices: Draft[];
  initialAsOfDate: string;
  originalFilename: string;
};

export function ManualArAgingGrid({
  engagementId,
  initialInvoices,
  initialAsOfDate,
  originalFilename,
}: ManualArAgingGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [asOfDate, setAsOfDate] = useState(initialAsOfDate);
  const [rows, setRows] = useState<Draft[]>(
    initialInvoices.length > 0 ? initialInvoices : [{ ...EMPTY_ROW }],
  );

  function update(idx: number, field: keyof Draft, value: string) {
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
      const result = await saveManualArAgingAction(
        engagementId,
        asOfDate || null,
        rows,
        originalFilename,
      );
      if (!result.ok) {
        toast.error("Couldn't save manual mapping", { description: result.error });
        return;
      }
      toast.success("AR Aging saved — verification confirmed", {
        description: "Downstream tests will use this canonical data.",
      });
      router.push(`/app/engagements/${engagementId}/verify/ar_aging`);
      router.refresh();
    });
  }

  // Auto-fill the "Current" bucket from total when nothing else is entered.
  // Common case: auditor just enters total + 0s elsewhere; we don't
  // automate further — they explicitly fill the past-due buckets.

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-primary/10 bg-card p-4">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
            As-of date
          </span>
          <input
            type="date"
            value={asOfDate}
            onChange={(e) => setAsOfDate(e.target.value)}
            className="mt-1 w-44 rounded-md border border-primary/15 bg-background px-2 py-1 text-sm focus:border-primary/40 focus:outline-none"
          />
        </label>
        <div className="text-xs text-foreground/60">
          {rows.length} invoice{rows.length === 1 ? "" : "s"} · Customers and
          totals are derived from invoices on save.
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-primary/10 bg-card">
        <table className="w-full text-xs">
          <thead className="sticky top-0 bg-primary/5 text-left text-[10px] uppercase tracking-wide text-foreground/55">
            <tr>
              {[
                "Cust #",
                "Customer",
                "Invoice #",
                "Inv Date",
                "Due Date",
                "Terms",
                "Sales Rep",
                "Total",
                "Current",
                "1-30",
                "31-60",
                "61-90",
                "90+",
                "Credits",
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
                <Cell value={row.custNum} onChange={(v) => update(idx, "custNum", v)} w="w-16" mono />
                <Cell value={row.custName} onChange={(v) => update(idx, "custName", v)} w="w-44" />
                <Cell value={row.invoiceNum} onChange={(v) => update(idx, "invoiceNum", v)} w="w-28" mono />
                <Cell value={row.invoiceDate} onChange={(v) => update(idx, "invoiceDate", v)} w="w-28" type="date" />
                <Cell value={row.dueDate} onChange={(v) => update(idx, "dueDate", v)} w="w-28" type="date" />
                <Cell value={row.terms} onChange={(v) => update(idx, "terms", v)} w="w-20" />
                <Cell value={row.salesRep} onChange={(v) => update(idx, "salesRep", v)} w="w-20" />
                <Cell value={row.total} onChange={(v) => update(idx, "total", v)} w="w-24" type="number" />
                <Cell value={row.current} onChange={(v) => update(idx, "current", v)} w="w-20" type="number" />
                <Cell value={row.d1_30} onChange={(v) => update(idx, "d1_30", v)} w="w-20" type="number" />
                <Cell value={row.d31_60} onChange={(v) => update(idx, "d31_60", v)} w="w-20" type="number" />
                <Cell value={row.d61_90} onChange={(v) => update(idx, "d61_90", v)} w="w-20" type="number" />
                <Cell value={row.d90_plus} onChange={(v) => update(idx, "d90_plus", v)} w="w-20" type="number" />
                <Cell value={row.credits} onChange={(v) => update(idx, "credits", v)} w="w-20" type="number" />
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
          + Add invoice
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
