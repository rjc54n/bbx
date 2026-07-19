import { formatSignedPct, signedPctDirection } from "@/lib/format";

interface SignedPctProps {
  value: number | null;
  /** True for price_vs_next_pct -- flags it as a stored estimate, not a live check. */
  estimate?: boolean;
}

// Signed metrics must never rely on colour alone to convey direction
// (docs/PHASE2-catalogue-browser.md Phase D) -- the +/- sign and ▲▼ glyph
// carry the meaning; the restrained burgundy accent on "cheaper than
// reference" is reinforcement, not the only signal.
export function SignedPct({ value, estimate }: SignedPctProps) {
  const direction = signedPctDirection(value);
  const arrow = direction === "down" ? "▼" : direction === "up" ? "▲" : null;

  return (
    <span className={`tabular-nums ${direction === "down" ? "font-semibold text-accent" : "text-ink"}`}>
      {arrow && <span aria-hidden="true">{arrow} </span>}
      {formatSignedPct(value)}
      {estimate && value !== null && (
        <sup className="ml-0.5 text-[0.65em] font-normal text-ink-muted" title="Stored estimate, not a live order-book check">
          est.
        </sup>
      )}
    </span>
  );
}
