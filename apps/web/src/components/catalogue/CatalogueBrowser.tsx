"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type {
  CatalogueFilterField,
  CatalogueMetricField,
  PriceChangeSortField,
} from "@/lib/query/registry";
import { getFilter, removeFilter, setFilter } from "@/lib/query/filterOps";
import { fetchCatalogue, fetchPriceChanges, PAGE_SIZE, type FetchResult } from "@/lib/query/fetchCatalogue";
import {
  fetchFacetRanges,
  fetchFacetValues,
  fetchFormatOptions,
  type FacetRanges,
  type FacetValues,
  type FormatOption,
} from "@/lib/query/facets";
import type { CatalogueRow, PriceChangeRow } from "@/lib/query/rows";
import { startingPointFor } from "@/lib/query/startingPoints";
import type { CatalogueFilter, QueryState } from "@/lib/query/types";
import { parse, serialize } from "@/lib/query/url";
import { CATALOGUE_COLUMNS, favouriteColumn, PRICE_CHANGE_COLUMNS, withFormatAdjustedColumns } from "./columns";
import { DataHonestyHeader } from "./DataHonestyHeader";
import { DataTable } from "./DataTable";
import { FilterChips } from "./FilterChips";
import { FilterStrip } from "./FilterStrip";
import { Pagination } from "@/components/nav/Pagination";
import { SearchBar } from "./SearchBar";

function rowKey(row: { parent_sku: string | null; format_code: string | null }): string {
  return `${row.parent_sku}|${row.format_code}`;
}

