"use client";

interface PaginationProps {
  page: number;
  pageSize: number;
  totalCount: number;
  onPageChange: (page: number) => void;
}

export function Pagination({ page, pageSize, totalCount, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(totalCount / pageSize));

  return (
    <div className="flex items-center gap-3 border-t border-border px-4 py-2 text-sm text-ink-muted">
      <button
        type="button"
        className="rounded border border-border px-2 py-1 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => onPageChange(Math.max(0, page - 1))}
        disabled={page === 0}
      >
        Previous
      </button>
      <span className="tabular-nums">
        Page {page + 1} of {totalPages} · {totalCount.toLocaleString()} total
      </span>
      <button
        type="button"
        className="rounded border border-border px-2 py-1 disabled:opacity-40 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent"
        onClick={() => onPageChange(Math.min(totalPages - 1, page + 1))}
        disabled={page + 1 >= totalPages}
      >
        Next
      </button>
    </div>
  );
}
