import { Skeleton, SkeletonCard, SkeletonPage, SkeletonRows } from "@/components/app/Skeleton";

// Wine card: the status band, the per-format cards, then the evidence sections.
export default function Loading() {
  return (
    <SkeletonPage>
      <div className="space-y-3 rounded-lg border border-border bg-background p-5">
        <Skeleton className="h-8 w-80" />
        <Skeleton className="h-4 w-1/2" />
        <div className="flex flex-wrap gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-28" />
          ))}
        </div>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {Array.from({ length: 3 }).map((_, i) => (
          <SkeletonCard key={i} lines={4} />
        ))}
      </div>
      <SkeletonRows rows={6} />
    </SkeletonPage>
  );
}
