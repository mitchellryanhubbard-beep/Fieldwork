import type { ReactNode } from "react";

export type NumberedSectionProps = {
  n: number;
  title: string;
  description?: string;
  children: ReactNode;
};

export function NumberedSection({
  n,
  title,
  description,
  children,
}: NumberedSectionProps) {
  return (
    <section id={`section-${n}`} className="scroll-mt-20 space-y-3">
      <header className="flex items-center gap-3">
        <span className="grid size-7 place-items-center rounded-full bg-accent font-mono text-xs font-semibold text-primary">
          {String(n).padStart(2, "0")}
        </span>
        <h2 className="text-xs font-semibold uppercase tracking-[0.2em] text-primary">
          {title}
        </h2>
      </header>
      {description ? (
        <p className="ml-10 max-w-2xl text-sm text-foreground/70">
          {description}
        </p>
      ) : null}
      <div className="ml-0 sm:ml-10">{children}</div>
    </section>
  );
}
