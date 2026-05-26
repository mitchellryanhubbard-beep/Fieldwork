const STATS = [
  { value: "~40%", label: "Hours on sample selection + tickmarks" },
  { value: "~25%", label: "Hours on analytical procedures" },
  { value: "~15%", label: "Hours on exception consolidation" },
  { value: "~20%", label: "Hours on workpaper formatting" },
];

export function ProblemBlock() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <h2 className="max-w-2xl font-display text-3xl font-medium leading-tight tracking-tight text-primary sm:text-4xl">
        What first-year staff actually spend time on.
      </h2>
      <p className="mt-3 max-w-xl text-foreground/70">
        Most of fieldwork is rote work that doesn&apos;t need judgment. Illustrative breakdown of a typical mid-market private audit.
      </p>
      <ul className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {STATS.map((s) => (
          <li
            key={s.label}
            className="rounded-xl border border-primary/10 bg-card p-5"
          >
            <p className="font-mono text-3xl font-medium text-primary">
              {s.value}
            </p>
            <p className="mt-2 text-sm text-foreground/70">{s.label}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
