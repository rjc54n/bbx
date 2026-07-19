"use client";

import { useEffect, useMemo, useState } from "react";
import {
  useReactTable,
  getCoreRowModel,
  flexRender,
  createColumnHelper,
  type SortingState,
} from "@tanstack/react-table";
import { supabase } from "@/lib/supabase";
import type { CandidateRow } from "@/lib/types";
import { formatPence, formatPct, formatFormat, formatDate } from "@/lib/format";

const PAGE_SIZE = 25;

const columnHelper = createColumnHelper<CandidateRow>();

const columns = [
  columnHelper.accessor((row) => row, {
    id: "wine",
    header: "Wine",
    enableSorting: false,
    cell: (info) => {
      const row = info.getValue();
      return (
        <div className="max-w-xs">
          <div className="font-medium text-zinc-900 dark:text-zinc-100">
            {row.name ?? row.parent_sku} {row.vintage ?? ""}
          </div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{row.producer}</div>
        </div>
      );
    },
  }),
  columnHelper.accessor((row) => row, {
    id: "region",
    header: "Region / Colour",
    enableSorting: false,
    cell: (info) => {
      const row = info.getValue();
      return (
        <div className="text-sm">
          <div>{row.region ?? "–"}</div>
          <div className="text-xs text-zinc-500 dark:text-zinc-400">{row.colour ?? "–"}</div>
        </div>
      );
    },
  }),
  columnHelper.accessor((row) => row, {
    id: "format",
    header: "Format",
    enableSorting: false,
    cell: (info) => formatFormat(info.getValue().case_size, info.getValue().bottle_volume_ml),
  }),
  columnHelper.accessor("least_listing_price_p", {
    id: "least_listing_price_p",
    header: "Ask",
    cell: (info) => formatPence(info.getValue()),
  }),
  columnHelper.accessor("market_price_p", {
    id: "market_price_p",
    header: "Market",
    enableSorting: false,
    cell: (info) => formatPence(info.getValue()),
  }),
  columnHelper.accessor("pct_market", {
    id: "pct_market",
    header: "% vs market",
    cell: (info) => formatPct(info.getValue()),
  }),
  columnHelper.accessor("pct_last", {
    id: "pct_last",
    header: "% vs last tx",
    cell: (info) => formatPct(info.getValue()),
  }),
  columnHelper.accessor("pct_next", {
    id: "pct_next",
    header: "% vs next (est.)",
    cell: (info) => formatPct(info.getValue()),
  }),
  columnHelper.accessor("qty_available", {
    id: "qty_available",
    header: "Qty",
    enableSorting: false,
    cell: (info) => info.getValue() ?? "–",
  }),
  columnHelper.accessor("last_seen_at", {
    id: "last_seen_at",
    header: "Last seen",
    cell: (info) => formatDate(info.getValue()),
  }),
];

