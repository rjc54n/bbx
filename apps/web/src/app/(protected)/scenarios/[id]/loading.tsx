import { Skeleton, SkeletonPage, SkeletonRows } from "@/components/app/Skeleton";

// Scenario detail: a header, the filter summary, then the results table.
export default function Loading() {
  return (
    <SkeletonPage>
      <Skeleton className="h-4 w-32" />
      <Skeleton className="h-8 w-72" />
      <div className="flex flex-wrap gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-7 w-40" />
        ))}
      </div>
      <SkeletonRows rows={10} />
    </SkeletonPage>
  );
}
