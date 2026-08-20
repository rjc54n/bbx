import { Skeleton, SkeletonCard, SkeletonPage, SkeletonRows } from "@/components/app/Skeleton";

// Generic feedback for any protected route without a closer loading boundary.
// It renders inside AppShell (the layout stays mounted), so a client-side
// navigation shows this immediately while the dynamic page segment resolves.
export default function Loading() {
  return (
    <SkeletonPage>
      <Skeleton className="h-8 w-64" />
      <SkeletonCard lines={3} />
      <SkeletonRows rows={8} />
    </SkeletonPage>
  );
}
