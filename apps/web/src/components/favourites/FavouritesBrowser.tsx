"use client";

import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useMemo } from "react";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { formatDate, formatPence, formatSignedPct } from "@/lib/format";
import {
  filterAndSortFavourites,
  heldBottles,
  isOrphan,
  parseFavouriteQuery,
  serializeFavouriteQuery,
  sourceChips,
  type FavouriteSortField,
  type FavouriteWineRow,
  type PendingFavouriteRow,
} from "@/lib/favourites/browser";
import { isFavouriteSource } from "@/lib/favourites/target";

const columns: { field: FavouriteSortField; label: string; align?: "right" }[] = [
  { field: "wine", label: "Wine" },
  { field: "vintage", label: "Vintage" },
  { field: "held", label: "Held", align: "right" },
  { field: "lowest_ask_per_bottle_p", label: "Lowest ask", align: "right" },
  { field: "highest_bid_per_bottle_p", label: "Highest bid", align: "right" },
  { field: "latest_release_price_per_bottle_p", label: "Release", align: "right" },
  { field: "ask_vs_release_pct", label: "Ask vs release", align: "right" },
  { field: "favourited_at", label: "Favourited" },
];

function Chip({ children }: { children: string }) {
  return <span className="rounded-full border border-border px-2 py-0.5 text-xs text-ink-muted">{children}</span>;
}

function matchPath(source: string): string {
  return source === "cellartracker" ? "/cellartracker/matches" : "/release-prices/matches";
}

