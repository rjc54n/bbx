// A single shimmer block. Skeletons are navigation feedback only -- they make
// the wait visible while the server response resolves; they do not change how
// long the data takes. aria-hidden keeps the placeholder out of the a11y tree;
// the surrounding loading boundary carries the aria-busy/label.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-border ${className}`} />;
}

// The shared page frame every protected loading state uses, so a skeleton lands
// in the same scroll container and width as the real page it stands in for.
export function SkeletonPage({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-0 flex-1 overflow-auto bg-accent-soft" aria-busy="true" aria-label="Loading">
      <div className="mx-auto max-w-6xl space-y-5 p-5">{children}</div>
    </main>
  );
}

// A boxed card of stacked lines, matching the rounded-border-background panels
// the real pages are built from.
export function SkeletonCard({ lines = 3 }: { lines?: number }) {
  return (
    <div className="space-y-3 rounded-lg border border-border bg-background p-5">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={`h-4 ${i === 0 ? "w-1/3" : i % 2 ? "w-2/3" : "w-1/2"}`} />
      ))}
    </div>
  );
}

// A table-shaped block of even rows, for the list and evidence surfaces.
export function SkeletonRows({ rows = 8 }: { rows?: number }) {
  return (
    <div className="space-y-2 rounded-lg border border-border bg-background p-5">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-6 w-full" />
      ))}
    </div>
  );
}
