import Link from "next/link";
import { notFound } from "next/navigation";

import {
  loadParsedCanonical,
  loadVerification,
  type VerificationRecord,
} from "@/lib/intake/storage";
import {
  KIND_LABELS,
  PARSEABLE_KINDS,
  type ParseableKind,
} from "@/lib/intake/canonical";
import {
  getEngagement,
  getEngagementFileSignedUrl,
  type FileMeta,
} from "@/lib/engagement-repo";
import { ConfirmIntakeButton } from "@/components/confirm-intake-button";
import { ArAgingPreview } from "@/components/intake-previews/ar-aging-preview";
import { TbPreview } from "@/components/intake-previews/tb-preview";
import { ScrPreview } from "@/components/intake-previews/scr-preview";
import { Chip } from "@/components/ui/chip";
import { buttonVariants } from "@/components/ui/button";

export const dynamic = "force-dynamic";

type Params = { id: string; kind: string };

const KIND_TO_FILE_FIELD: Record<ParseableKind, string> = {
  ar_aging: "arAgingFile",
  cy_tb: "cyTrialBalanceFile",
  subsequent_cash_receipts: "subsequentCashReceiptsFile",
};

export default async function VerifyPage({
  params,
}: {
  params: Promise<Params>;
}) {
  const { id, kind: kindRaw } = await params;
  if (!(PARSEABLE_KINDS as string[]).includes(kindRaw)) notFound();
  const kind = kindRaw as ParseableKind;

  const detail = await getEngagement(id);
  if (!detail) notFound();

  const field = KIND_TO_FILE_FIELD[kind];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const file = (detail as any)[field] as FileMeta | null;
  if (!file) {
    return (
      <main className="mx-auto w-full max-w-5xl px-6 py-12">
        <BackLink id={id} />
        <h1 className="font-display text-3xl font-medium text-primary">
          Verify — {KIND_LABELS[kind]}
        </h1>
        <p className="mt-4 text-sm text-foreground/70">
          No {KIND_LABELS[kind]} file has been uploaded for this engagement yet.
        </p>
      </main>
    );
  }

  const [canonical, verification, signedUrl] = await Promise.all([
    loadParsedCanonical(id, kind),
    loadVerification(id, kind),
    getEngagementFileSignedUrl(file.storagePath, 3600),
  ]);

  return (
    <main className="mx-auto w-full max-w-7xl px-6 py-10">
      <BackLink id={id} />

      <header className="mb-6 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-accent">
            Verify upload
          </p>
          <h1 className="mt-2 font-display text-3xl font-medium text-primary">
            {KIND_LABELS[kind]}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-foreground/70">
            <span className="font-mono text-xs">{file.originalFilename}</span>
            <Chip>{prettyFormat(verification?.sourceFormat)}</Chip>
            <StatusBadge verification={verification} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link
            href={`/app/engagements/${id}/verify/${kind}/manual`}
            className={buttonVariants({ variant: "goldOutline", size: "sm" })}
          >
            {editLinkLabel(verification?.status)}
          </Link>
          <ConfirmIntakeButton
            engagementId={id}
            kind={kind}
            disabled={!canonical || verification?.status !== "pending"}
          />
        </div>
      </header>

      {verification?.status === "failed" ? (
        <div className="mb-6 rounded-xl border border-destructive/40 bg-destructive/5 p-5">
          <p className="font-medium text-destructive">
            We couldn&apos;t extract structured data from this file.
          </p>
          <p className="mt-1 text-sm text-foreground/70">
            {verification.failureMessage ?? "Unknown error"}
          </p>
          {kind === "ar_aging" ? (
            <p className="mt-3 text-sm text-foreground/70">
              Fill it in by hand with{" "}
              <Link
                href={`/app/engagements/${id}/verify/${kind}/manual`}
                className="text-accent hover:underline"
              >
                Manual mapping
              </Link>
              , or re-upload as Excel/CSV.
            </p>
          ) : (
            <p className="mt-3 text-sm text-foreground/70">
              Re-upload as Excel/CSV. Manual mapping for this kind ships in a
              later slice.
            </p>
          )}
        </div>
      ) : null}

      <section>
        <h2 className="mb-3 flex items-center justify-between text-xs font-semibold uppercase tracking-[0.18em] text-foreground/60">
          <span>Parsed canonical data</span>
          <a
            href={signedUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[10px] font-medium normal-case tracking-normal text-accent hover:underline"
          >
            Open original {prettyFormat(verification?.sourceFormat)} ↗
          </a>
        </h2>
        {canonical ? (
          <ParsedPreview kind={kind} canonical={canonical} />
        ) : (
          <div className="rounded-xl border border-primary/10 bg-card p-5 text-sm text-foreground/70">
            No parsed data — see the failure above.
          </div>
        )}
      </section>
    </main>
  );
}

function BackLink({ id }: { id: string }) {
  return (
    <nav className="mb-6 text-sm">
      <Link
        href={`/app/engagements/${id}`}
        className="text-foreground/60 hover:text-foreground hover:underline"
      >
        ← Engagement
      </Link>
    </nav>
  );
}

function StatusBadge({
  verification,
}: {
  verification: VerificationRecord | null;
}) {
  if (!verification) {
    return (
      <span className="rounded-full bg-foreground/10 px-2 py-0.5 text-[10px] uppercase tracking-wider text-foreground/60">
        Not parsed
      </span>
    );
  }
  const map = {
    pending: "bg-amber-100 text-amber-900",
    confirmed: "bg-emerald-100 text-emerald-900",
    failed: "bg-rose-100 text-rose-900",
  } as const;
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[10px] uppercase tracking-wider ${map[verification.status]}`}
    >
      {verification.status}
    </span>
  );
}

function prettyFormat(format: string | undefined): string {
  if (!format) return "Unknown";
  if (format === "xlsx") return "Excel";
  if (format === "pdf") return "PDF";
  if (format === "csv") return "CSV";
  if (format === "image") return "Image";
  if (format === "docx") return "Word";
  return format;
}

function editLinkLabel(status: string | undefined): string {
  switch (status) {
    case "failed":
      return "Fill in manually";
    case "confirmed":
      return "Edit";
    case "pending":
    default:
      return "Edit data";
  }
}

function ParsedPreview({
  kind,
  canonical,
}: {
  kind: ParseableKind;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  canonical: any;
}) {
  if (kind === "ar_aging") return <ArAgingPreview aging={canonical} />;
  if (kind === "cy_tb") return <TbPreview tb={canonical} />;
  if (kind === "subsequent_cash_receipts") return <ScrPreview scr={canonical} />;
  return (
    <div className="rounded-xl border border-primary/10 bg-card p-5">
      <p className="text-sm text-foreground/70">
        Preview component for {KIND_LABELS[kind]} ships in a later phase.
      </p>
      <details className="mt-4">
        <summary className="cursor-pointer text-xs uppercase tracking-wider text-foreground/55">
          Raw JSON
        </summary>
        <pre className="mt-2 overflow-auto rounded-md bg-secondary/40 p-3 text-xs">
          {JSON.stringify(canonical, null, 2)}
        </pre>
      </details>
    </div>
  );
}

