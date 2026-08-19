"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

// One footer pagination for every list page. Two modes:
//  - Link mode (server pages): give it basePath + the query to preserve. It
//    builds its own hrefs and renders <Link>s, so Next prefetches Prev/Next —
//    a free perceived-speed win — and arbitrary jumps go through router.push.
//  - Callback mode (the client catalogue): give it onPageChange; it refetches
//    in place instead of navigating.
// The API is page-number based, which keeps a future keyset/cursor migration
// open: Prev/Next could switch to cursor hrefs while the jump stays offset.

// At or below this many pages the jump is a dropdown; above it, a number input
// (the catalogue is ~2,760 pages — a select there would be unusable).
const SELECT_MAX_PAGES = 25;

// Give it EITHER basePath (+ query) for Link-mode navigation, OR onPageChange
// for callback-mode. Both are optional here for narrowing simplicity; a call
// site passes exactly one.
export type PaginationProps = {
  /** 1-based current page. */
  page: number;
  /** Total pages; coerced to at least 1. */
  totalPages: number;
  /** Total row count, shown on the left as "N {label}" when provided. */
  totalCount?: number;
  /** Noun for the total, e.g. "wines" / "groups". Defaults to "total". */
  label?: string;
  /** Link mode: path without query, e.g. "/release-prices/matches". */
  basePath?: string;
  /** Link mode: query params to carry across page changes (page is set for you). */
  query?: Record<string, string>;
  /** Link mode: query key for the page number. Defaults to "page". */
  pageParam?: string;
  /** Callback mode: 1-based target page, for client pages that refetch in place. */
  onPageChange?: (page: number) => void;
};

/** Build a page href, preserving the other query params. Pure, for testing. */
export function pageHref(
  basePath: string,
  query: Record<string, string> | undefined,
  target: number,
  pageParam = "page",
): string {
  const params = new URLSearchParams(query ?? {});
  params.set(pageParam, String(target));
  return `${basePath}?${params.toString()}`;
}

/** Clamp an arbitrary (possibly NaN) page request into [1, totalPages]. */
export function clampPage(target: number, totalPages: number): number {
  if (!Number.isFinite(target)) return 1;
  return Math.min(Math.max(1, totalPages), Math.max(1, Math.trunc(target)));
}

const STEP_CLASS = "rounded border border-border px-2 py-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent";

export function Pagination(props: PaginationProps) {
  const { page, totalCount, label = "total" } = props;
  const totalPages = Math.max(1, props.totalPages);
  const router = useRouter();
  const jumpId = useId();
  const [jump, setJump] = useState("");

  const { basePath, query, pageParam, onPageChange } = props;

  function go(target: number) {
    const clamped = clampPage(target, totalPages);
    if (clamped === page) return;
    if (onPageChange) onPageChange(clamped);
    else if (basePath) router.push(pageHref(basePath, query, clamped, pageParam));
  }

  function step(target: number, children: string, disabled: boolean) {
    if (disabled) return <span aria-disabled="true" className={`${STEP_CLASS} opacity-40`}>{children}</span>;
    if (basePath && !onPageChange) {
      return <Link href={pageHref(basePath, query, target, pageParam)} className={STEP_CLASS}>{children}</Link>;
    }
    return <button type="button" className={STEP_CLASS} onClick={() => go(target)}>{children}</button>;
  }

  function submitJump() {
    if (jump.trim() === "") return;
    go(Number(jump));
    setJump("");
  }

  const jumpControl = totalPages > 1 && (totalPages <= SELECT_MAX_PAGES
    ? <label className="flex items-center gap-1">
        <span className="sr-only">Go to page</span>
        <select
          value={page}
          onChange={(event) => go(Number(event.target.value))}
          className="rounded border border-border bg-background px-1 py-1 tabular-nums"
        >
          {Array.from({ length: totalPages }, (_, index) => index + 1).map((value) => <option key={value} value={value}>{value}</option>)}
        </select>
      </label>
    : <span className="flex items-center gap-1">
        <label htmlFor={jumpId} className="sr-only">Go to page</label>
        <input
          id={jumpId}
          type="number"
          min={1}
          max={totalPages}
          value={jump}
          onChange={(event) => setJump(event.target.value)}
          onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); submitJump(); } }}
          placeholder={`1–${totalPages.toLocaleString()}`}
          className="w-24 rounded border border-border bg-background px-2 py-1 tabular-nums"
        />
        <button type="button" className={STEP_CLASS} onClick={submitJump}>Go</button>
      </span>);

  return <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-2 text-sm text-ink-muted">
    <span className="tabular-nums">{typeof totalCount === "number" ? `${totalCount.toLocaleString()} ${label}` : ""}</span>
    <nav aria-label="Pagination" className="flex flex-wrap items-center gap-2">
      {step(page - 1, "Previous", page <= 1)}
      <span className="tabular-nums">Page {page.toLocaleString()} of {totalPages.toLocaleString()}</span>
      {jumpControl}
      {step(page + 1, "Next", page >= totalPages)}
    </nav>
  </div>;
}
