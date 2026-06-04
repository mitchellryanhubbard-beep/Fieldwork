"use client";

import {
  useLayoutEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { FilePicker } from "@/components/ui/file-picker";
import { uploadFileAction } from "@/app/app/engagements/actions";

export type FileUploadProps = {
  engagementId: string;
  kind: "py_audit" | "cy_tb" | "ar_aging" | "subsequent_cash_receipts";
  title: string;
  description: string;
  accept: string;
  current?: {
    originalFilename: string;
    sizeBytes: number;
    uploadedAt: string;
  } | null;
  verification?: {
    status: "pending" | "confirmed" | "failed";
  } | null;
};

export function FileUpload({
  engagementId,
  kind,
  title,
  description,
  accept,
  current,
  verification,
}: FileUploadProps) {
  const isParseable =
    kind === "ar_aging" ||
    kind === "cy_tb" ||
    kind === "subsequent_cash_receipts";
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);
  // Bump after every successful upload to force-remount the FilePicker
  // so its internal "selected filename" label resets back to blank.
  // Resetting inputRef.current.value alone clears the underlying input
  // but doesn't redraw the picker's display.
  const [pickerKey, setPickerKey] = useState(0);
  // Scroll-restoration bookkeeping. After router.refresh() the FSLI
  // <details> tree can re-render around the user — sometimes the page
  // shrinks (a details closes), sometimes it grows (the upload card
  // now shows the verification chip). Restoring an absolute scrollY
  // misses on both counts. Instead we keep a ref to THIS upload card's
  // outer div and scroll it back to the same viewport position it had
  // at the moment of submit. The DOM node is the anchor, so as long
  // as it still exists post-refresh the user lands back on it.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const targetTopRef = useRef<number | null>(null);

  // useLayoutEffect fires synchronously after commit / before paint so
  // the first restore lands without a flash of the wrong scroll. The
  // chained rAFs + setTimeouts pick up any later layout shifts (intake
  // status chip, FSLI details re-rendering, toast removal) that move
  // the card after the initial restore.
  useLayoutEffect(() => {
    if (isPending || targetTopRef.current == null) return;
    const targetTop = targetTopRef.current;
    targetTopRef.current = null;
    const restore = () => {
      const el = containerRef.current;
      if (!el) return;
      const currentTop = el.getBoundingClientRect().top;
      const delta = currentTop - targetTop;
      if (Math.abs(delta) < 0.5) return;
      window.scrollBy({
        top: delta,
        behavior: "instant" as ScrollBehavior,
      });
    };
    restore();
    requestAnimationFrame(() => {
      restore();
      requestAnimationFrame(restore);
    });
    const t1 = setTimeout(restore, 50);
    const t2 = setTimeout(restore, 200);
    const t3 = setTimeout(restore, 500);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
      clearTimeout(t3);
    };
  }, [isPending]);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const file = inputRef.current?.files?.[0];
    if (!file) {
      setError("Choose a file first.");
      return;
    }
    // Snapshot this card's distance from the top of the viewport so
    // we can put it back in the same spot after the refresh.
    const rect = containerRef.current?.getBoundingClientRect();
    targetTopRef.current = rect ? rect.top : 0;
    const form = new FormData();
    form.append("engagementId", engagementId);
    form.append("kind", kind);
    form.append("file", file);

    startTransition(async () => {
      const toastId = toast.loading(
        isParseable ? `Parsing ${title}…` : `Uploading ${title}…`,
        {
          description: isParseable
            ? "Extracting structured data — PDFs can take 30-60 seconds."
            : undefined,
        },
      );
      const result = await uploadFileAction(form);
      if (!result.ok) {
        setError(result.error);
        toast.error(isParseable ? "Parsing failed" : "Upload failed", {
          id: toastId,
          description: result.error,
        });
        return;
      }
      toast.success(isParseable ? `${title} parsed` : `${title} uploaded`, {
        id: toastId,
        description: isParseable ? "Open Verify to review extracted data." : undefined,
      });
      if (inputRef.current) inputRef.current.value = "";
      setPickerKey((k) => k + 1);
      router.refresh();
    });
  }

  return (
    <div
      ref={containerRef}
      className="rounded-xl border border-primary/10 bg-card p-5"
    >
      <h3 className="font-display text-lg font-medium text-primary">{title}</h3>
      <p className="mt-1 text-sm text-foreground/70">{description}</p>
      {current ? (
        <div className="mt-4 rounded-lg border border-primary/10 bg-secondary/40 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-medium text-primary">
                {current.originalFilename}
              </div>
              <div className="mt-0.5 font-mono text-xs text-foreground/60">
                {formatBytes(current.sizeBytes)} · uploaded{" "}
                {new Date(current.uploadedAt).toLocaleString()}
              </div>
            </div>
            {isParseable ? (
              <div className="flex items-center gap-2">
                <VerificationBadge verification={verification} />
                <Link
                  href={`/app/engagements/${engagementId}/verify/${kind}`}
                  className="text-xs text-accent hover:underline"
                >
                  Verify →
                </Link>
              </div>
            ) : null}
          </div>
        </div>
      ) : (
        <p className="mt-4 text-sm text-foreground/55">No file uploaded yet.</p>
      )}
      <form onSubmit={handleSubmit} className="mt-4 flex flex-wrap gap-2">
        <FilePicker
          key={pickerKey}
          forceReset={pickerKey}
          ref={inputRef}
          accept={accept}
          className="max-w-md"
        />
        <Button type="submit" disabled={isPending} variant="gold">
          {isPending
            ? isParseable
              ? "Parsing…"
              : "Uploading…"
            : current
              ? "Upload & Replace"
              : "Upload"}
        </Button>
      </form>
      {error ? (
        <p className="mt-2 text-xs text-destructive">{error}</p>
      ) : null}
    </div>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function VerificationBadge({
  verification,
}: {
  verification: FileUploadProps["verification"];
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
