"use client";

import Link from "next/link";
import { type FormEvent, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { formatDate, formatDateTime, formatFormat, formatPence, formatSignedPct } from "@/lib/format";
import { bbrProductUrl } from "@/lib/listingLinks";
import {
  filterAndSortReleasePrices,
  parseReleasePriceQuery,
  type ReleasePriceRow,
  type ReleaseSortField,
} from "@/lib/releaseOffers/browser";

type Column = { field: ReleaseSortField; label: string; right?: boolean };
const columns: Column[] = [
  { field: "wine", label: "Wine" },
  { field: "vintage", label: "Vintage" },
  { field: "offer_date", label: "Offer date" },
  { field: "release_price_p", label: "Release price", right: true },
  { field: "lowest_ask_p", label: "Lowest ask", right: true },
  { field: "ask_vs_release_pct", label: "Ask vs release", right: true },
  { field: "highest_bid_p", label: "Highest bid", right: true },
  { field: "last_rest_checked_at", label: "Market checked" },
];

function values(items: Array<string | null>): string[] {
  return [...new Set(items.filter((item): item is string => Boolean(item)))]
    .sort((a, b) => a.localeCompare(b, "en-GB", { numeric: true, sensitivity: "base" }));
}

function Filter({ label, value, choices, onChange }: {
  label: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return <label className="grid gap-1 text-xs text-ink-muted">
    {label}
    <select value={value} onChange={(event) => onChange(event.target.value)} className="min-w-32 rounded border border-border bg-background px-2 py-1.5 text-sm text-ink">
      {choices.map((choice) => <option key={choice.value} value={choice.value}>{choice.label}</option>)}
    </select>
  </label>;
}

export function ReleasePriceBrowser({ rows }: { rows: ReleasePriceRow[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const query = useMemo(() => parseReleasePriceQuery(new URLSearchParams(searchParams)), [searchParams]);
  const filtered = useMemo(() => filterAndSortReleasePrices([...rows], query), [rows, query]);
  const regions = useMemo(() => values(rows.map((row) => row.region)), [rows]);
  const formats = useMemo(() => values(rows.map((row) => row.format_code)), [rows]);
  const belowRelease = rows.filter((row) => row.lowest_ask_p !== null && row.lowest_ask_p < row.release_price_p).length;

  function replaceParams(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams);
    for (const [name, value] of Object.entries(changes)) {
      if (value) params.set(name, value);
      else params.delete(name);
    }
    const suffix = params.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, { scroll: false });
  }

  function applyText(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    replaceParams({
      q: String(data.get("q") ?? "").trim(),
      vintage_min: String(data.get("vintage_min") ?? "").trim(),
      vintage_max: String(data.get("vintage_max") ?? "").trim(),
    });
  }

  function setSort(field: ReleaseSortField) {
    const dir = query.sort.field === field && query.sort.dir === "asc" ? "desc" : "asc";
    replaceParams({ sort: `${field}:${dir}` });
  }

  return <div className="flex min-h-0 flex-1 flex-col">
    <header className="border-b border-border bg-accent-soft px-5 py-4">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-wider text-accent">Release prices</p>
          <h1 className="mt-1 text-2xl font-semibold">Release price against current BBX</h1>
          <p className="mt-1 text-sm text-ink-muted">Provisional anchors use the oldest accepted exact-format in-bond offer. Current bids and asks come from the scanner.</p>
        </div>
        <Link href="/cellar/imports/release-offers" className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background">Import offers</Link>
      </div>
      <div className="mt-4 flex flex-wrap gap-3 text-sm">
        <span className="rounded border border-border bg-background px-3 py-2"><strong>{rows.length.toLocaleString()}</strong> product formats</span>
        <span className="rounded border border-border bg-background px-3 py-2"><strong>{belowRelease.toLocaleString()}</strong> asks below release</span>
      </div>
    </header>

    <div className="border-b border-border bg-background px-4 py-3">
      <form key={`${query.search}|${query.vintageMin}|${query.vintageMax}`} onSubmit={applyText} className="flex flex-wrap items-end gap-2">
        <label className="grid min-w-64 flex-1 gap-1 text-xs text-ink-muted">Search
          <input name="q" type="search" defaultValue={query.search} placeholder="Wine, producer or Parent ID" className="rounded border border-border px-3 py-1.5 text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-ink-muted">Vintage from
          <input name="vintage_min" type="number" defaultValue={query.vintageMin ?? ""} className="w-28 rounded border border-border px-2 py-1.5 text-sm text-ink" />
        </label>
        <label className="grid gap-1 text-xs text-ink-muted">Vintage to
          <input name="vintage_max" type="number" defaultValue={query.vintageMax ?? ""} className="w-28 rounded border border-border px-2 py-1.5 text-sm text-ink" />
        </label>
        <button type="submit" className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink">Apply</button>
      </form>
      <div className="mt-3 flex flex-wrap items-end gap-2">
        <Filter label="Region" value={query.region} choices={[{ value: "", label: "All regions" }, ...regions.map((value) => ({ value, label: value }))]} onChange={(value) => replaceParams({ region: value })} />
        <Filter label="Format" value={query.format} choices={[{ value: "", label: "All formats" }, ...formats.map((value) => ({ value, label: value }))]} onChange={(value) => replaceParams({ format: value })} />
        <Filter label="Anchor" value={query.anchor} choices={[{ value: "", label: "Either" }, { value: "provisional", label: "Provisional" }, { value: "confirmed", label: "Confirmed" }]} onChange={(value) => replaceParams({ anchor: value })} />
        <Filter label="Listing" value={query.listing} choices={[{ value: "", label: "Either" }, { value: "listed", label: "Listed" }, { value: "unlisted", label: "Unlisted" }]} onChange={(value) => replaceParams({ listing: value })} />
        <Filter label="Current bid" value={query.bid} choices={[{ value: "", label: "Either" }, { value: "yes", label: "Has bid" }, { value: "no", label: "No bid" }]} onChange={(value) => replaceParams({ bid: value })} />
        <Filter label="Ask below release" value={query.below} choices={[{ value: "", label: "Either" }, { value: "yes", label: "Below" }, { value: "no", label: "Not below" }]} onChange={(value) => replaceParams({ below: value })} />
        <button type="button" onClick={() => router.replace(pathname, { scroll: false })} className="px-2 py-2 text-sm text-accent underline-offset-2 hover:underline">Reset filters</button>
      </div>
    </div>

    <div className="border-b border-border px-4 py-2 text-sm text-ink-muted">{filtered.length.toLocaleString()} of {rows.length.toLocaleString()} product formats</div>
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]"><tr>
          {columns.map((column) => <th key={column.field} className={`whitespace-nowrap px-3 py-2 font-medium text-ink-muted ${column.right ? "text-right" : "text-left"}`}><button type="button" onClick={() => setSort(column.field)}>{column.label}{query.sort.field === column.field ? ` ${query.sort.dir === "asc" ? "▲" : "▼"}` : ""}</button></th>)}
          <th className="px-3 py-2 text-right font-medium text-ink-muted">Recoup bid</th>
          <th className="px-3 py-2 text-left font-medium text-ink-muted">Anchor</th>
        </tr></thead>
        <tbody>
          {filtered.length === 0 ? <tr><td colSpan={columns.length + 2} className="px-3 py-10 text-center text-ink-muted">No release-price rows match these filters.</td></tr> : filtered.map((row) => {
            const url = bbrProductUrl(row.product_url);
            return <tr key={`${row.parent_sku}|${row.format_code}`} className="border-t border-border hover:bg-accent-soft/50">
              <td className="max-w-sm px-3 py-2 align-top"><p className="font-medium">{url ? <a href={url} target="_blank" rel="noreferrer" className="hover:text-accent hover:underline">{row.name ?? row.source_wine}</a> : row.name ?? row.source_wine}</p><p className="text-xs text-ink-muted">{row.producer ?? row.parent_sku} · {row.region ?? "Region unavailable"} · {formatFormat(row.case_size, row.bottle_volume_ml)}</p></td>
              <td className="px-3 py-2 align-top tabular-nums">{row.vintage ?? "NV"}</td>
              <td className="px-3 py-2 align-top tabular-nums">{formatDate(row.offer_date)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatPence(row.release_price_p)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{row.lowest_ask_p === null ? <span className="text-ink-muted">{row.is_listed === false ? "Unlisted" : "Price unavailable"}</span> : formatPence(row.lowest_ask_p)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{formatSignedPct(row.ask_vs_release_pct)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums">{row.highest_bid_p === null ? <span className="text-ink-muted">No current bid</span> : formatPence(row.highest_bid_p)}</td>
              <td className="px-3 py-2 align-top tabular-nums">{formatDateTime(row.last_rest_checked_at)}</td>
              <td className="px-3 py-2 text-right align-top tabular-nums"><p>{formatPence(row.recoup_bid_p)}</p><p className="text-xs text-ink-muted">excludes storage</p></td>
              <td className="px-3 py-2 align-top"><Link href={`/release-prices/${row.parent_sku}/${row.format_code}`} className="text-accent hover:underline">{row.anchor_status === "confirmed" ? "Confirmed" : "Provisional"}</Link></td>
            </tr>;
          })}
        </tbody>
      </table>
    </div>
  </div>;
}
