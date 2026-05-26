import type { ReactNode } from "react";

export type ChipProps = {
  children: ReactNode;
};

export function Chip({ children }: ChipProps) {
  return (
    <span className="rounded-full border border-primary/30 px-2.5 py-0.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-primary">
      {children}
    </span>
  );
}
