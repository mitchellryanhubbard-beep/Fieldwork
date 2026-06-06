// Display-name shim for trial-balance accounts. Some clients' charts of
// accounts append GL bookkeeping suffixes like "(control)",
// "(sub-ledger)", or "(GL)" to the raw account name. Auditors care
// about the FSLI line item ("Trade"), not the chart-of-accounts
// mechanic — so we strip those suffixes for every display surface
// (UI labels, generated workpaper titles, filenames, etc.).
//
// The underlying TB account name is NEVER mutated — only the display
// path goes through here. Tie-outs that need the raw "as it appears
// in the GL" string still read `account.name` directly.
export function displayAccountName(name: string): string {
  return name
    .replace(
      /\s*\((control|sub[-\s]?ledger|subledger|gl|general\s+ledger)\)\s*$/i,
      "",
    )
    .trim();
}
