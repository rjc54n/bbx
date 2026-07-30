import { Suspense } from "react";
import { CatalogueBrowser } from "@/components/catalogue/CatalogueBrowser";
import { requireOwner } from "@/lib/auth/owner";
import { loadFavourites } from "@/lib/favourites/server";

// CatalogueBrowser reads the query string via useSearchParams(), which
// requires a Suspense boundary for static builds (see Next.js docs on
// useSearchParams prerendering) -- without it `next build` fails.
export default async function Page() {
  const owner = await requireOwner();
  const { parentSkus } = await loadFavourites(owner);

  return (
    <Suspense fallback={<div className="p-4 text-sm text-ink-muted">Loading…</div>}>
      <CatalogueBrowser favouriteParentSkus={parentSkus} />
    </Suspense>
  );
}
