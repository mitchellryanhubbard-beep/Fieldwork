import type { ArAging } from "@/lib/ar-aging-parser";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function ArAgingPreview({ aging }: { aging: ArAging }) {
  return (
    <div className="space-y-5">
      <SummaryCard aging={aging} />
      <CustomersTable aging={aging} />
      <InvoicesTable aging={aging} />
    </div>
  );
}

function SummaryCard({ aging }: { aging: ArAging }) {
  const bucketTotals = aging.customers.reduce(
    (acc, c) => ({
      current: acc.current + c.current,
      d1_30: acc.d1_30 + c.d1_30,
      d31_60: acc.d31_60 + c.d31_60,
      d61_90: acc.d61_90 + c.d61_90,
      d90_plus: acc.d90_plus + c.d90_plus,
      credits: acc.credits + c.credits,
    }),
    { current: 0, d1_30: 0, d31_60: 0, d61_90: 0, d90_plus: 0, credits: 0 },
  );
  return (
    <div className="rounded-xl border border-primary/10 bg-card p-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-4">
        <Stat label="As of" value={aging.asOfDate ?? "—"} mono />
        <Stat label="Customers" value={String(aging.customers.length)} mono />
        <Stat label="Invoices" value={String(aging.invoices.length)} mono />
        <Stat label="Total" value={USD.format(aging.total)} mono />
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-xs sm:grid-cols-6">
        <Stat label="Current" value={USD.format(bucketTotals.current)} />
        <Stat label="1-30" value={USD.format(bucketTotals.d1_30)} />
        <Stat label="31-60" value={USD.format(bucketTotals.d31_60)} />
        <Stat label="61-90" value={USD.format(bucketTotals.d61_90)} />
        <Stat label="90+" value={USD.format(bucketTotals.d90_plus)} />
        <Stat label="Credits" value={USD.format(bucketTotals.credits)} />
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

function CustomersTable({ aging }: { aging: ArAging }) {
  return (
    <div className="overflow-hidden rounded-xl border border-primary/10 bg-card">
      <div className="border-b border-primary/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
        Customers ({aging.customers.length})
      </div>
      <div className="max-h-[260px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-primary/5 text-left text-[10px] uppercase tracking-wide text-foreground/55">
            <tr>
              <th className="px-3 py-2 font-medium">Cust #</th>
              <th className="px-3 py-2 font-medium">Customer</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">Invoices</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-primary/10">
            {aging.customers.map((c) => (
              <tr key={c.custNum}>
                <td className="px-3 py-1.5 font-mono">{c.custNum}</td>
                <td className="px-3 py-1.5">{c.custName}</td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {USD.format(c.total)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground/60">
                  {c.invoiceCount}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function InvoicesTable({ aging }: { aging: ArAging }) {
  return (
    <div className="overflow-hidden rounded-xl border border-primary/10 bg-card">
      <div className="border-b border-primary/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
        Invoices ({aging.invoices.length})
      </div>
      <div className="max-h-[360px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="bg-primary/5 text-left text-[10px] uppercase tracking-wide text-foreground/55">
            <tr>
              <th className="px-3 py-2 font-medium">Cust</th>
              <th className="px-3 py-2 font-medium">Invoice</th>
              <th className="px-3 py-2 font-medium">Date</th>
              <th className="px-3 py-2 font-medium">Due</th>
              <th className="px-3 py-2 text-right font-medium">Total</th>
              <th className="px-3 py-2 text-right font-medium">1-30</th>
              <th className="px-3 py-2 text-right font-medium">31-60</th>
              <th className="px-3 py-2 text-right font-medium">61-90</th>
              <th className="px-3 py-2 text-right font-medium">90+</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-primary/10">
            {aging.invoices.map((inv, i) => (
              <tr key={`${inv.custNum}-${inv.invoiceNum}-${i}`}>
                <td className="px-3 py-1.5 font-mono">{inv.custNum}</td>
                <td className="px-3 py-1.5 font-mono">{inv.invoiceNum}</td>
                <td className="px-3 py-1.5 font-mono text-foreground/70">
                  {inv.invoiceDate ?? "—"}
                </td>
                <td className="px-3 py-1.5 font-mono text-foreground/70">
                  {inv.dueDate ?? "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {USD.format(inv.total)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground/60">
                  {inv.d1_30 ? USD.format(inv.d1_30) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground/60">
                  {inv.d31_60 ? USD.format(inv.d31_60) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground/60">
                  {inv.d61_90 ? USD.format(inv.d61_90) : "—"}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground/60">
                  {inv.d90_plus ? USD.format(inv.d90_plus) : "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
