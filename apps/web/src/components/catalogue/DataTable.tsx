"use client";

import type { SortDir } from "@/lib/query/types";
import type { Column } from "./columns";

interface DataTableProps<Row, SortField extends string> {
  columns: Column<Row, SortField>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  sort: { field: SortField; dir: SortDir };
  onSortChange: (field: SortField, dir: SortDir) => void;
  loading: boolean;
  emptyMessage: string;
}

export function DataTable<Row, SortField extends string>({
  columns,
  rows,
  rowKey,
  sort,
  onSortChange,
  loading,
  emptyMessage,
}: DataTableProps<Row, SortField>) {
  function handleHeaderClick(column: Column<Row, SortField>) {
    if (!column.sortField) return;
    onSortChange(column.sortField, column.sortField === sort.field && sort.dir === "asc" ? "desc" : "asc");
  }

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <table className="w-full min-w-max border-collapse text-sm">
        <thead className="sticky top-0 z-10 bg-background shadow-[0_1px_0_0_var(--border)]">
          <tr>
            {columns.map((column) => (
              <th
                key={column.id}
                scope="col"
                className={`whitespace-nowrap px-3 py-2 font-medium text-ink-muted ${
                  column.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {column.sortField ? (
                  <button
                    type="button"
                    className="inline-flex items-center gap-1 rounded focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                    onClick={() => handleHeaderClick(column)}
                  >
                    {column.label}
                    {column.sortField === sort.field && (
                      <span aria-hidden="true">{sort.dir === "asc" ? "▲" : "▼"}</span>
                    )}
                  </button>
                ) : (
                  column.label
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-ink-muted">
                Loading…
              </td>
            </tr>
          ) : rows.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className="px-3 py-10 text-center text-ink-muted">
                {emptyMessage}
              </td>
            </tr>
          ) : (
            rows.map((row) => (
              <tr key={rowKey(row)} className="border-t border-border hover:bg-accent-soft/50">
                {columns.map((column) => (
                  <td
                    key={column.id}
                    className={`tabular-nums px-3 py-2 align-top ${column.align === "right" ? "text-right" : "text-left"}`}
                  >
                    {column.render(row)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
