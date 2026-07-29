import Link from "next/link";
import { requireOwner } from "@/lib/auth/owner";

export const dynamic = "force-dynamic";

const money = (p: number | null) => p === null
  ? "-"
  : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(p / 100);

type CellarTrackerMarketRow = {
  source_row_number: number;
  source_wine: string;
  vintage: number | null;
  fully_consumed: boolean;
  quantity_home: number;
  quantity_bbr: number;
  purchase_price_per_bottle_p: number | null;
  lowest_ask_per_bottle_p: number | null;
  highest_bid_per_bottle_p: number | null;
  parent_sku: string | null;
};

export default async function CellarTrackerPage() {
  const { supabase } = await requireOwner();
  const { data, error } = await supabase.from("current_cellartracker_records")
    .select("*").order("source_wine");
  if (error) throw new Error("CellarTracker records could not be loaded.");
  const rows = (data ?? []) as CellarTrackerMarketRow[];

  return <main className="min-h-0 flex-1 overflow-auto bg-accent-soft">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">My CellarTracker</p>
          <h1 className="mt-1 text-2xl font-semibold">Current and consumed wines</h1>
        </div>
        <div className="flex gap-2">
          <Link href="/cellartracker/matches" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Match records</Link>
          <Link href="/cellar/imports" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background">Import data</Link>
        </div>
      </div>
      <p className="mt-4 text-sm text-ink-muted">BBX figures use the smallest available case size, divided per bottle. They are approximate.</p>
    </header>
    <div className="mx-auto max-w-7xl p-5">
      <section className="overflow-auto rounded-lg border border-border bg-background">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-ink-muted"><tr><th className="p-3">Wine</th><th className="p-3">Home</th><th className="p-3">BBR</th><th className="p-3">Paid</th><th className="p-3">Lowest ask</th><th className="p-3">Highest bid</th><th className="p-3">Link</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={row.source_row_number} className="border-t">
              <td className="p-3">{row.source_wine} {row.vintage ?? ""}{row.fully_consumed && <span className="ml-2 text-xs text-ink-muted">Consumed</span>}</td>
              <td className="p-3">{row.quantity_home}</td>
              <td className="p-3">{row.quantity_bbr}</td>
              <td className="p-3">{money(row.purchase_price_per_bottle_p)}</td>
              <td className="p-3">{money(row.lowest_ask_per_bottle_p)}</td>
              <td className="p-3">{money(row.highest_bid_per_bottle_p)}</td>
              <td className="p-3">{row.parent_sku ?? "Unlinked"}</td>
            </tr>)}
            {!rows.length && <tr><td className="p-5 text-ink-muted" colSpan={7}>No accepted CellarTracker snapshot.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  </main>;
}
