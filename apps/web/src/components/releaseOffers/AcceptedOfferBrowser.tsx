import Link from "next/link";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { formatDate } from "@/lib/format";
import { acceptedOfferPageCount } from "@/lib/releaseOffers/reviewBrowser";
import { Pagination } from "@/components/nav/Pagination";
import {
  buildFavouriteState,
  isFavourited,
  targetForRecord,
} from "@/lib/favourites/target";

export type AcceptedOfferRow = {
  import_id: string;
  source_row_number: number;
  offer_date: string;
  source_wine: string;
  source_vintage: number | null;
  source_price_text: string;
  source_product_id: string | null;
  link_status: string | null;
  parent_sku: string | null;
  match_method: string | null;
  match_group_key: string | null;
  valid_in_bond_fragment_count: number;
  price_fragment_count: number;
};

const columns = ["Offer date", "Wine", "Original price text", "Fragments", "Link"];

export function AcceptedOfferBrowser({
  rows,
  page,
  search,
  totalRows,
  favouriteParentSkus,
  pendingFavourites,
  excludedCount,
  justExcluded,
}: {
  rows: AcceptedOfferRow[];
  page: number;
  search: string;
  totalRows: number;
  favouriteParentSkus: string[];
  pendingFavourites: { source: string; match_group_key: string }[];
  excludedCount: number;
  justExcluded: boolean;
}) {
  const favourites = buildFavouriteState(favouriteParentSkus, pendingFavourites);
  const pageCount = acceptedOfferPageCount(totalRows);
  const resultLabel = search ? "matching offer records" : "offer records";

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Release offers</p>
          <h1 className="mt-1 text-2xl font-semibold">Accepted offer records</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            Each record proves a wine was offered at the stated price. Linking one to a
            Parent ID is what lets it anchor a release-price comparison.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/matches?source=release_offer" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Match offers</Link>
          <Link href="/cellar/imports" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background">Import data</Link>
        </div>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded border border-border bg-background px-3 py-2 tabular-nums">
          <strong>{totalRows.toLocaleString()}</strong> accepted offer records
        </span>
        {excludedCount > 0 && <Link href="/release-prices/excluded" className="rounded border border-border bg-background px-3 py-2 text-accent underline-offset-2 tabular-nums hover:underline">
          <strong>{excludedCount.toLocaleString()}</strong> excluded
        </Link>}
      </div>
    </header>

    {justExcluded && <p role="status" className="border-b border-green-700/30 bg-green-50 px-5 py-3 text-sm text-green-900">
      The offer record was excluded. A later file repeating it will be filtered out until you{" "}
      <Link href="/release-prices/excluded" className="font-medium underline">restore it</Link>.
    </p>}

    <div className="border-b border-border bg-background px-4 py-3">
      <form action="/release-prices" className="flex max-w-xl items-end gap-2">
        <label className="grid min-w-0 flex-1 gap-1 text-xs text-ink-muted">
          Search accepted offers
          <input
            name="q"
            type="search"
            defaultValue={search}
            placeholder="Wine, Parent ID or original price text"
            className="rounded border border-border px-3 py-1.5 text-sm text-ink"
          />
        </label>
        <button type="submit" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Search</button>
      </form>
    </div>

    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
          <tr>
            {columns.map((column) => (
              <th key={column} scope="col" className="whitespace-nowrap px-3 py-2 text-left font-medium text-ink-muted">
                {column}
              </th>
            ))}
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-center font-medium text-ink-muted">Favourite</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr>
            <td colSpan={columns.length + 1} className="px-3 py-10 text-center text-ink-muted">
              {search ? "No offer records match this search." : "No accepted offer records."}
            </td>
          </tr> : rows.map((row) => (
            <tr key={`${row.import_id}-${row.source_row_number}`} className="border-t border-border hover:bg-accent-soft/50">
              <td className="whitespace-nowrap px-3 py-2 align-top tabular-nums">{formatDate(row.offer_date)}</td>
              <td className="max-w-sm px-3 py-2 align-top">
                <Link href={`/release-prices/offers/${row.import_id}/${row.source_row_number}`} className="font-medium text-accent underline-offset-2 hover:underline">
                  {row.source_wine}
                </Link>
                <p className="text-xs text-ink-muted">
                  {row.source_vintage ?? "Vintage unavailable"}
                  {row.source_product_id ? ` · supplied ${row.source_product_id}` : ""}
                </p>
              </td>
              <td className="max-w-xl px-3 py-2 align-top">{row.source_price_text}</td>
              <td className="px-3 py-2 align-top">
                {row.price_fragment_count} parsed
                <span className="block text-xs text-ink-muted">{row.valid_in_bond_fragment_count} valid in bond</span>
              </td>
              <td className="px-3 py-2 align-top">
                {row.link_status === "linked"
                  ? <>{row.parent_sku}<span className="block text-xs text-ink-muted">{row.match_method?.replaceAll("_", " ")}</span></>
                  : <span className="text-ink-muted">{row.link_status === "ignored" ? "Ignored" : "Unlinked"}</span>}
              </td>
              <td className="px-3 py-2 text-center align-top">{(() => {
                const target = targetForRecord("release_offer", row.link_status, row.parent_sku, row.match_group_key);
                if (!target) return <span className="text-xs text-ink-muted">Unavailable</span>;
                return <FavouriteStar target={target} favourite={isFavourited(favourites, target)} label={row.source_wine} />;
              })()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    <Pagination
      page={page}
      totalPages={pageCount}
      totalCount={totalRows}
      label={resultLabel}
      basePath="/release-prices"
      query={search ? { q: search } : {}}
    />
  </div>;
}
