"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import type { CatalogueFilterField } from "@/lib/query/registry";
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
import { CATALOGUE_COLUMNS, PRICE_CHANGE_COLUMNS } from "./columns";
import { DataHonestyHeader } from "./DataHonestyHeader";
import { DataTable } from "./DataTable";
import { FilterChips } from "./FilterChips";
import { FilterStrip } from "./FilterStrip";
import { ModeTabs } from "./ModeTabs";
import { Pagination } from "./Pagination";
import { SearchBar } from "./SearchBar";

function rowKey(row: { parent_sku: string | null; format_code: string | null }): string {
  return `${row.parent_sku}|${row.format_code}`;
}

// Explore and Price Changes are the only visible starting points. The typed
// query-state machinery preserves the other internal starting points for a
// later saved-filter or agent interface without making them permanent tabs.
export function CatalogueBrowser() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const queryState = useMemo(() => parse(searchParams), [searchParams]);

  const pushQuery = useCallback(
    (next: QueryState) => {
      router.replace(`${pathname}?${serialize(next).toString()}`, { scroll: false });
    },
    [router, pathname],
  );

  const [facetValues, setFacetValues] = useState<FacetValues>({});
  const [facetRanges, setFacetRanges] = useState<FacetRanges | null>(null);
  const [formatOptions, setFormatOptions] = useState<FormatOption[]>([]);

  useEffect(() => {
    if (queryState.mode === "price-changes") return;
    let cancelled = false;
    Promise.all([fetchFacetValues(), fetchFacetRanges(), fetchFormatOptions()]).then(([values, ranges, formats]) => {
      if (!cancelled) {
        setFacetValues(values);
        setFacetRanges(ranges);
        setFormatOptions(formats);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [queryState.mode]);

  const [catalogueResult, setCatalogueResult] = useState<FetchResult<CatalogueRow>>({ rows: [], count: 0 });
  const [priceChangeResult, setPriceChangeResult] = useState<FetchResult<PriceChangeRow>>({ rows: [], count: 0 });
  const [error, setError] = useState<string | null>(null);
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
      .catch((err) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : String(err));
        setLoadedQuery(queryState);
      });

    return () => {
      cancelled = true;
    };
  }, [queryState]);

  const loading = loadedQuery !== queryState;

  function handleReset() {
    pushQuery(startingPointFor(queryState.mode).initialState);
  }

  function handlePageChange(page: number) {
    pushQuery({ ...queryState, page } as QueryState);
  }

  function handleModeChange(mode: "explore" | "price-changes") {
    pushQuery(startingPointFor(mode).initialState);
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

  const isPriceChanges = queryState.mode === "price-changes";
  const totalCount = isPriceChanges ? priceChangeResult.count : catalogueResult.count;
  const resultsWord = queryState.mode === "value-research" ? "value signals" : "results";
  const searchValue = !isPriceChanges ? getFilter(queryState.filters, "search")?.value ?? "" : "";

  return (
    <div className="flex h-full flex-col">
      <DataHonestyHeader />

      <ModeTabs mode={queryState.mode} onChange={handleModeChange} />

      {!isPriceChanges && (
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-border px-4 py-3">
          <SearchBar value={searchValue} onCommit={handleSetSearch} />
          <FilterStrip
            key={queryState.mode}
            filters={queryState.filters}
            facetValues={facetValues}
            facetRanges={facetRanges}
            formatOptions={formatOptions}
            onSetFilter={handleSetFilter}
            onRemoveFilter={handleRemoveFilter}
            onSetFormat={handleSetFormat}
          />
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-2 text-sm text-ink-muted">
        <span className="tabular-nums">
          {loading ? "Loading…" : `${totalCount.toLocaleString()} ${resultsWord}`}
        </span>
        {!isPriceChanges && (
          <FilterChips
            filters={queryState.filters}
            formatOptions={formatOptions}
            onRemove={handleRemoveFilter}
            onReset={handleReset}
          />
        )}
      </div>

      {error && (
        <div className="mx-4 mb-2 rounded border border-accent/40 bg-accent-soft px-3 py-2 text-sm text-accent">
          {error}
        </div>
      )}

      {isPriceChanges ? (
        <DataTable
          columns={PRICE_CHANGE_COLUMNS}
          rows={priceChangeResult.rows}
          rowKey={rowKey}
          sort={queryState.sort}
          onSortChange={(field, dir) => pushQuery({ mode: "price-changes", filters: [], sort: { field, dir }, page: 0 })}
          loading={loading}
          emptyMessage="No price changes match this view."
        />
      ) : (
        <DataTable
          columns={CATALOGUE_COLUMNS}
          rows={catalogueResult.rows}
          rowKey={rowKey}
          sort={queryState.sort}
          onSortChange={(field, dir) => pushQuery({ ...queryState, sort: { field, dir }, page: 0 })}
          loading={loading}
          emptyMessage="No results match these filters."
        />
      )}

      <Pagination page={queryState.page} pageSize={PAGE_SIZE} totalCount={totalCount} onPageChange={handlePageChange} />
    </div>
  );
}
