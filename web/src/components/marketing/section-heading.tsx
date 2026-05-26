import type { ReactNode } from "react";

export type SectionHeadingProps = {
  children: ReactNode;
  tone?: "ink" | "invert";
};

export function SectionHeading({
  children,
  tone = "ink",
}: SectionHeadingProps) {
  return (
    <h2
      className={`max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight sm:text-4xl ${
        tone === "invert" ? "text-primary-foreground" : "text-primary"
      }`}
    >
      {children}
    </h2>
  );
}
