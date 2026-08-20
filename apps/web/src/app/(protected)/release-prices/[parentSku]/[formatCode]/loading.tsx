import { Skeleton, SkeletonCard, SkeletonPage } from "@/components/app/Skeleton";

// Release-price detail: back links, the anchor summary header, the owner-price
// form, then the accepted-evidence list.
export default function Loading() {
  return (
    <SkeletonPage>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-4 w-32" />
      </div>
      <div className="space-y-3 rounded-lg border border-border bg-background p-5">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-8 w-72" />
        <div className="flex flex-wrap gap-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-28" />
          ))}
        </div>
      </div>
      <SkeletonCard lines={3} />
      <SkeletonCard lines={4} />
    </SkeletonPage>
  );
}
