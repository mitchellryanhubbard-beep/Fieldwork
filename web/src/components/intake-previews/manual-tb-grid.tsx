"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { saveManualTrialBalanceAction } from "@/app/app/engagements/actions";
import { Button } from "@/components/ui/button";

// Editable grid for the Trial Balance. Five fields per account
// (acctNum / name / section / cyBalance / pyBalance) per the scoping
// principle — no auditor-commentary columns.

type Draft = {
  acctNum: string;
  name: string;
  section: string;
  cyBalance: string;
  pyBalance: string;
};

const SECTIONS = ["Asset", "Liability", "Equity", "Revenue", "Expense"] as const;

const EMPTY_ROW: Draft = {
  acctNum: "",
  name: "",
  section: "Asset",
  cyBalance: "",
  pyBalance: "",
};

export type ManualTbGridProps = {
  engagementId: string;
  initialClientName: string;
  initialAccounts: Draft[];
};

export function ManualTbGrid({
  engagementId,
  initialClientName,
  initialAccounts,
}: ManualTbGridProps) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [clientName, setClientName] = useState(initialClientName);
  const [rows, setRows] = useState<Draft[]>(
    initialAccounts.length > 0 ? initialAccounts : [{ ...EMPTY_ROW }],
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
      const result = await saveManualTrialBalanceAction(
        engagementId,
        clientName,
        rows,
      );
      if (!result.ok) {
        toast.error("Couldn't save manual mapping", { description: result.error });
        return;
      }
      toast.success("Trial Balance saved — verification confirmed", {
        description: "Downstream tests will use this canonical data.",
      });
      router.push(`/app/engagements/${engagementId}/verify/cy_tb`);
      router.refresh();
    });
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3 rounded-xl border border-primary/10 bg-card p-4">
        <label className="block">
          <span className="block text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
            Client name
          </span>
          <input
            type="text"
            value={clientName}
            onChange={(e) => setClientName(e.target.value)}
            className="mt-1 w-72 rounded-md border border-primary/15 bg-background px-2 py-1 text-sm focus:border-primary/40 focus:outline-none"
          />
        </label>
        <div className="text-xs text-foreground/60">
          {rows.length} account{rows.length === 1 ? "" : "s"}
        </div>
      </div>

      <div className="overflow-x-auto rounded-xl border border-primary/10 bg-card">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary text-left text-[10px] uppercase tracking-wide text-foreground/55 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
            <tr>
              {[
                "Acct #",
                "Account",
                "Section",
                "CY Balance",
                "PY Balance",
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
                <Cell value={row.acctNum} onChange={(v) => update(idx, "acctNum", v)} w="w-20" mono />
                <Cell value={row.name} onChange={(v) => update(idx, "name", v)} w="w-64" />
                <td className="px-1 py-1">
                  <select
                    value={row.section}
                    onChange={(e) => update(idx, "section", e.target.value)}
                    className="w-28 rounded border border-primary/10 bg-background px-1.5 py-0.5 text-xs focus:border-primary/40 focus:outline-none"
                  >
                    {SECTIONS.map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                </td>
                <Cell value={row.cyBalance} onChange={(v) => update(idx, "cyBalance", v)} w="w-32" type="number" />
                <Cell value={row.pyBalance} onChange={(v) => update(idx, "pyBalance", v)} w="w-32" type="number" />
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
          + Add account
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
  type?: "text" | "number";
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
