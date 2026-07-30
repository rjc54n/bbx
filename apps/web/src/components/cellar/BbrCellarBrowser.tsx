"use client";

import Link from "next/link";
import { type FormEvent, useMemo } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { FavouriteStar } from "@/components/favourites/FavouriteStar";
import { formatDateTime, formatFormat, formatPence, formatSignedPence } from "@/lib/format";
import { bbrProductUrl } from "@/lib/listingLinks";
import {
  askPremiumP,
  filterAndSortCellarRows,
  lowestAskLabel,
  parseCellarQuery,
  type BbrCellarRow,
  type CellarSortField,
} from "@/lib/cellar/bbrBrowser";

type BbrCellarBrowserProps = {
  rows: BbrCellarRow[];
  acceptedImportId: string | null;
  confirmedAt: string | null;
  unmatchedCount: number;
  favouriteParentSkus: string[];
};

type SortColumn = {
  field: CellarSortField;
  label: string;
  align?: "left" | "right";
};

const sortableColumns: SortColumn[] = [
  { field: "wine", label: "Wine" },
  { field: "region", label: "Region / colour" },
  { field: "vintage", label: "Vintage" },
  { field: "quantity_bottles", label: "Bottles", align: "right" },
  { field: "maturity", label: "Maturity / window" },
  { field: "purchase_price_per_case_p", label: "Purchase case", align: "right" },
  { field: "highest_bid_p", label: "Highest bid", align: "right" },
  { field: "lowest_ask_p", label: "Lowest ask", align: "right" },
  { field: "ask_premium_p", label: "Ask premium", align: "right" },
  { field: "last_rest_checked_at", label: "Market checked" },
];

function options(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))]
    .sort((left, right) => left.localeCompare(right, "en-GB", {
      sensitivity: "base",
      numeric: true,
    }));
}

