export function ProductVisual() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="rounded-2xl border border-primary/10 bg-primary p-2 shadow-lg">
        <div
          aria-label="Excel + Fieldwork task pane (placeholder)"
          className="grid h-72 place-items-center rounded-xl bg-[repeating-linear-gradient(135deg,theme(colors.primary/0.05)_0,theme(colors.primary/0.05)_8px,transparent_8px,transparent_16px)] text-sm font-medium text-primary-foreground/70 sm:h-96"
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
