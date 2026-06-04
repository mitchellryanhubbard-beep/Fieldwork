"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { GenerateAccountWorkpaperButton } from "@/components/generate-account-workpaper-button";
import { GenerateCyWorkpaperButton } from "@/components/generate-cy-workpaper-button";
import { PyUploadForm } from "@/components/py-upload-form";
import { PyUntaggedBanner } from "@/components/py-untagged-banner";
import {
  clearPyRolledCyAction,
  deleteAccountWorkpaperAction,
  deleteConfirmationsAction,
  deletePyWorkpaperAction,
} from "@/app/app/engagements/actions";
import type { ScopedAccountListing } from "@/lib/account-workpaper-listing";
import type { PyWorkpaper } from "@/lib/py-workpaper-repo";

export type WorkpapersSectionProps = {
  engagementId: string;
  accounts: ScopedAccountListing[];
  generatedAcctNums: string[];
  generatedConfirmationAcctNums: string[];
  hasArAging: boolean;
  hasTrialBalance: boolean;
  pyWorkpapers: PyWorkpaper[];
  pyWorkpapersByFsli: Record<string, PyWorkpaper[]>;
  fsliByAcctNum: Record<string, string>;
  workpaperBlockedReason?: string;
  confirmationsBlockedReason?: string;
};