export default function CandidatesPage() {
  const [rows, setRows] = useState<CandidateRow[]>([]);
  const [totalCount, setTotalCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [regions, setRegions] = useState<string[]>([]);
  const [colours, setColours] = useState<string[]>([]);

  const [region, setRegion] = useState("");
  const [colour, setColour] = useState("");
  const [minDiscount, setMinDiscount] = useState(0);
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [sorting, setSorting] = useState<SortingState>([{ id: "pct_market", desc: true }]);

  // Facet options, fetched once.
  useEffect(() => {
    supabase
      .from("product_detail_view")
      .select("region, colour")
      .then(({ data, error }) => {
        if (error) {
          console.error("Failed to load facet options", error);
          return;
        }
        if (!data) return;
        setRegions([...new Set(data.map((r) => r.region).filter((v): v is string => !!v))].sort());
        setColours([...new Set(data.map((r) => r.colour).filter((v): v is string => !!v))].sort());
      });
  }, []);

  // Reset to page 0 whenever filters change.
  useEffect(() => {
    setPage(0);
  }, [region, colour, minDiscount, search]);

  useEffect(() => {
    setLoading(true);
    setError(null);

    let query = supabase
      .from("candidate_view")
      .select("*", { count: "exact" })
      .eq("is_active", true);

    if (region) query = query.eq("region", region);
    if (colour) query = query.eq("colour", colour);
    if (minDiscount > 0) query = query.gte("pct_market", minDiscount);
    if (search) query = query.or(`name.ilike.%${search}%,producer.ilike.%${search}%`);

    const sort = sorting[0];
    if (sort) {
      query = query.order(sort.id, { ascending: !sort.desc, nullsFirst: false });
    }

    query = query.range(page * PAGE_SIZE, page * PAGE_SIZE + PAGE_SIZE - 1);

    let cancelled = false;
    query.then(({ data, count, error }) => {
      if (cancelled) return;
      if (error) {
        setError(error.message);
        setRows([]);
      } else {
        setRows(data ?? []);
        setTotalCount(count ?? 0);
      }
      setLoading(false);
    });

    return () => {
      cancelled = true;
    };
  }, [region, colour, minDiscount, search, page, sorting]);

  const table = useReactTable({
    data: rows,
    columns,
    state: { sorting },
    onSortingChange: setSorting,
    manualSorting: true,
    manualPagination: true,
    getCoreRowModel: getCoreRowModel(),
  });

  const totalPages = useMemo(() => Math.max(1, Math.ceil(totalCount / PAGE_SIZE)), [totalCount]);

  return (
    <div className="flex flex-col flex-1 bg-zinc-50 dark:bg-black">
      <main className="mx-auto w-full max-w-7xl flex-1 px-6 py-8">
        <h1 className="mb-6 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">
          BBX Candidates
        </h1>

        <div className="mb-4 flex flex-wrap items-end gap-4">
          <label className="flex flex-col text-sm">
            Region
            <select
              className="mt-1 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              value={region}
              onChange={(e) => setRegion(e.target.value)}
            >
              <option value="">All</option>
              {regions.map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Colour
            <select
              className="mt-1 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              value={colour}
              onChange={(e) => setColour(e.target.value)}
            >
              <option value="">All</option>
              {colours.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>

          <label className="flex flex-col text-sm">
            Min % vs market
            <input
              type="number"
              className="mt-1 w-24 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              value={minDiscount}
              onChange={(e) => setMinDiscount(Number(e.target.value))}
              min={0}
              max={100}
            />
          </label>

          <label className="flex flex-col text-sm">
            Search name / producer
            <input
              type="text"
              className="mt-1 w-56 rounded border border-zinc-300 bg-white px-2 py-1 dark:border-zinc-700 dark:bg-zinc-900"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="e.g. Lafite"
            />
          </label>

          <div className="text-sm text-zinc-500 dark:text-zinc-400">
            {totalCount.toLocaleString()} candidates
          </div>
        </div>

        {error && (
          <div className="mb-4 rounded border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:border-red-800 dark:bg-red-950 dark:text-red-300">
            {error}
          </div>
        )}

        <div className="overflow-x-auto rounded border border-zinc-200 dark:border-zinc-800">
          <table className="w-full text-sm">
            <thead className="bg-zinc-100 dark:bg-zinc-900">
              {table.getHeaderGroups().map((hg) => (
                <tr key={hg.id}>
                  {hg.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-3 py-2 text-left font-medium text-zinc-700 dark:text-zinc-300"
                    >
                      {header.column.getCanSort() ? (
                        <button
                          className="flex items-center gap-1"
                          onClick={header.column.getToggleSortingHandler()}
                        >
                          {flexRender(header.column.columnDef.header, header.getContext())}
                          {{ asc: " ▲", desc: " ▼" }[header.column.getIsSorted() as string] ?? ""}
                        </button>
                      ) : (
                        flexRender(header.column.columnDef.header, header.getContext())
                      )}
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-zinc-500">
                    Loading…
                  </td>
                </tr>
              ) : rows.length === 0 ? (
                <tr>
                  <td colSpan={columns.length} className="px-3 py-6 text-center text-zinc-500">
                    No candidates match these filters.
                  </td>
                </tr>
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="border-t border-zinc-200 odd:bg-white even:bg-zinc-50 dark:border-zinc-800 dark:odd:bg-zinc-950 dark:even:bg-zinc-900"
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-3 py-2 align-top">
                        {flexRender(cell.column.columnDef.cell, cell.getContext())}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="mt-4 flex items-center gap-3 text-sm">
          <button
            className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <button
            className="rounded border border-zinc-300 px-3 py-1 disabled:opacity-40 dark:border-zinc-700"
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page + 1 >= totalPages}
          >
            Next
          </button>
        </div>
      </main>
    </div>
  );
}
