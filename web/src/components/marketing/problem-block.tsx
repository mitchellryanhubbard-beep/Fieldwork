"use client";

import { useState } from "react";
import { SectionHeading } from "./section-heading";

type Slice = {
  label: string;
  value: number;
  color: string;
};

// Order = clockwise from 12 o'clock. Sized largest → smallest for a balanced
// reading flow. Colors stay inside the navy/gold brand palette: two cool
// (navy + slate) and two warm (gold + tan) so adjacent slices contrast.
const SLICES: Slice[] = [
  { label: "Sample selection + tickmarks", value: 40, color: "#1d3a52" },
  { label: "Analytical procedures", value: 25, color: "#3d5e7c" },
  { label: "Workpaper formatting", value: 20, color: "#c8a04a" },
  { label: "Exception consolidation", value: 15, color: "#d4b176" },
];

const SIZE = 240;
const CX = SIZE / 2;
const CY = SIZE / 2;
const R = 100;
const RI = 60;

type Arc = {
  path: string;
  midAngle: number;
  slice: Slice;
};

function buildArcs(slices: Slice[]): Arc[] {
  let angle = -Math.PI / 2;
  return slices.map((s) => {
    const span = (s.value / 100) * Math.PI * 2;
    const a0 = angle;
    const a1 = angle + span;
    const x0 = CX + R * Math.cos(a0);
    const y0 = CY + R * Math.sin(a0);
    const x1 = CX + R * Math.cos(a1);
    const y1 = CY + R * Math.sin(a1);
    const ix0 = CX + RI * Math.cos(a0);
    const iy0 = CY + RI * Math.sin(a0);
    const ix1 = CX + RI * Math.cos(a1);
    const iy1 = CY + RI * Math.sin(a1);
    const largeArc = span > Math.PI ? 1 : 0;
    const path = [
      `M ${x0} ${y0}`,
      `A ${R} ${R} 0 ${largeArc} 1 ${x1} ${y1}`,
      `L ${ix1} ${iy1}`,
      `A ${RI} ${RI} 0 ${largeArc} 0 ${ix0} ${iy0}`,
      "Z",
    ].join(" ");
    angle = a1;
    return { path, midAngle: (a0 + a1) / 2, slice: s };
  });
}

export function ProblemBlock() {
  const [hovered, setHovered] = useState<number | null>(null);
  const arcs = buildArcs(SLICES);
  const active = hovered !== null ? SLICES[hovered] : null;

  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <SectionHeading>
        What first-year staff actually spend time on.
      </SectionHeading>
      <p className="mt-3 max-w-xl text-foreground/70">
        Most fieldwork is rote work that doesn&apos;t need judgment.
        Illustrative breakdown of a typical mid-market private audit.
      </p>

      <div className="mt-12 grid items-center gap-10 lg:grid-cols-[auto_1fr] lg:gap-16">
        <div
          className="relative mx-auto"
          style={{ width: SIZE, height: SIZE }}
        >
          <svg
            viewBox={`0 0 ${SIZE} ${SIZE}`}
            className="size-full overflow-visible"
            role="img"
            aria-label="Donut chart of how first-year audit staff allocate their hours"
          >
            {arcs.map((a, i) => {
              const isActive = hovered === i;
              const isOther = hovered !== null && !isActive;
              const tx = isActive ? Math.cos(a.midAngle) * 8 : 0;
              const ty = isActive ? Math.sin(a.midAngle) * 8 : 0;
              return (
                <path
                  key={a.slice.label}
                  d={a.path}
                  fill={a.slice.color}
                  className="cursor-pointer transition-[transform,opacity,filter] duration-200 ease-out"
                  style={{
                    transform: `translate(${tx}px, ${ty}px)`,
                    opacity: isOther ? 0.4 : 1,
                    filter: isActive
                      ? "drop-shadow(0 4px 10px rgba(29, 58, 82, 0.25))"
                      : undefined,
                  }}
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                />
              );
            })}
            {/* Center hole — gradient ring stroke for depth */}
            <circle
              cx={CX}
              cy={CY}
              r={RI - 0.5}
              fill="var(--color-background)"
              className="pointer-events-none"
            />
            {/* Center label — switches between summary and hovered slice */}
            <g pointerEvents="none">
              <text
                x={CX}
                y={CY - 4}
                textAnchor="middle"
                className="fill-primary font-mono text-3xl font-semibold"
              >
                {active ? `${active.value}%` : "100%"}
              </text>
              <text
                x={CX}
                y={CY + 18}
                textAnchor="middle"
                className="fill-foreground/55 text-[9px] uppercase tracking-[0.22em]"
              >
                {active ? "of staff time" : "Staff time"}
              </text>
            </g>
          </svg>
        </div>

        <ul className="grid gap-3 sm:grid-cols-2">
          {SLICES.map((s, i) => {
            const isActive = hovered === i;
            const isOther = hovered !== null && !isActive;
            return (
              <li key={s.label}>
                <button
                  type="button"
                  onMouseEnter={() => setHovered(i)}
                  onMouseLeave={() => setHovered(null)}
                  onFocus={() => setHovered(i)}
                  onBlur={() => setHovered(null)}
                  className={`flex w-full items-start gap-3 rounded-xl border bg-card p-4 text-left transition-all duration-200 ${
                    isActive
                      ? "border-accent shadow-md"
                      : "border-primary/10 hover:border-primary/25"
                  } ${isOther ? "opacity-55" : ""}`}
                >
                  <span
                    aria-hidden="true"
                    className="mt-1 size-3.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: s.color }}
                  />
                  <div>
                    <p className="font-mono text-2xl font-medium text-primary">
                      {s.value}%
                    </p>
                    <p className="mt-1 text-sm text-foreground/70">
                      {s.label}
                    </p>
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
