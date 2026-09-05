import { Suspense } from "react";
import { BbrCellarBrowser } from "@/components/cellar/BbrCellarBrowser";
import type { BbrCellarRow } from "@/lib/cellar/bbrBrowser";
import { requireOwner } from "@/lib/auth/owner";
import { loadFavourites } from "@/lib/favourites/server";

export const dynamic = "force-dynamic";

type NominatedImport = {
  id: string;
  effective_date: string | null;
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
      .from("bbr_cellar_positions_market_view")
      .select("*")
      .order("description", { ascending: true }),
    supabase
      .from("cellar_imports")
      .select("id, effective_date, unmatched_row_count")
      .eq("source_type", "bbr_holdings")
      .eq("status", "accepted")
      .eq("accepted_role", "current")
      .is("superseded_at", null)
      .maybeSingle(),
    loadFavourites(owner),
  ]);

  if (holdingError || importError) {
    throw new Error("The current BBR cellar could not be loaded.");
  }

  const rows = (holdingData ?? []) as BbrCellarRow[];
  const nominatedImport = importData as NominatedImport | null;

  return (
    <Suspense fallback={<p className="p-5 text-sm text-ink-muted">Loading cellar…</p>}>
      <BbrCellarBrowser
        rows={rows}
        acceptedImportId={nominatedImport?.id ?? null}
        effectiveDate={nominatedImport?.effective_date ?? null}
        unmatchedCount={nominatedImport?.unmatched_row_count ?? 0}
        favouriteParentSkus={parentSkus}
      />
    </Suspense>
  );
}
