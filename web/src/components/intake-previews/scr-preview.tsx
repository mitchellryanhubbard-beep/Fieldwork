import type { SubsequentCashReceipts } from "@/lib/scr-parser";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function ScrPreview({ scr }: { scr: SubsequentCashReceipts }) {
  return (
    <div className="space-y-5">
      <SummaryCard scr={scr} />
      <ReceiptsTable scr={scr} />
    </div>
  );
}

function SummaryCard({ scr }: { scr: SubsequentCashReceipts }) {
  // Quick rollups for the auditor's eye-test on the parse: total $ +
  // distribution by full/partial/credit-memo.
  const counts = scr.receipts.reduce(
    (acc, r) => {
      if (r.amountReceived < 0) acc.credits += 1;
      else if (r.appliedInFull) acc.full += 1;
      else acc.partial += 1;
      return acc;
    },
    { full: 0, partial: 0, credits: 0 },
  );

  return (
    <div className="rounded-xl border border-primary/10 bg-card p-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Stat label="Period" value={scr.periodLabel ?? "—"} />
        <Stat label="Receipts" value={String(scr.receipts.length)} mono />
        <Stat label="Total received" value={USD.format(scr.totalReceived)} mono />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs">
        <div className="rounded-md bg-secondary/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-foreground/55">
            Full payments
          </div>
          <div className="font-mono">{counts.full}</div>
        </div>
        <div className="rounded-md bg-secondary/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-foreground/55">
            Partial payments
          </div>
          <div className="font-mono">{counts.partial}</div>
        </div>
        <div className="rounded-md bg-secondary/40 p-2">
          <div className="text-[10px] uppercase tracking-wider text-foreground/55">
            Credit memos
          </div>
          <div className="font-mono">{counts.credits}</div>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  mono,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wider text-foreground/55">
        {label}
      </div>
      <div className={mono ? "font-mono" : ""}>{value}</div>
    </div>
  );
}

function ReceiptsTable({ scr }: { scr: SubsequentCashReceipts }) {
  return (
    <div className="overflow-hidden rounded-xl border border-primary/10 bg-card">
      <div className="border-b border-primary/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
        Receipts ({scr.receipts.length})
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary text-left text-[10px] uppercase tracking-wide text-foreground/55 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
            <tr>
              <th className="px-3 py-2 font-medium">Receipt #</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Receipt Date</th>
              <th className="px-3 py-2 text-right font-medium">Amount</th>
              <th className="px-3 py-2 font-medium">Full?</th>
              <th className="px-3 py-2 text-right font-medium">Remaining</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-primary/10">
            {scr.receipts.map((r, i) => (
              <tr key={`${r.receiptNum}-${i}`}>
                <td className="px-3 py-1.5 font-mono">{r.receiptNum}</td>
                <td className="px-3 py-1.5">{r.customerName}</td>
                <td className="px-3 py-1.5 font-mono">{r.invoiceNum}</td>
                <td className="px-3 py-1.5 font-mono text-foreground/70">
                  {r.receiptDate ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {USD.format(r.amountReceived)}
                </td>
                <td className="px-3 py-1.5 text-foreground/70">
                  {r.amountReceived < 0
                    ? "CM"
                    : r.appliedInFull
                      ? "Yes"
                      : "No"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground/60">
                  {r.remainingBalance ? USD.format(r.remainingBalance) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
