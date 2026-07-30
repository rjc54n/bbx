import { Suspense } from "react";
import { CatalogueBrowser } from "@/components/catalogue/CatalogueBrowser";
import { requireOwner } from "@/lib/auth/owner";

// CatalogueBrowser reads the query string via useSearchParams(), which
// requires a Suspense boundary for static builds (see Next.js docs on
// useSearchParams prerendering) -- without it `next build` fails.
export default async function Page() {
  const { supabase, userId } = await requireOwner();
  const { data, error } = await supabase
    .from("wine_favourites")
    .select("parent_sku")
    .eq("user_id", userId);
  if (error) throw new Error("Wine favourites could not be loaded.");

  return (
    <Suspense fallback={<div className="p-4 text-sm text-ink-muted">Loading…</div>}>
      <CatalogueBrowser favouriteParentSkus={(data ?? []).map((row) => row.parent_sku)} />
    </Suspense>
  );
}
