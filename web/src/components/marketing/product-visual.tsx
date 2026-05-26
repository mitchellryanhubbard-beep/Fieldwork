// Inline style is used here because Tailwind v4 dropped the `theme()` arbitrary
// value form and a literal `var(--color-fw-...)` reference inside an arbitrary
// utility doesn't survive class extraction in production builds. An inline
// CSS string is the most reliable v4 path for a one-off repeating gradient.
const STRIPES_STYLE = {
  backgroundImage:
    "repeating-linear-gradient(135deg, color-mix(in oklab, var(--color-fw-snow) 12%, transparent) 0, color-mix(in oklab, var(--color-fw-snow) 12%, transparent) 8px, transparent 8px, transparent 16px)",
};

export function ProductVisual() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="rounded-2xl border border-primary/10 bg-primary p-2 shadow-lg">
        <div
          style={STRIPES_STYLE}
          className="grid h-72 place-items-center rounded-xl text-sm font-medium text-primary-foreground/70 sm:h-96"
        >
          Product screenshot — Excel with the Fieldwork task pane
        </div>
      </div>
      <p className="mt-3 text-center text-xs uppercase tracking-[0.18em] text-primary/50">
        Real screenshot lands with the Office.js add-in (Milestone 2)
      </p>
    </section>
  );
}
