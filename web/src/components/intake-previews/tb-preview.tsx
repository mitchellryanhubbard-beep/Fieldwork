import type { TrialBalance, TrialBalanceAccount } from "@/lib/tb-parser";

const USD = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function TbPreview({ tb }: { tb: TrialBalance }) {
  return (
    <div className="space-y-5">
      <SummaryCard tb={tb} />
      <AccountsTable tb={tb} />
    </div>
  );
}

function SummaryCard({ tb }: { tb: TrialBalance }) {
  const totals = tb.accounts.reduce(
    (acc, a) => {
      acc.byCount[a.section] = (acc.byCount[a.section] ?? 0) + 1;
      acc.byCy[a.section] = (acc.byCy[a.section] ?? 0) + a.cyBalance;
      acc.byPy[a.section] = (acc.byPy[a.section] ?? 0) + a.pyBalance;
      return acc;
    },
    {
      byCount: {} as Record<string, number>,
      byCy: {} as Record<string, number>,
      byPy: {} as Record<string, number>,
    },
  );
  const sectionOrder: TrialBalanceAccount["section"][] = [
    "Asset",
    "Liability",
    "Equity",
    "Revenue",
    "Expense",
  ];
  return (
    <div className="rounded-xl border border-primary/10 bg-card p-5">
      <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm sm:grid-cols-3">
        <Stat label="Client" value={tb.clientName} />
        <Stat label="Accounts" value={String(tb.accounts.length)} mono />
        <Stat
          label="Financial Statement Sections"
          value={`${Object.keys(totals.byCount).length} / 5`}
          mono
        />
      </div>
      <div className="mt-4 grid grid-cols-2 gap-2 text-xs sm:grid-cols-5">
        {sectionOrder.map((s) => (
          <div key={s} className="rounded-md bg-secondary/40 p-2">
            <div className="text-[10px] uppercase tracking-wider text-foreground/55">
              {s}
            </div>
            <div className="font-mono">
              {USD.format(totals.byCy[s] ?? 0)}
            </div>
            <div className="font-mono text-[10px] text-foreground/55">
              {totals.byCount[s] ?? 0} acct
            </div>
          </div>
        ))}
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

function AccountsTable({ tb }: { tb: TrialBalance }) {
  return (
    <div className="overflow-hidden rounded-xl border border-primary/10 bg-card">
      <div className="border-b border-primary/10 px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-foreground/55">
        Accounts ({tb.accounts.length})
      </div>
      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-xs">
          <thead className="sticky top-0 z-10 bg-secondary text-left text-[10px] uppercase tracking-wide text-foreground/55 shadow-[0_1px_0_0_rgba(0,0,0,0.08)]">
            <tr>
              <th className="px-3 py-2 font-medium">Acct #</th>
              <th className="px-3 py-2 font-medium">Account</th>
              <th className="px-3 py-2 font-medium">Section</th>
              <th className="px-3 py-2 text-right font-medium">CY</th>
              <th className="px-3 py-2 text-right font-medium">PY</th>
              <th className="px-3 py-2 font-medium">Scoping</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-primary/10">
            {tb.accounts.map((a) => (
              <tr key={`${a.acctNum}-${a.name}`}>
                <td className="px-3 py-1.5 font-mono">{a.acctNum}</td>
                <td className="px-3 py-1.5">{a.name}</td>
                <td className="px-3 py-1.5 text-foreground/70">{a.section}</td>
                <td className="px-3 py-1.5 text-right font-mono">
                  {USD.format(a.cyBalance)}
                </td>
                <td className="px-3 py-1.5 text-right font-mono text-foreground/60">
                  {USD.format(a.pyBalance)}
                </td>
                <td className="px-3 py-1.5 text-foreground/70">
                  {a.materialityScoping || "—"}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
