import Link from "next/link";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { requireOwner } from "@/lib/auth/owner";
import { formatPence } from "@/lib/format";
import { loadFavourites } from "@/lib/favourites/server";
import { buildFavouriteState, isFavourited, targetForRecord } from "@/lib/favourites/target";

export const dynamic = "force-dynamic";

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

const columns = [
  { label: "Wine" },
  { label: "Home", align: "right" as const },
  { label: "BBR", align: "right" as const },
  { label: "Paid / 75cl", align: "right" as const },
  { label: "Lowest ask / 75cl", align: "right" as const },
  { label: "Highest bid / 75cl", align: "right" as const },
  { label: "Link" },
];

export default async function CellarTrackerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const query = await searchParams;
  const owner = await requireOwner();
  const [{ data, error }, { parentSkus, pending }, { count: excludedCount }] = await Promise.all([
    owner.supabase.from("current_cellartracker_records").select("*").order("source_wine"),
    loadFavourites(owner, "cellartracker"),
    owner.supabase.from("cellartracker_excluded_record_view").select("*", { count: "exact", head: true }),
  ]);
  if (error) throw new Error("CellarTracker records could not be loaded.");
  const rows = (data ?? []) as CellarTrackerMarketRow[];
  const favourites = buildFavouriteState(parentSkus, pending);
  const bottles = rows.reduce((total, row) => total + row.quantity_home + row.quantity_bbr, 0);

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">My CellarTracker</p>
          <h1 className="mt-1 text-2xl font-semibold">Current and consumed wines</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            BBX figures are 75cl bottle equivalents across all available formats. Lowest
            ask and highest bid are compared after normalisation.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/cellartracker/matches" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Match records</Link>
          <Link href="/cellar/imports" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background">Import data</Link>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded border border-border bg-background px-3 py-2 tabular-nums">
          <strong>{rows.length.toLocaleString()}</strong> records
        </span>
        <span className="rounded border border-border bg-background px-3 py-2 tabular-nums">
          <strong>{bottles.toLocaleString()}</strong> bottles
        </span>
        {(excludedCount ?? 0) > 0 && <Link href="/cellartracker/excluded" className="rounded border border-border bg-background px-3 py-2 text-accent underline-offset-2 tabular-nums hover:underline">
          <strong>{(excludedCount ?? 0).toLocaleString()}</strong> excluded
        </Link>}
      </div>
    </header>

    {query.excluded && <p role="status" className="border-b border-green-700/30 bg-green-50 px-5 py-3 text-sm text-green-900">
      The CellarTracker record was excluded. It stays out of future snapshots until you{" "}
      <Link href="/cellartracker/excluded" className="font-medium underline">restore it</Link>.
    </p>}

    <div className="border-b border-border px-4 py-2 text-sm text-ink-muted">
      {rows.length.toLocaleString()} record{rows.length === 1 ? "" : "s"} in the current snapshot
    </div>

    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
          <tr>
            {columns.map((column) => (
              <th key={column.label} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium text-ink-muted ${column.align === "right" ? "text-right" : "text-left"}`}>
                {column.label}
              </th>
            ))}
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-center font-medium text-ink-muted">Favourite</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr>
            <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-ink-muted">
              No accepted CellarTracker snapshot.
            </td>
          </tr> : rows.map((row) => (
            <tr key={`${row.import_id}-${row.source_row_number}`} className="border-t border-border hover:bg-accent-soft/50">
              <td className="max-w-sm px-3 py-2 align-top">
                <Link href={`/cellartracker/${row.import_id}/${row.source_row_number}`} className="font-medium text-accent underline-offset-2 hover:underline">
                  {row.source_wine}
                </Link>
                <p className="text-xs text-ink-muted">
                  {row.vintage ?? "Vintage unavailable"}
                  {row.fully_consumed && " · Consumed"}
                </p>
              </td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{row.quantity_home || "–"}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{row.quantity_bbr || "–"}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatPence(row.purchase_price_per_bottle_p)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatPence(row.lowest_ask_per_bottle_p)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatPence(row.highest_bid_per_bottle_p)}</td>
              <td className="px-3 py-2 align-top">
                {row.link_status === "linked" && row.parent_sku
                  ? <><Link href={`/wine/parent/${row.parent_sku}`} className="text-accent underline-offset-2 hover:underline">{row.parent_sku}</Link><span className="block text-xs text-ink-muted">{row.match_method?.replaceAll("_", " ")}</span></>
                  : <span className="text-ink-muted">{row.link_status === "suppressed" ? "Suppressed" : "Unlinked"}</span>}
              </td>
              <td className="px-3 py-2 text-center align-top">{(() => {
                const target = targetForRecord("cellartracker", row.link_status, row.parent_sku, row.match_group_key);
                if (!target) return <span className="text-xs text-ink-muted">Unavailable</span>;
                return <FavouriteStar target={target} favourite={isFavourited(favourites, target)} label={row.source_wine} />;
              })()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  </div>;
}
