"use client";

import * as React from "react";

import { cn } from "@/lib/utils";

// Renders the list of previously-generated artifacts (binder or matrix)
// for an engagement, with a download link for each. Used directly under
// the Generate button so an auditor can grab a prior run instead of
// re-generating from scratch.
//
// Refresh hook: the parent can pass `refreshKey` (incremented after a
// fresh generation) to force a re-fetch.

export type GeneratedArtifact = {
  path: string;
  filename: string;
  generatedAt: string;
  sizeBytes: number;
};

export type GeneratedArtifactHistoryProps = {
  engagementId: string;
  kind: "binder" | "matrix";
  refreshKey?: number;
  label?: string;
  maxItems?: number;
};

export function GeneratedArtifactHistory({
  engagementId,
  kind,
  refreshKey = 0,
  label,
  maxItems = 5,
}: GeneratedArtifactHistoryProps) {
  const [artifacts, setArtifacts] = React.useState<GeneratedArtifact[]>([]);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    fetch(
      `/api/workpapers/generated?engagementId=${encodeURIComponent(engagementId)}&kind=${kind}&t=${Date.now()}`,
      { cache: "no-store" },
    )
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.error ?? `HTTP ${res.status}`);
        }
        return res.json() as Promise<{ artifacts: GeneratedArtifact[] }>;
      })
      .then((body) => {
        if (cancelled) return;
        setArtifacts(body.artifacts);
        setLoading(false);
      })
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [engagementId, kind, refreshKey]);

  if (loading) {
    return (
      <p className="mt-1 text-xs text-foreground/50">Loading prior runs…</p>
    );
  }
  if (error) {
    return (
      <p className="mt-1 text-xs text-destructive">
        Failed to load history: {error}
      </p>
    );
  }
  if (artifacts.length === 0) {
    return (
      <p className="mt-1 text-xs text-foreground/50">No prior runs yet.</p>
    );
  }

  const trimmed = artifacts.slice(0, maxItems);
  return (
    <div className="mt-1.5 flex flex-col gap-0.5">
      {label ? (
        <p className="text-xs font-medium text-foreground/60">{label}</p>
      ) : null}
      {trimmed.map((a) => (
        <ArtifactRow
          key={a.path}
          engagementId={engagementId}
          kind={kind}
          artifact={a}
        />
      ))}
      {artifacts.length > maxItems ? (
        <p className="text-xs text-foreground/40">
          +{artifacts.length - maxItems} older run
          {artifacts.length - maxItems === 1 ? "" : "s"}
        </p>
      ) : null}
    </div>
  );
}

function ArtifactRow({
  engagementId,
  kind,
  artifact,
}: {
  engagementId: string;
  kind: "binder" | "matrix";
  artifact: GeneratedArtifact;
}) {
  const downloadHref = `/api/workpapers/generated/download?engagementId=${encodeURIComponent(
    engagementId,
  )}&kind=${kind}&path=${encodeURIComponent(artifact.path)}`;
  return (
    <a
      href={downloadHref}
      className={cn(
        "inline-flex items-center gap-2 truncate rounded-md px-1.5 py-0.5 text-xs text-foreground/75 hover:bg-foreground/5 hover:text-foreground",
      )}
      title={artifact.filename}
    >
      <span className="truncate">{formatTimestamp(artifact.generatedAt)}</span>
      <span className="text-foreground/40">·</span>
      <span className="text-foreground/45">{formatBytes(artifact.sizeBytes)}</span>
      <span className="ml-auto text-accent">Download</span>
    </a>
  );
}

function formatTimestamp(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (!bytes) return "—";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
