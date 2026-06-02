// Real product visual — a CSS-rendered facsimile of a Fieldwork-generated
// workpaper (DSO + Aging Analytics for an AR engagement). Uses the brand
// palette (navy primary, gold accent) and the actual content patterns the
// generator produces. SVG/CSS rather than a screenshot so it stays sharp
// at any resolution and survives design-token edits without re-shooting.

export function ProductVisual() {
  return (
    <section className="mx-auto w-full max-w-6xl px-6 py-20">
      <div className="rounded-2xl border border-primary/10 bg-primary p-3 shadow-2xl">
        {/* Browser/window chrome */}
        <div className="flex items-center gap-2 px-2 py-1">
          <span className="size-2.5 rounded-full bg-[#ff5f57]" />
          <span className="size-2.5 rounded-full bg-[#febc2e]" />
          <span className="size-2.5 rounded-full bg-[#28c840]" />
          <div className="ml-3 hidden flex-1 rounded-md bg-primary-foreground/10 px-3 py-1 text-[10px] uppercase tracking-[0.18em] text-primary-foreground/55 sm:block">
            Fieldwork — WP-AR-03 · DSO & Aging Analytics
          </div>
        </div>

        {/* Workpaper canvas */}
        <div className="rounded-xl bg-[#fffdf9] p-5 text-[11px] leading-snug text-[#1d3a52] sm:p-7 sm:text-[13px]">
          {/* Title block */}
          <div className="rounded-md bg-[#1d3a52] px-4 py-2 text-center font-display text-base font-semibold tracking-wide text-[#ede5d3] sm:text-lg">
            HARTWELL MANUFACTURING CO. — DSO &amp; AGING ANALYTICS
          </div>
          <div className="mt-1 rounded-md bg-[#2c4d68] px-4 py-1.5 text-center text-[10px] tracking-wide text-[#ede5d3]/85 sm:text-xs">
            FY 2024 Audit &nbsp;|&nbsp; AR Analytical Procedures &nbsp;|&nbsp; Completeness &amp; Valuation &nbsp;|&nbsp; WP Reference: AR-03
          </div>

          {/* Procedure box */}
          <div className="mt-4 rounded-md border border-[#c8a04a]/35 bg-[#fdf6e3] p-3 text-[10px] leading-relaxed sm:text-[12px]">
            <p>
              <span className="font-semibold">SCOPING RATIONALE (AR):</span>{" "}
              Positive confirmations on concentrated customers, subsequent-cash testing, aged-AR analytics, and cut-off testing around year-end. Concentration + fraud risk elevates this to High.
            </p>
            <p className="mt-2">
              <span className="font-semibold">TESTING PROCEDURE:</span>{" "}
              Performed substantive analytical procedures over AR in two parts. (1) DSO trend — computed Days Sales Outstanding (AR ÷ Revenue × 365) for the prior and current fiscal year and compared the YoY change to the industry benchmark (~72 days). (2) Aging mix — compared CY vs. PY aging distribution by bucket. Tied opening figures to PY audited balances and CY to the CY TB.
            </p>
          </div>

          {/* Trend table */}
          <div className="mt-4">
            <div className="rounded-t-md bg-[#1d3a52] px-3 py-1.5 text-[10px] font-semibold tracking-wide text-[#ede5d3] sm:text-xs">
              DAYS SALES OUTSTANDING (DSO) — TREND ANALYSIS
            </div>
            <div className="overflow-hidden rounded-b-md border border-[#1d3a52]/20">
              <table className="w-full border-collapse text-[10px] sm:text-[12px]">
                <thead>
                  <tr className="bg-[#2c4d68] text-[#ede5d3]">
                    <th className="px-2 py-1.5 text-left font-medium">Metric</th>
                    <th className="px-2 py-1.5 text-right font-medium">FY 2022</th>
                    <th className="px-2 py-1.5 text-right font-medium">FY 2023</th>
                    <th className="px-2 py-1.5 text-right font-medium">FY 2024</th>
                    <th className="px-2 py-1.5 text-right font-medium">YoY Change</th>
                    <th className="px-2 py-1.5 text-right font-medium">YoY %</th>
                  </tr>
                </thead>
                <tbody className="text-[#1d3a52]">
                  <tr className="border-t border-[#1d3a52]/10">
                    <td className="px-2 py-1.5">Revenue</td>
                    <td className="px-2 py-1.5 text-right">6,820,000</td>
                    <td className="px-2 py-1.5 text-right">7,610,000</td>
                    <td className="px-2 py-1.5 text-right text-[#1d3a52] font-medium">8,240,000</td>
                    <td className="px-2 py-1.5 text-right">630,000</td>
                    <td className="px-2 py-1.5 text-right">8.3%</td>
                  </tr>
                  <tr className="border-t border-[#1d3a52]/10 bg-[#1d3a52]/[0.03]">
                    <td className="px-2 py-1.5">AR, net</td>
                    <td className="px-2 py-1.5 text-right">1,390,000</td>
                    <td className="px-2 py-1.5 text-right">1,620,000</td>
                    <td className="px-2 py-1.5 text-right font-medium">1,840,000</td>
                    <td className="px-2 py-1.5 text-right">220,000</td>
                    <td className="px-2 py-1.5 text-right">13.6%</td>
                  </tr>
                  <tr className="border-t border-[#1d3a52]/10 bg-[#fdf6e3]">
                    <td className="px-2 py-1.5 font-medium">DSO (days) = AR / Revenue × 365</td>
                    <td className="px-2 py-1.5 text-right">74.4</td>
                    <td className="px-2 py-1.5 text-right">77.7</td>
                    <td className="px-2 py-1.5 text-right font-semibold text-[#1d3a52]">81.5</td>
                    <td className="px-2 py-1.5 text-right">3.8</td>
                    <td className="px-2 py-1.5 text-right">4.9%</td>
                  </tr>
                  <tr className="border-t border-[#1d3a52]/10">
                    <td className="px-2 py-1.5">Industry benchmark</td>
                    <td className="px-2 py-1.5 text-right">72</td>
                    <td className="px-2 py-1.5 text-right">72</td>
                    <td className="px-2 py-1.5 text-right">72</td>
                    <td className="px-2 py-1.5 text-right">—</td>
                    <td className="px-2 py-1.5 text-right">0.0%</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>

          {/* Conclusion box */}
          <div className="mt-4 rounded-md border-l-4 border-[#c8a04a] bg-[#fdf6e3] p-3 text-[10px] leading-relaxed sm:text-[12px]">
            <span className="font-semibold">DSO CONCLUSION:</span> DSO increased from{" "}
            <span className="font-mono font-semibold">77.7</span> days (FY23) to{" "}
            <span className="font-mono font-semibold">81.5</span> days (FY24), a{" "}
            <span className="font-mono font-semibold">3.8</span>-day increase (4.9%). This exceeds the industry average of ~72 days. The increase is primarily attributable to C004 Pinnacle Precision Parts (slow payer) and C009 Keystone (large balance, longer collection cycle). DSO trend is a mild risk indicator — corroborates the elevated risk rating on this account but does not indicate material misstatement.
          </div>
        </div>
      </div>

      <p className="mt-4 text-center text-xs uppercase tracking-[0.18em] text-primary/55">
        A generated workpaper — built from your trial balance, AR aging, and prior-year audit
      </p>
    </section>
  );
}
