import { Suspense } from "react";
import { BbrCellarBrowser } from "@/components/cellar/BbrCellarBrowser";
import type { BbrCellarRow } from "@/lib/cellar/bbrBrowser";
import { requireOwner } from "@/lib/auth/owner";
import { loadFavourites } from "@/lib/favourites/server";

export const dynamic = "force-dynamic";

type AcceptedImport = {
  id: string;
  accepted_at: string | null;
  unmatched_row_count: number;
};

export default async function BbrCellarPage() {
  const owner = await requireOwner();
  const { supabase } = owner;
  const [
    { data: holdingData, error: holdingError },
    { data: importData, error: importError },
    { parentSkus },
  ] = await Promise.all([
    supabase
      .from("bbr_cellar_market_view")
      .select("*")
      .order("description", { ascending: true }),
    supabase
      .from("cellar_imports")
      .select("id, accepted_at, unmatched_row_count")
      .eq("source_type", "bbr_holdings")
      .eq("status", "accepted")
      .order("accepted_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    loadFavourites(owner),
  ]);

  if (holdingError || importError) {
    throw new Error("The current BBR cellar could not be loaded.");
  }

  const rows = (holdingData ?? []) as BbrCellarRow[];
  const acceptedImport = importData as AcceptedImport | null;

  return (
    <Suspense fallback={<p className="p-5 text-sm text-ink-muted">Loading cellar…</p>}>
      <BbrCellarBrowser
        rows={rows}
        acceptedImportId={acceptedImport?.id ?? null}
        confirmedAt={acceptedImport?.accepted_at ?? rows[0]?.confirmed_at ?? null}
        unmatchedCount={acceptedImport?.unmatched_row_count ?? 0}
        favouriteParentSkus={parentSkus}
      />
    </Suspense>
  );
}