function SelectFilter({
  label,
  name,
  value,
  choices,
  onChange,
}: {
  label: string;
  name: string;
  value: string;
  choices: Array<{ value: string; label: string }>;
  onChange: (value: string) => void;
}) {
  return (
    <label className="grid gap-1 text-xs text-ink-muted">
      {label}
      <select
        name={name}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="min-w-32 rounded border border-border bg-background px-2 py-1.5 text-sm text-ink"
      >
        {choices.map((choice) => (
          <option key={choice.value} value={choice.value}>
            {choice.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export function BbrCellarBrowser({
  rows,
  acceptedImportId,
  confirmedAt,
  unmatchedCount,
  favouriteParentSkus,
}: BbrCellarBrowserProps) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const favourites = useMemo(() => new Set(favouriteParentSkus), [favouriteParentSkus]);
  const query = useMemo(
    () => parseCellarQuery(new URLSearchParams(searchParams)),
    [searchParams],
  );
  const filteredRows = useMemo(
    () => filterAndSortCellarRows([...rows], query),
    [rows, query],
  );

  const regions = useMemo(() => options(rows.map((row) => row.region)), [rows]);
  const colours = useMemo(() => options(rows.map((row) => row.colour)), [rows]);
  const maturities = useMemo(
    () => options(rows.map((row) => row.maturity)),
    [rows],
  );
  const totalBottles = rows.reduce(
    (total, row) => total + (row.quantity_bottles ?? 0),
    0,
  );

  function replaceParams(changes: Record<string, string>) {
    const params = new URLSearchParams(searchParams);
    for (const [name, value] of Object.entries(changes)) {
      if (value) params.set(name, value);
      else params.delete(name);
    }
    const suffix = params.toString();
    router.replace(suffix ? `${pathname}?${suffix}` : pathname, {
      scroll: false,
    });
  }

  function applyTextAndVintage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    replaceParams({
      q: String(formData.get("q") ?? "").trim(),
      vintage_min: String(formData.get("vintage_min") ?? "").trim(),
      vintage_max: String(formData.get("vintage_max") ?? "").trim(),
    });
  }

  function setSort(field: CellarSortField) {
    const dir = query.sort.field === field && query.sort.dir === "asc"
      ? "desc"
      : "asc";
    replaceParams({ sort: `${field}:${dir}` });
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="border-b border-border bg-accent-soft px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-accent">
              My BBR Cellar
            </p>
            <h1 className="mt-1 text-2xl font-semibold">Current BBR holdings</h1>
            <p className="mt-1 text-sm text-ink-muted">
              Holdings confirmed {formatDateTime(confirmedAt)}. Bid and ask values
              come from the latest BBX scanner checks.
            </p>
          </div>
          <Link
            href="/cellar/imports"
            className="rounded border border-accent px-3 py-2 text-sm font-medium text-accent hover:bg-background"
          >
            Import data
          </Link>
        </div>
        <div className="mt-4 flex flex-wrap gap-3 text-sm">
          <span className="rounded border border-border bg-background px-3 py-2 tabular-nums">
            <strong>{rows.length.toLocaleString()}</strong> holding rows
          </span>
          <span className="rounded border border-border bg-background px-3 py-2 tabular-nums">
            <strong>{totalBottles.toLocaleString()}</strong> bottles
          </span>
        </div>
      </div>

      {unmatchedCount > 0 && acceptedImportId && (
        <p className="border-b border-amber-300 bg-amber-50 px-5 py-3 text-sm text-amber-950">
          {unmatchedCount.toLocaleString()} accepted source{" "}
          {unmatchedCount === 1 ? "row is" : "rows are"} unmatched and cannot
          be linked to current BBX prices.{" "}
          <Link
            href={`/cellar/imports/bbr/${acceptedImportId}`}
            className="font-medium underline"
          >
            Review the accepted import
          </Link>
        </p>
      )}

      <div className="border-b border-border bg-background px-4 py-3">
        <form
          key={`${query.search}|${query.vintageMin ?? ""}|${query.vintageMax ?? ""}`}
          onSubmit={applyTextAndVintage}
          className="flex flex-wrap items-end gap-2"
        >
          <label className="grid min-w-64 flex-1 gap-1 text-xs text-ink-muted">
            Search
            <input
              type="search"
              name="q"
              defaultValue={query.search}
              placeholder="Wine, producer or Parent ID"
              className="rounded border border-border px-3 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="grid gap-1 text-xs text-ink-muted">
            Vintage from
            <input
              type="number"
              name="vintage_min"
              inputMode="numeric"
              defaultValue={query.vintageMin}
              className="w-28 rounded border border-border px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <label className="grid gap-1 text-xs text-ink-muted">
            Vintage to
            <input
              type="number"
              name="vintage_max"
              inputMode="numeric"
              defaultValue={query.vintageMax}
              className="w-28 rounded border border-border px-2 py-1.5 text-sm text-ink"
            />
          </label>
          <button
            type="submit"
            className="rounded bg-accent px-3 py-2 text-sm font-medium text-accent-ink"
          >
            Apply
          </button>
        </form>

        <div className="mt-3 flex flex-wrap items-end gap-2">
          <SelectFilter
            label="Region"
            name="region"
            value={query.region}
            choices={[
              { value: "", label: "All regions" },
              ...regions.map((value) => ({ value, label: value })),
            ]}
            onChange={(value) => replaceParams({ region: value })}
          />
          <SelectFilter
            label="Colour"
            name="colour"
            value={query.colour}
            choices={[
              { value: "", label: "All colours" },
              ...colours.map((value) => ({ value, label: value })),
            ]}
            onChange={(value) => replaceParams({ colour: value })}
          />
          <SelectFilter
            label="Maturity"
            name="maturity"
            value={query.maturity}
            choices={[
              { value: "", label: "All maturities" },
              ...maturities.map((value) => ({ value, label: value })),
            ]}
            onChange={(value) => replaceParams({ maturity: value })}
          />
          <SelectFilter
            label="BBX eligibility"
            name="eligibility"
            value={query.eligibility}
            choices={[
              { value: "", label: "Either" },
              { value: "eligible", label: "Eligible" },
              { value: "not-eligible", label: "Not eligible" },
            ]}
            onChange={(value) => replaceParams({ eligibility: value })}
          />
          <SelectFilter
            label="Listing"
            name="listing"
            value={query.listing}
            choices={[
              { value: "", label: "Either" },
              { value: "listed", label: "Listed" },
              { value: "unlisted", label: "Unlisted" },
            ]}
            onChange={(value) => replaceParams({ listing: value })}
          />
          <SelectFilter
            label="Current bid"
            name="bid"
            value={query.bid}
            choices={[
              { value: "", label: "Either" },
              { value: "has-bid", label: "Has bid" },
              { value: "no-bid", label: "No bid" },
            ]}
            onChange={(value) => replaceParams({ bid: value })}
          />
          <button
            type="button"
            onClick={() => router.replace(pathname, { scroll: false })}
            className="px-2 py-2 text-sm text-accent underline-offset-2 hover:underline"
          >
            Reset filters
          </button>
        </div>
      </div>

      <div className="border-b border-border px-4 py-2 text-sm text-ink-muted">
        {filteredRows.length.toLocaleString()} of {rows.length.toLocaleString()} holdings
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
            <tr>
              {sortableColumns.map((column) => (
                <th
                  key={column.field}
                  scope="col"
                  className={`whitespace-nowrap px-3 py-2 font-medium text-ink-muted ${
                    column.align === "right" ? "text-right" : "text-left"
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => setSort(column.field)}
                    className="inline-flex items-center gap-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
                  >
                    {column.label}
                    {query.sort.field === column.field && (
                      <span aria-hidden="true">
                        {query.sort.dir === "asc" ? "▲" : "▼"}
                      </span>
                    )}
                  </button>
                </th>
              ))}
              <th scope="col" className="whitespace-nowrap px-3 py-2 text-center font-medium text-ink-muted">
                Favourite
              </th>
            </tr>
          </thead>
          <tbody>
            {filteredRows.length === 0 ? (
              <tr>
                <td
                  colSpan={sortableColumns.length + 1}
                  className="px-3 py-10 text-center text-ink-muted"
                >
                  No BBR holdings match these filters.
                </td>
              </tr>
            ) : filteredRows.map((row) => {
              const productUrl = bbrProductUrl(row.product_url);
              const askLabel = lowestAskLabel(row);
              const premium = askPremiumP(row);
              return (
                <tr
                  key={`${row.parent_sku}|${row.format_code}`}
                  className="border-t border-border hover:bg-accent-soft/50"
                >
                  <td className="max-w-sm px-3 py-2 align-top">
                    <p className="font-medium">
                      {productUrl ? (
                        <a
                          href={productUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-accent hover:underline"
                        >
                          {row.catalogue_name ?? row.description ?? row.parent_sku}
                        </a>
                      ) : row.catalogue_name ?? row.description ?? row.parent_sku}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {row.producer ?? row.product_code ?? row.parent_sku}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p>{row.region ?? "–"}</p>
                    <p className="text-xs text-ink-muted">{row.colour ?? "–"}</p>
                  </td>
                  <td className="px-3 py-2 align-top tabular-nums">
                    {row.vintage ?? "NV"}
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">
                    <p>{row.quantity_bottles ?? "–"}</p>
                    <p className="text-xs text-ink-muted">
                      {formatFormat(row.case_size, row.bottle_volume_ml)}
                    </p>
                  </td>
                  <td className="px-3 py-2 align-top">
                    <p>{row.maturity ?? "–"}</p>
                    <p className="text-xs text-ink-muted tabular-nums">
                      {row.drinking_window_from ?? "–"}–{row.drinking_window_to ?? "–"}
                    </p>
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">
                    {formatPence(row.purchase_price_per_case_p)}
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">
                    {row.highest_bid_p === null
                      ? <span className="text-ink-muted">No current bid</span>
                      : formatPence(row.highest_bid_p)}
                  </td>
                  <td className="px-3 py-2 text-right align-top tabular-nums">
                    {askLabel
                      ? <span className="text-ink-muted">{askLabel}</span>
                      : formatPence(row.lowest_ask_p)}
                  </td>
                  <td
                    className={`px-3 py-2 text-right align-top tabular-nums ${
                      premium === null
                        ? ""
                        : premium < 0
                          ? "text-green-700"
                          : premium > 0
                            ? "text-red-700"
                            : ""
                    }`}
                  >
                    {askLabel
                      ? <span className="text-ink-muted">{askLabel}</span>
                      : formatSignedPence(premium)}
                  </td>
                  <td className="px-3 py-2 align-top tabular-nums">
                    {formatDateTime(row.last_rest_checked_at)}
                  </td>
                  <td className="px-3 py-2 text-center align-top">
                    {/* An unmatched holding has no Parent ID, and BBR holdings
                        are not one of the two sources that carry a match group,
                        so there is nothing to hold a star against. */}
                    {row.parent_sku ? (
                      <FavouriteStar
                        target={{ kind: "wine", parentSku: row.parent_sku }}
                        favourite={favourites.has(row.parent_sku)}
                        label={row.catalogue_name ?? row.description ?? row.parent_sku}
                      />
                    ) : <span className="text-xs text-ink-muted">Unmatched</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