export function WorkpapersSection({
  engagementId,
  accounts,
  generatedAcctNums,
  generatedConfirmationAcctNums,
  hasArAging,
  hasTrialBalance,
  pyWorkpapers,
  pyWorkpapersByFsli,
  fsliByAcctNum,
  workpaperBlockedReason,
  confirmationsBlockedReason,
}: WorkpapersSectionProps) {
  const generated = new Set(generatedAcctNums);
  const confirmationsGenerated = new Set(generatedConfirmationAcctNums);

  if (!hasTrialBalance) {
    return (
      <div className="rounded-xl border border-primary/10 bg-card p-5 text-sm text-foreground/70">
        Upload the CY trial balance to see workpapers here.
      </div>
    );
  }

  const pyGroupNames = Object.keys(pyWorkpapersByFsli)
    .filter((g) => g)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const untaggedPy = [...pyWorkpapers]
    .filter((wp) => !wp.fsli)
    .sort((a, b) =>
      a.originalFilename.localeCompare(b.originalFilename, undefined, {
        numeric: true,
      }),
    );
  const untaggedCount = untaggedPy.length;
  // Collapse multiple scoped accounts in the same FSLI to a single
  // "leader" account (largest |cyBalance|) so each FSLI renders one
  // CY card. Without this, an FSLI like "Accounts Receivable, net"
  // that maps to Trade + Other + Allowance shows three duplicate
  // cards in the Current Year section.
  const leaderByFsli = new Map<string, ScopedAccountListing>();
  for (const a of accounts) {
    const fsli = fsliByAcctNum[a.acctNum] ?? "Unsorted";
    const current = leaderByFsli.get(fsli);
    if (!current || Math.abs(a.cyBalance) > Math.abs(current.cyBalance)) {
      leaderByFsli.set(fsli, a);
    }
  }
  const sortedAccounts = [...leaderByFsli.values()].sort((a, b) =>
    a.acctNum.localeCompare(b.acctNum, undefined, { numeric: true }),
  );

  return (
    <div className="space-y-8">
      {/* ---------- PY section (on top) ---------- */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/55">
          <span>Prior year</span>
          {pyWorkpapers.length > 0 ? (
            <span className="font-normal normal-case text-foreground/55">
              {pyWorkpapers.length} file
              {pyWorkpapers.length === 1 ? "" : "s"}
            </span>
          ) : null}
        </div>

        <PyUploadForm engagementId={engagementId} />

        {untaggedCount > 0 ? (
          <PyUntaggedBanner
            engagementId={engagementId}
            count={untaggedCount}
          />
        ) : null}

        {pyWorkpapers.length === 0 ? (
          <p className="rounded-xl border border-primary/10 bg-card p-4 text-sm text-foreground/70">
            No prior-year workpapers uploaded yet.
          </p>
        ) : (
          <div className="space-y-3">
            {pyGroupNames.map((group) => (
              <PyGroup
                key={group}
                workpapers={[...pyWorkpapersByFsli[group]].sort((a, b) =>
                  a.originalFilename.localeCompare(b.originalFilename, undefined, {
                    numeric: true,
                  }),
                )}
                engagementId={engagementId}
              />
            ))}
            {untaggedCount > 0 ? (
              <PyGroup
                workpapers={untaggedPy}
                engagementId={engagementId}
              />
            ) : null}
          </div>
        )}
      </div>

      {/* ---------- CY section (below) ---------- */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-[0.18em] text-foreground/55">
          Current year
        </div>
        {sortedAccounts.length === 0 ? (
          <p className="rounded-xl border border-primary/10 bg-card p-4 text-sm text-foreground/70">
            No scoped accounts in the trial balance.
          </p>
        ) : (
          sortedAccounts.map((a) => {
            const fsli = fsliByAcctNum[a.acctNum] ?? "";
            const pyForAccount = pyWorkpapersByFsli[fsli] ?? [];
            const fromScratchExists = generated.has(a.acctNum);
            const confirmationsExist = confirmationsGenerated.has(a.acctNum);
            const rolledForward = pyForAccount
              .filter((py) => !!py.generatedCyStoragePath)
              .sort((a, b) =>
                a.originalFilename.localeCompare(b.originalFilename, undefined, {
                  numeric: true,
                }),
              );

            return (
              <div
                key={a.acctNum}
                className="rounded-xl border border-primary/10 bg-card overflow-hidden"
              >
                <div className="p-4 space-y-3">

                <ul className="divide-y divide-primary/10 text-sm pl-6 border-l-2 border-primary/10 ml-1">
                  {fromScratchExists ? (
                    <WorkpaperRow
                      label={`${a.name} workpaper`}
                      sub="Generated from scratch"
                      downloadHref={`/api/workpapers/account?engagementId=${encodeURIComponent(engagementId)}&acctNum=${encodeURIComponent(a.acctNum)}`}
                      onRemove={() =>
                        deleteAccountWorkpaperAction(engagementId, a.acctNum)
                      }
                      removeConfirm={`Remove the from-scratch workpaper for ${a.name}? The locked sample stays so you can regenerate.`}
                    />
                  ) : null}
                  {confirmationsExist ? (
                    <WorkpaperRow
                      label="Confirmation requests"
                      sub="Generated from sample"
                      downloadHref={`/api/workpapers/account/confirmations?engagementId=${encodeURIComponent(engagementId)}&acctNum=${encodeURIComponent(a.acctNum)}`}
                      onRemove={() =>
                        deleteConfirmationsAction(engagementId, a.acctNum)
                      }
                      removeConfirm={`Remove the confirmations workbook for ${a.name}?`}
                    />
                  ) : null}
                  {rolledForward.map((py) => (
                    <WorkpaperRow
                      key={py.id}
                      label={cyFilenameFromPy(py.originalFilename)}
                      sub="Generated from PY Workpaper"
                      downloadHref={`/api/py-workpapers/download-cy?pyWorkpaperId=${encodeURIComponent(py.id)}`}
                      onRemove={() =>
                        clearPyRolledCyAction(engagementId, py.id)
                      }
                      removeConfirm={`Remove the rolled-forward CY for ${py.originalFilename}? The PY file stays so you can re-roll.`}
                    />
                  ))}
                  {!fromScratchExists &&
                  !confirmationsExist &&
                  rolledForward.length === 0 ? (
                    <li className="py-2 text-xs text-foreground/55">
                      No CY workpapers yet — generate from scratch or roll
                      forward a PY workpaper.
                    </li>
                  ) : null}
                </ul>

                {!fromScratchExists ? (
                  <div className="flex flex-wrap items-center gap-2 border-t border-primary/10 pt-3">
                    <GenerateAccountWorkpaperButton
                      engagementId={engagementId}
                      acctNum={a.acctNum}
                      accountName={a.name}
                      alreadyGenerated={fromScratchExists}
                      generationBlockedReason={workpaperBlockedReason}
                    />
                  </div>
                ) : null}
                </div>
              </div>
            );
          })
        )}
      </div>

    </div>
  );
}

type ActionResult = { ok: true } | { ok: false; error: string };

function WorkpaperRow({
  label,
  sub,
  downloadHref,
  onRemove,
  removeConfirm,
}: {
  label: string;
  sub: string;
  downloadHref: string;
  onRemove: () => Promise<ActionResult>;
  removeConfirm: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleRemove = () => {
    if (!confirm(removeConfirm)) return;
    startTransition(async () => {
      const res = await onRemove();
      if (!res.ok) {
        alert(`Remove failed: ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-foreground">{label}</div>
        <div className="text-[10px] uppercase tracking-wider text-foreground/55">
          {sub}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          className="rounded-md border border-primary/15 px-2 py-1 text-xs text-foreground/70 hover:bg-primary/5 disabled:opacity-50"
        >
          {pending ? "Removing…" : "Remove"}
        </button>
        <a
          href={downloadHref}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Download
        </a>
      </div>
    </li>
  );
}

function PyGroup({
  workpapers,
  engagementId,
}: {
  workpapers: PyWorkpaper[];
  engagementId: string;
}) {
  return (
    <div className="rounded-xl border border-primary/10 bg-card p-4">
      <ul className="divide-y divide-primary/10 text-sm pl-6 border-l-2 border-primary/10 ml-1">
        {workpapers.map((wp) => (
          <PyRow key={wp.id} wp={wp} engagementId={engagementId} />
        ))}
      </ul>
    </div>
  );
}

function PyRow({
  wp,
  engagementId,
}: {
  wp: PyWorkpaper;
  engagementId: string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const handleRemove = () => {
    if (
      !confirm(
        `Remove ${wp.originalFilename}? This deletes the PY file${wp.generatedCyStoragePath ? " AND its rolled-forward CY" : ""}.`,
      )
    )
      return;
    startTransition(async () => {
      const res = await deletePyWorkpaperAction(engagementId, wp.id);
      if (!res.ok) {
        alert(`Remove failed: ${res.error}`);
        return;
      }
      router.refresh();
    });
  };

  return (
    <li className="flex items-center justify-between gap-3 py-2">
      <div className="min-w-0">
        <div className="truncate text-foreground">{wp.originalFilename}</div>
        <div className="text-[10px] uppercase tracking-wider text-foreground/55">
          {wp.generatedCyAt
            ? `Rolled forward · ${new Date(wp.generatedCyAt).toLocaleDateString()}`
            : "PY only"}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <button
          type="button"
          onClick={handleRemove}
          disabled={pending}
          className="rounded-md border border-primary/15 px-2 py-1 text-xs text-foreground/70 hover:bg-primary/5 disabled:opacity-50"
        >
          {pending ? "Removing…" : "Remove"}
        </button>
        <a
          href={`/api/py-workpapers/download?pyWorkpaperId=${encodeURIComponent(wp.id)}`}
          className="rounded-md bg-primary px-2 py-1 text-xs font-medium text-primary-foreground hover:bg-primary/90"
        >
          Download
        </a>
        {!wp.generatedCyStoragePath ? (
          <GenerateCyWorkpaperButton
            pyWorkpaperId={wp.id}
            pyFilename={wp.originalFilename}
            alreadyGenerated={false}
          />
        ) : null}
      </div>
    </li>
  );
}

function cyFilenameFromPy(originalFilename: string): string {
  return originalFilename.replace(/\.[a-z0-9]+$/i, "_CY.xlsx");
}