export function FavouritesBrowser({ wines, pending }: {
  wines: FavouriteWineRow[];
  pending: PendingFavouriteRow[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseFavouriteQuery(new URLSearchParams(searchParams)), [searchParams]);
  const rows = useMemo(() => filterAndSortFavourites(wines, query), [wines, query]);

  function push(next: Parameters<typeof serializeFavouriteQuery>[0]) {
    const params = serializeFavouriteQuery(next).toString();
    router.replace(params ? `${pathname}?${params}` : pathname, { scroll: false });
  }

  function submitSearch(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const search = String(new FormData(event.currentTarget).get("q") ?? "").trim();
    push({ ...query, search });
  }

  function setSort(field: FavouriteSortField) {
    const dir = query.sort.field === field && query.sort.dir === "desc" ? "asc" : "desc";
    push({ ...query, sort: { field, dir } });
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Favourites</p>
          <h1 className="mt-1 text-2xl font-semibold">Wines I care about</h1>
          <p className="mt-1 max-w-3xl text-sm text-ink-muted">
            All figures are 75cl bottle equivalents. Held counts home bottles plus whichever
            source reports more at BBR, so bottles known to both are not counted twice.
          </p>
        </div>
        <div className="rounded border border-border bg-background px-3 py-2 text-sm">
          <strong>{wines.length.toLocaleString()}</strong> favourited
          {pending.length > 0 && <> · <strong>{pending.length.toLocaleString()}</strong> awaiting a link</>}
        </div>
      </div>
    </header>

    <div className="flex flex-wrap items-end gap-3 border-b border-border bg-background p-4">
      {/* Submitted rather than pushed per keystroke: the query lives in the URL,
          and a replace() on every character fights the input's own value. */}
      <form onSubmit={submitSearch} className="flex items-end gap-2">
        <label className="grid gap-1 text-xs text-ink-muted">Search
          <input
            type="search"
            name="q"
            defaultValue={query.search}
            placeholder="Wine, producer, region or Parent ID"
            className="w-72 rounded border border-border px-3 py-2 text-sm text-ink"
          />
        </label>
        <button type="submit" className="rounded border border-accent px-3 py-2 text-sm text-accent">Search</button>
      </form>
      <label className="grid gap-1 text-xs text-ink-muted">Held
        <select value={query.held} onChange={(event) => push({ ...query, held: event.target.value as typeof query.held })} className="rounded border border-border px-2 py-2 text-sm text-ink">
          <option value="">Any</option><option value="yes">In cellar</option><option value="no">Not held</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-ink-muted">Ask
        <select value={query.ask} onChange={(event) => push({ ...query, ask: event.target.value as typeof query.ask })} className="rounded border border-border px-2 py-2 text-sm text-ink">
          <option value="">Any</option><option value="yes">Has an ask</option><option value="no">No ask</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-ink-muted">Listing
        <select value={query.listing} onChange={(event) => push({ ...query, listing: event.target.value as typeof query.listing })} className="rounded border border-border px-2 py-2 text-sm text-ink">
          <option value="">Any</option><option value="listed">Listed</option><option value="unlisted">Unlisted</option>
        </select>
      </label>
      <label className="grid gap-1 text-xs text-ink-muted">Tracked
        <select value={query.tracked} onChange={(event) => push({ ...query, tracked: event.target.value as typeof query.tracked })} className="rounded border border-border px-2 py-2 text-sm text-ink">
          <option value="">Any</option><option value="yes">In tracked book</option><option value="no">Not tracked</option>
        </select>
      </label>
      <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className="px-2 py-2 text-sm text-accent underline-offset-2 hover:underline">
        Reset filters
      </button>
    </div>

    <div className="border-b border-border px-4 py-2 text-sm text-ink-muted">
      {rows.length.toLocaleString()} of {wines.length.toLocaleString()} favourited wines
    </div>

    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
          <tr>
            {columns.map((column) => (
              <th key={column.field} scope="col" className={`whitespace-nowrap px-3 py-2 font-medium text-ink-muted ${column.align === "right" ? "text-right" : "text-left"}`}>
                <button type="button" onClick={() => setSort(column.field)} className="inline-flex items-center gap-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent">
                  {column.label}
                  {query.sort.field === column.field && <span aria-hidden="true">{query.sort.dir === "asc" ? "▲" : "▼"}</span>}
                </button>
              </th>
            ))}
            <th scope="col" className="whitespace-nowrap px-3 py-2 text-center font-medium text-ink-muted">Favourite</th>
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? <tr><td colSpan={columns.length + 1} className="px-3 py-10 text-center text-ink-muted">
            {wines.length === 0
              ? "Nothing favourited yet. Star a wine anywhere in the app and it will appear here."
              : "No favourites match these filters."}
          </td></tr> : rows.map((row) => (
            <tr key={row.parent_sku} className="border-t border-border hover:bg-accent-soft/50">
              <td className="max-w-sm px-3 py-2 align-top">
                <Link href={`/wine/parent/${row.parent_sku}`} className="font-medium text-accent underline-offset-2 hover:underline">
                  {row.wine_name ?? row.parent_sku}
                </Link>
                <p className="text-xs text-ink-muted">{row.producer ?? "Producer unavailable"} · Parent {row.parent_sku}</p>
                <p className="mt-1 flex flex-wrap gap-1">
                  {sourceChips(row).map((chip) => <Chip key={chip}>{chip}</Chip>)}
                  {isOrphan(row) && <span className="rounded-full border border-accent px-2 py-0.5 text-xs text-accent" title="Favourited, but no source record links to this wine. Usually a corrected mis-link.">No linked records</span>}
                </p>
              </td>
              <td className="px-3 py-2 align-top tabular-nums">{row.vintage ?? "–"}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{heldBottles(row) || "–"}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatPence(row.lowest_ask_per_bottle_p)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatPence(row.highest_bid_per_bottle_p)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">
                {formatPence(row.latest_release_price_per_bottle_p)}
                {row.latest_release_offer_date && <span className="block text-xs text-ink-muted">{formatDate(row.latest_release_offer_date)}</span>}
              </td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatSignedPct(row.ask_vs_release_pct)}</td>
              <td className="px-3 py-2 align-top tabular-nums">{formatDate(row.favourited_at)}</td>
              <td className="px-3 py-2 text-center align-top">
                <FavouriteStar
                  target={{ kind: "wine", parentSku: row.parent_sku }}
                  favourite
                  label={row.wine_name ?? row.parent_sku}
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>

    {pending.length > 0 && <section aria-labelledby="pending-favourites" className="border-t border-border bg-accent-soft px-5 py-4">
      <h2 id="pending-favourites" className="text-lg font-semibold">Awaiting a link</h2>
      <p className="mt-1 max-w-3xl text-sm text-ink-muted">
        Starred while unmatched, so the star is held against the source record until it
        resolves to a Parent ID. This is the work queue of wines worth identifying.
      </p>
      <div className="mt-4 grid gap-3 lg:grid-cols-2">
        {pending.map((row) => (
          <article key={`${row.source}-${row.match_group_key}`} className="flex items-start justify-between gap-3 rounded border border-border bg-background p-3 text-sm">
            <div className="min-w-0">
              <p className="font-medium">{row.source_wine ?? row.match_group_key}</p>
              <p className="mt-1 text-xs text-ink-muted">
                {row.vintage ?? "Vintage unavailable"} · {row.source === "cellartracker" ? "CellarTracker" : "Release offer"}
                {row.record_count !== null && row.record_count > 0 && <> · {row.record_count} record{row.record_count === 1 ? "" : "s"}</>}
                {row.bottles ? ` · ${row.bottles} bottle${row.bottles === 1 ? "" : "s"}` : ""}
              </p>
              <p className="mt-1 text-xs text-ink-muted">
                {row.is_stale
                  ? "No longer in the current snapshot"
                  : (row.suggestion_count ?? 0) > 0
                    ? `${row.suggestion_count} candidate${row.suggestion_count === 1 ? "" : "s"} to review`
                    : "No candidates found yet"}
              </p>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Link href={matchPath(row.source)} className="rounded border border-accent px-2 py-1 text-xs text-accent">Match</Link>
              {isFavouriteSource(row.source) && <FavouriteStar
                target={{ kind: "record", source: row.source, matchGroupKey: row.match_group_key }}
                favourite
                label={row.source_wine ?? row.match_group_key}
              />}
            </div>
          </article>
        ))}
      </div>
    </section>}
  </div>;
}