// Explore and Price Changes are the only visible starting points. The typed
// query-state machinery preserves the other internal starting points for a
// later saved-filter or agent interface without making them permanent tabs.
// favouriteParentSkus arrives from the server page rather than being fetched
// here alongside the rows: setFavourite() calls refresh(), which re-renders the
// server tree and delivers the new set as props. A client-side fetch would not
// see that, and the star's optimistic value would revert on every toggle.
export function CatalogueBrowser({ favouriteParentSkus }: { favouriteParentSkus: string[] }) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const favourites = useMemo(() => new Set(favouriteParentSkus), [favouriteParentSkus]);

  const queryState = useMemo(() => parse(searchParams), [searchParams]);

  const pushQuery = useCallback(
    (next: QueryState) => {
      router.replace(`${pathname}?${serialize(next).toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  // Off by default: the format premium correction agrees with the raw guide
  // on every 750ml row (the large majority), so it doesn't earn a permanent
  // place next to Market / vs Market. A view preference, not query state --
  // doesn't affect which rows are returned, just which columns are shown.
  const [showFormatAdjusted, setShowFormatAdjusted] = useState(false);

  const [facetValues, setFacetValues] = useState<FacetValues>({});
  const [facetRanges, setFacetRanges] = useState<FacetRanges | null>(null);
  const [formatOptions, setFormatOptions] = useState<FormatOption[]>([]);
  const [facetError, setFacetError] = useState<string | null>(null);
  const [facetRetry, setFacetRetry] = useState(0);

  useEffect(() => {
    if (queryState.mode === "price-changes") return;
    let cancelled = false;
    Promise.all([fetchFacetValues(), fetchFacetRanges(), fetchFormatOptions()])
      .then(([values, ranges, formats]) => {
        if (!cancelled) {
          setFacetValues(values);
          setFacetRanges(ranges);
          setFormatOptions(formats);
          setFacetError(null);
        }
      })
      .catch(() => {
        if (!cancelled) setFacetError("Filters are temporarily unavailable.");
      });
    return () => {
      cancelled = true;
    };
  }, [queryState.mode, facetRetry]);

  const [catalogueResult, setCatalogueResult] = useState<FetchResult<CatalogueRow>>({ rows: [], count: 0 });
  const [priceChangeResult, setPriceChangeResult] = useState<FetchResult<PriceChangeRow>>({ rows: [], count: 0 });
  const [error, setError] = useState<string | null>(null);
  const [resultRetry, setResultRetry] = useState(0);
  // Which QueryState the current result/error reflects. `loading` is derived
  // by comparing this against the live queryState below, rather than a
  // separate setLoading(true) at the top of the effect -- calling setState
  // synchronously as the first thing an effect does forces an extra render
  // every single query change; deriving it during render doesn't.
  const [loadedQuery, setLoadedQuery] = useState<QueryState | null>(null);

  useEffect(() => {
    let cancelled = false;

    const request =
      queryState.mode === "price-changes" ? fetchPriceChanges(queryState) : fetchCatalogue(queryState);

    request
      .then((result) => {
        if (cancelled) return;
        if (queryState.mode === "price-changes") {
          setPriceChangeResult(result as FetchResult<PriceChangeRow>);
        } else {
          setCatalogueResult(result as FetchResult<CatalogueRow>);
        }
        setError(null);
        setLoadedQuery(queryState);
      })
      .catch(() => {
        if (cancelled) return;
        setError("The catalogue could not be loaded. Try again.");
        setLoadedQuery(queryState);
      });

    return () => {
      cancelled = true;
    };
  }, [queryState, resultRetry]);

  const loading = loadedQuery !== queryState;

  function handleReset() {
    pushQuery(startingPointFor(queryState.mode).initialState);
  }

  function retryResults() {
    setLoadedQuery(null);
    setResultRetry((current) => current + 1);
  }

  function handlePageChange(page: number) {
    pushQuery({ ...queryState, page } as QueryState);
  }

  function handleSetFilter(filter: CatalogueFilter) {
    if (queryState.mode === "price-changes") return;
    pushQuery({ ...queryState, filters: setFilter(queryState.filters, filter), page: 0 });
  }

  // Accepts one field or several -- removing several must fold through a
  // single queryState.filters snapshot into one pushQuery call. Two separate
  // handleRemoveFilter(field) calls in a row (e.g. FilterChips removing the
  // combined Format chip) would each close over the *same* pre-removal
  // queryState, so the second call's pushQuery -- computed from filters that
  // still include what the first call just removed -- overwrites the
  // first's URL update and only the second field ends up removed.
  function handleRemoveFilter(fieldOrFields: CatalogueFilterField | CatalogueFilterField[]) {
    if (queryState.mode === "price-changes") return;
    const fields = Array.isArray(fieldOrFields) ? fieldOrFields : [fieldOrFields];
    const filters = fields.reduce((acc, field) => removeFilter(acc, field), queryState.filters);
    pushQuery({ ...queryState, filters, page: 0 });
  }

  function handleSetFormat(formatCodes: string[]) {
    if (queryState.mode === "price-changes") return;
    const filters = formatCodes.length > 0
      ? setFilter(queryState.filters, { field: "format_code", kind: "enum", value: formatCodes })
      : removeFilter(queryState.filters, "format_code");
    pushQuery({ ...queryState, filters, page: 0 });
  }

  function handleSetSearch(value: string) {
    if (queryState.mode === "price-changes") return;
    const filters = value
      ? setFilter(queryState.filters, { field: "search", kind: "text", value })
      : removeFilter(queryState.filters, "search");
    pushQuery({ ...queryState, filters, page: 0 });
  }

  // Default (filter absent) is the whole biddable catalogue, listed and
  // unlisted alike. Checking "Only listed wines" opts into the restriction
  // (value: true); unchecking removes the filter entirely rather than
  // writing value: false, so the URL returns to its unfiltered default
  // form instead of an equivalent-but-noisier explicit param.
  function handleSetOnlyListed(checked: boolean) {
    if (queryState.mode === "price-changes") return;
    const filters = checked
      ? setFilter(queryState.filters, { field: "is_listed", kind: "boolean", value: true })
      : removeFilter(queryState.filters, "is_listed");
    pushQuery({ ...queryState, filters, page: 0 });
  }

  const isPriceChanges = queryState.mode === "price-changes";
  const totalCount = isPriceChanges ? priceChangeResult.count : catalogueResult.count;
  const resultsWord = queryState.mode === "value-research" ? "value signals" : "results";
  const searchValue = !isPriceChanges ? getFilter(queryState.filters, "search")?.value ?? "" : "";
  const onlyListed = !isPriceChanges && getFilter(queryState.filters, "is_listed")?.value === true;

  const visibleCatalogueColumns = useMemo(
    () => [
      ...withFormatAdjustedColumns(CATALOGUE_COLUMNS, showFormatAdjusted),
      favouriteColumn<CatalogueRow, CatalogueMetricField>(favourites),
    ],
    [showFormatAdjusted, favourites],
  );
  // Stable per view (mode + filters + sort + page): powers row-scroll
  // restoration when the user returns from a wine card.
  const scrollMemoryKey = useMemo(() => serialize(queryState).toString(), [queryState]);

  const visiblePriceChangeColumns = useMemo(
    () => [
      ...PRICE_CHANGE_COLUMNS,
      favouriteColumn<PriceChangeRow, PriceChangeSortField>(favourites),
    ],
    [favourites],
  );

  return (
    <div className="flex h-full flex-col">
      <DataHonestyHeader />

      {!isPriceChanges && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <SearchBar value={searchValue} onCommit={handleSetSearch} />
          {facetError ? <div role="alert" className="rounded border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
            Filters are temporarily unavailable. <button type="button" onClick={() => setFacetRetry((current) => current + 1)} className="underline underline-offset-2">Try again</button>
          </div> : <FilterStrip
            key={queryState.mode}
            filters={queryState.filters}
            facetValues={facetValues}
            facetRanges={facetRanges}
            formatOptions={formatOptions}
            onSetFilter={handleSetFilter}
            onRemoveFilter={handleRemoveFilter}
            onSetFormat={handleSetFormat}
          />}
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm text-ink-muted">
        <span className="tabular-nums">
          {loading ? "Loading…" : `${totalCount.toLocaleString()} ${resultsWord}`}
        </span>
        <div className="flex flex-wrap items-center gap-3">
          {!isPriceChanges && (
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={showFormatAdjusted}
                onChange={(e) => setShowFormatAdjusted(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Show format-adjusted values
            </label>
          )}
          {!isPriceChanges && (
            <label className="flex items-center gap-1.5 whitespace-nowrap">
              <input
                type="checkbox"
                checked={onlyListed}
                onChange={(e) => handleSetOnlyListed(e.target.checked)}
                className="h-3.5 w-3.5 accent-accent"
              />
              Only listed wines
            </label>
          )}
          {!isPriceChanges && (
            <FilterChips
              filters={queryState.filters}
              formatOptions={formatOptions}
              onRemove={handleRemoveFilter}
              onReset={handleReset}
            />
          )}
        </div>
      </div>

      {isPriceChanges ? (
        <DataTable
          columns={visiblePriceChangeColumns}
          rows={priceChangeResult.rows}
          rowKey={rowKey}
          sort={queryState.sort}
          onSortChange={(field, dir) => pushQuery({ mode: "price-changes", filters: [], sort: { field, dir }, page: 0 })}
          loading={loading}
          emptyMessage="No price changes match this view."
          errorMessage={error}
          onRetry={retryResults}
          scrollMemoryKey={scrollMemoryKey}
        />
      ) : (
        <DataTable
          columns={visibleCatalogueColumns}
          rows={catalogueResult.rows}
          rowKey={rowKey}
          sort={queryState.sort}
          onSortChange={(field, dir) => pushQuery({ ...queryState, sort: { field, dir }, page: 0 })}
          loading={loading}
          emptyMessage="No results match these filters."
          errorMessage={error}
          onRetry={retryResults}
          scrollMemoryKey={scrollMemoryKey}
        />
      )}

      <Pagination
        page={queryState.page + 1}
        totalPages={Math.max(1, Math.ceil(totalCount / PAGE_SIZE))}
        totalCount={totalCount}
        label="results"
        onPageChange={(target) => handlePageChange(target - 1)}
      />
    </div>
  );
}
