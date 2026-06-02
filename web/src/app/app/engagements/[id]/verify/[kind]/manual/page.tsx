import Link from "next/link";
import { notFound } from "next/navigation";

import { ManualArAgingGrid } from "@/components/intake-previews/manual-ar-aging-grid";
import { ManualTbGrid } from "@/components/intake-previews/manual-tb-grid";
import { ManualScrGrid } from "@/components/intake-previews/manual-scr-grid";
import {
  KIND_LABELS,
  PARSEABLE_KINDS,
  type ParseableKind,
} from "@/lib/intake/canonical";
import { loadParsedCanonical, loadVerification } from "@/lib/intake/storage";
import { getEngagement } from "@/lib/engagement-repo";

export const dynamic = "force-dynamic";

type Params = { id: string; kind: string };

export default async function ManualMappingPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, kind: kindRaw } = await params;
  if (!(PARSEABLE_KINDS as string[]).includes(kindRaw)) notFound();
  const kind = kindRaw as ParseableKind;

  const detail = await getEngagement(id);
  if (!detail) notFound();

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <nav className="mb-6 text-sm">
        <Link
          href={`/app/engagements/${id}/verify/${kind}`}
          className="text-foreground/60 hover:text-foreground hover:underline"
        >
          ← Verify
        </Link>
      </nav>

      <header className="mb-6">
        <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
          Manual mapping
        </p>
        <h1 className="mt-2 font-display text-3xl font-medium text-primary">
          {KIND_LABELS[kind]}
        </h1>
        <p className="mt-3 max-w-2xl text-sm text-foreground/70">
          Use this when the automated parse can&apos;t extract the data — fill
          in the canonical shape by hand. On save, downstream tests will use
          this as the source of truth (verification is auto-confirmed).
        </p>
      </header>

      {kind === "ar_aging" ? (
        <ManualArAgingPane engagementId={id} kind={kind} />
      ) : kind === "cy_tb" ? (
        <ManualTbPane engagementId={id} />
      ) : kind === "subsequent_cash_receipts" ? (
        <ManualScrPane engagementId={id} />
      ) : (
        <NotImplementedYet kind={kind} />
      )}
    </main>
  );
}

async function ManualArAgingPane({
  engagementId,
}: {
  engagementId: string;
  kind: ParseableKind;
}) {
  const [canonical, verification] = await Promise.all([
    loadParsedCanonical(engagementId, "ar_aging"),
    loadVerification(engagementId, "ar_aging"),
  ]);

  // Seed the grid with the existing canonical data if anything was
  // extracted — fixing AI errors is more common than starting from
  // scratch.
  const invoices = canonical?.invoices ?? [];
  const seedInvoices = invoices.map((inv) => ({
    custNum: inv.custNum,
    custName: inv.custName,
    invoiceNum: inv.invoiceNum,
    invoiceDate: inv.invoiceDate ?? "",
    dueDate: inv.dueDate ?? "",
    terms: inv.terms,
    salesRep: inv.salesRep,
    total: String(inv.total),
    current: String(inv.current),
    d1_30: String(inv.d1_30),
    d31_60: String(inv.d31_60),
    d61_90: String(inv.d61_90),
    d90_plus: String(inv.d90_plus),
    credits: String(inv.credits),
    notes: inv.notes,
  }));

  return (
    <ManualArAgingGrid
      engagementId={engagementId}
      initialInvoices={seedInvoices}
      initialAsOfDate={canonical?.asOfDate ?? ""}
      originalFilename={verification?.originalFilename ?? "manual-entry"}
    />
  );
}

async function ManualTbPane({ engagementId }: { engagementId: string }) {
  const canonical = await loadParsedCanonical(engagementId, "cy_tb");
  const seed = (canonical?.accounts ?? []).map((a) => ({
    acctNum: a.acctNum,
    name: a.name,
    section: a.section,
    cyBalance: String(a.cyBalance),
    pyBalance: String(a.pyBalance),
  }));
  return (
    <ManualTbGrid
      engagementId={engagementId}
      initialClientName={canonical?.clientName ?? ""}
      initialAccounts={seed}
    />
  );
}

async function ManualScrPane({ engagementId }: { engagementId: string }) {
  const canonical = await loadParsedCanonical(
    engagementId,
    "subsequent_cash_receipts",
  );
  const seed = (canonical?.receipts ?? []).map((r) => ({
    receiptNum: r.receiptNum,
    customerName: r.customerName,
    invoiceNum: r.invoiceNum,
    invoiceDate: r.invoiceDate ?? "",
    invoiceAmount: String(r.invoiceAmount),
    receiptDate: r.receiptDate ?? "",
    amountReceived: String(r.amountReceived),
    appliedInFull: r.appliedInFull,
    remainingBalance: String(r.remainingBalance),
    notes: r.notes,
  }));
  return (
    <ManualScrGrid
      engagementId={engagementId}
      initialPeriodLabel={canonical?.periodLabel ?? ""}
      initialReceipts={seed}
    />
  );
}

function NotImplementedYet({ kind }: { kind: ParseableKind }) {
  return (
    <div className="rounded-xl border border-primary/10 bg-card p-6 text-sm text-foreground/70">
      Manual mapping for {KIND_LABELS[kind]} ships in a later slice. For now,
      re-upload as Excel or CSV.
    </div>
  );
}
