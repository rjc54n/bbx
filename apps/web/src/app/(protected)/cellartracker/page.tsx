import Link from "next/link";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { requireOwner } from "@/lib/auth/owner";
import { buildFavouriteState, isFavourited, targetForRecord } from "@/lib/favourites/target";

export const dynamic = "force-dynamic";

const money = (p: number | null) => p === null
  ? "-"
  : new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(p / 100);

type CellarTrackerMarketRow = {
  import_id: string;
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
  link_status: string | null;
  match_method: string | null;
  match_group_key: string | null;
};

export default async function CellarTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const { supabase, userId } = await requireOwner();
  const [{ data, error }, { data: favouriteRows, error: favouriteError }, { data: pendingRows, error: pendingError }] =
    await Promise.all([
      supabase.from("current_cellartracker_records").select("*").order("source_wine"),
      supabase.from("wine_favourites").select("parent_sku").eq("user_id", userId),
      supabase.from("pending_favourites").select("source, match_group_key")
        .eq("user_id", userId).eq("source", "cellartracker"),
    ]);
  if (error) throw new Error("CellarTracker records could not be loaded.");
  if (favouriteError) throw new Error("Wine favourites could not be loaded.");
  if (pendingError) throw new Error("Pending favourites could not be loaded.");
  const rows = (data ?? []) as CellarTrackerMarketRow[];
  const favourites = buildFavouriteState(
    (favouriteRows ?? []).map((row) => row.parent_sku),
    pendingRows ?? [],
  );

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
      <p className="mt-4 text-sm text-ink-muted">BBX figures are 75cl bottle equivalents across all available formats. Lowest ask and highest bid are compared after normalisation.</p>
    </header>
    <div className="mx-auto max-w-7xl p-5">
      {query.deleted && <p role="status" className="mb-4 rounded border border-green-700/30 bg-green-50 p-3 text-sm text-green-900">The CellarTracker record was deleted.</p>}
      <section className="overflow-auto rounded-lg border border-border bg-background">
        <table className="w-full min-w-[900px] text-sm">
          <thead className="text-left text-ink-muted"><tr><th className="p-3">Wine</th><th className="p-3">Home</th><th className="p-3">BBR</th><th className="p-3">Paid / 75cl</th><th className="p-3">Lowest ask / 75cl</th><th className="p-3">Highest bid / 75cl</th><th className="p-3">Link</th><th className="p-3 text-center">Favourite</th></tr></thead>
          <tbody>
            {rows.map((row) => <tr key={`${row.import_id}-${row.source_row_number}`} className="border-t">
              <td className="p-3"><Link href={`/cellartracker/${row.import_id}/${row.source_row_number}`} className="font-medium text-accent underline-offset-2 hover:underline">{row.source_wine}</Link> {row.vintage ?? ""}{row.fully_consumed && <span className="ml-2 text-xs text-ink-muted">Consumed</span>}</td>
              <td className="p-3">{row.quantity_home}</td>
              <td className="p-3">{row.quantity_bbr}</td>
              <td className="p-3">{money(row.purchase_price_per_bottle_p)}</td>
              <td className="p-3">{money(row.lowest_ask_per_bottle_p)}</td>
              <td className="p-3">{money(row.highest_bid_per_bottle_p)}</td>
              <td className="p-3">{row.link_status === "linked" ? `${row.parent_sku} (${row.match_method})` : row.link_status === "suppressed" ? "Suppressed" : "Unlinked"}</td>
              <td className="p-3 text-center">{(() => {
                const target = targetForRecord("cellartracker", row.link_status, row.parent_sku, row.match_group_key);
                if (!target) return <span className="text-xs text-ink-muted">Unavailable</span>;
                return <FavouriteStar target={target} favourite={isFavourited(favourites, target)} label={row.source_wine} />;
              })()}</td>
            </tr>)}
            {!rows.length && <tr><td className="p-5 text-ink-muted" colSpan={8}>No accepted CellarTracker snapshot.</td></tr>}
          </tbody>
        </table>
      </section>
    </div>
  </main>;
}
