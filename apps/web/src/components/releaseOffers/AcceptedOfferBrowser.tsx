"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { formatDate } from "@/lib/format";
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

export function AcceptedOfferBrowser({ rows, favouriteParentSkus, pendingFavourites }: {
  rows: AcceptedOfferRow[];
  favouriteParentSkus: string[];
  pendingFavourites: { source: string; match_group_key: string }[];
}) {
  const [search, setSearch] = useState("");
  const favourites = useMemo(
    () => buildFavouriteState(favouriteParentSkus, pendingFavourites),
    [favouriteParentSkus, pendingFavourites],
  );
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("en-GB");
    if (!query) return rows;
    return rows.filter((row) => [row.source_wine, row.source_product_id, row.parent_sku, row.source_price_text]
      .filter(Boolean).join(" ").toLocaleLowerCase("en-GB").includes(query));
  }, [rows, search]);
  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4"><div className="flex flex-wrap items-start justify-between gap-4"><div><p className="text-xs font-semibold uppercase tracking-wider text-accent">Release offers</p><h1 className="mt-1 text-2xl font-semibold">Accepted offer records</h1></div><div className="flex gap-2"><Link href="/release-prices/matches" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Match offers</Link><Link href="/cellar/imports" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background">Import data</Link></div></div><div className="mt-4 rounded border border-border bg-background px-3 py-2 text-sm"><strong>{rows.length.toLocaleString()}</strong> accepted offer records</div></header>
    <div className="border-b border-border bg-background p-4"><label className="grid max-w-xl gap-1 text-xs text-ink-muted">Search accepted offers<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Wine, Parent ID or original price text" className="rounded border border-border px-3 py-2 text-sm text-ink" /></label></div>
    <div className="border-b border-border px-4 py-2 text-sm text-ink-muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()} offer records</div>
    <div className="min-h-0 flex-1 overflow-auto"><table className="w-full min-w-[1,000px] text-left text-sm"><thead className="sticky top-0 bg-background text-xs uppercase text-ink-muted shadow-[0_1px_0_0_var(--border)]"><tr><th className="p-3">Offer date</th><th className="p-3">Wine</th><th className="p-3">Original price text</th><th className="p-3">Fragments</th><th className="p-3">Link</th><th className="p-3 text-center">Favourite</th></tr></thead><tbody>{filtered.map((row) => <tr key={`${row.import_id}-${row.source_row_number}`} className="border-t border-border"><td className="p-3 whitespace-nowrap">{formatDate(row.offer_date)}</td><td className="p-3"><Link href={`/release-prices/offers/${row.import_id}/${row.source_row_number}`} className="font-medium text-accent underline-offset-2 hover:underline">{row.source_wine}</Link><p className="text-xs text-ink-muted">{row.source_vintage ?? "Vintage unavailable"}{row.source_product_id ? ` · supplied ${row.source_product_id}` : ""}</p></td><td className="max-w-xl p-3">{row.source_price_text}</td><td className="p-3">{row.price_fragment_count} parsed, {row.valid_in_bond_fragment_count} valid in bond</td><td className="p-3">{row.link_status === "linked" ? `${row.parent_sku} (${row.match_method})` : row.link_status === "ignored" ? "Ignored" : "Unlinked"}</td><td className="p-3 text-center">{(() => {
      const target = targetForRecord("release_offer", row.link_status, row.parent_sku, row.match_group_key);
      if (!target) return <span className="text-xs text-ink-muted">Unavailable</span>;
      return <FavouriteStar target={target} favourite={isFavourited(favourites, target)} label={row.source_wine} />;
    })()}</td></tr>)}</tbody></table></div>
  </div>;
}
