import Link from "next/link";
import { formatFormat, formatPence, formatSignedPct } from "@/lib/format";
import { wineHref } from "@/lib/nav/origin";
import { Pagination } from "@/components/nav/Pagination";
import type { ScenarioResultRow } from "@/lib/scenarios/evaluate";

// The bounded results table for a scenario, shared by the saved-scenario detail
// page and the "Run" preview on both the detail and new-scenario pages.
export function ScenarioMatches({
  rows,
  page,
  hasNext,
  basePath,
  query,
  from,
  heading = "Matches",
}: {
  rows: ScenarioResultRow[];
  page: number;
  hasNext: boolean;
  basePath: string;
  query?: Record<string, string>;
  from: string;
  heading?: string;
}) {
  return (
    <section className="rounded-lg border border-border bg-background">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-5 py-3">
        <h2 className="font-semibold">{heading}</h2>
      </div>
      <div className="overflow-auto">
        <table className="w-full min-w-max text-left text-sm">
          <thead className="text-xs uppercase tracking-wide text-ink-muted">
            <tr>
              <th className="px-5 py-2">Wine</th><th className="px-3 py-2">Format</th>
              <th className="px-3 py-2 text-right">Ask / 75cl</th><th className="px-3 py-2 text-right">Release / 75cl</th>
              <th className="px-3 py-2 text-right">Ask vs release</th><th className="px-3 py-2">Anchor</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? <tr><td colSpan={6} className="px-5 py-10 text-center text-ink-muted">No format matches this scenario.</td></tr>
              : rows.map((row) => <tr key={`${row.parent_sku}-${row.format_code}`} className="border-t border-border">
                <td className="px-5 py-2">
                  {row.parent_sku
                    ? <Link href={wineHref(row.parent_sku, from)} className="font-medium text-accent underline-offset-2 hover:underline">{row.name ?? row.parent_sku}</Link>
                    : <span className="font-medium">{row.name ?? "–"}</span>}
                  <span className="block text-xs text-ink-muted">{row.vintage ?? "Vintage unavailable"}</span>
                </td>
                <td className="px-3 py-2">{formatFormat(row.case_size, row.bottle_volume_ml)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPence(row.lowest_ask_per_75cl_p)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatPence(row.release_price_per_75cl_p)}</td>
                <td className="px-3 py-2 text-right tabular-nums">{formatSignedPct(row.ask_vs_release_pct)}</td>
                <td className="px-3 py-2 text-xs text-ink-muted">{row.anchor_status ?? "–"}</td>
              </tr>)}
          </tbody>
        </table>
      </div>
      <Pagination page={page} hasNext={hasNext} basePath={basePath} query={query} />
    </section>
  );
}
